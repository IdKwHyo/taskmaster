from __future__ import annotations

from typing import Any

from henry_cloud.config import Settings
from henry_cloud.domain.errors import InvalidTransition, MissionNotFound
from henry_cloud.domain.models import (
    Approval,
    ApprovalStatus,
    ExecutionEvent,
    Mission,
    MissionStatus,
    MissionStep,
    RiskLevel,
    StepKind,
    StepStatus,
    utc_now,
)
from henry_cloud.ports.dispatcher import WorkflowDispatcher
from henry_cloud.ports.planner import MissionPlanner
from henry_cloud.ports.repository import MissionRepository
from henry_cloud.ports.tools import WorkflowTools


class WorkflowEngine:
    """Durable state machine. Models propose; this engine controls execution."""

    def __init__(
        self,
        *,
        repository: MissionRepository,
        dispatcher: WorkflowDispatcher,
        planner: MissionPlanner,
        tools: WorkflowTools,
        settings: Settings,
    ) -> None:
        self.repository = repository
        self.dispatcher = dispatcher
        self.planner = planner
        self.tools = tools
        self.settings = settings

    async def create_mission(self, outcome: str, owner_id: str) -> Mission:
        mission = Mission(
            outcome=outcome,
            owner_id=owner_id,
            steps=[MissionStep(name="Plan the outcome", kind=StepKind.PLAN, order=0)],
        )
        mission = await self.repository.create_mission(mission)
        await self.repository.append_event(
            ExecutionEvent(
                mission_id=mission.id,
                event_type="MISSION_CREATED",
                message="Outcome accepted. Planning queued.",
                step_id=mission.steps[0].id,
            )
        )
        await self.dispatcher.dispatch(mission.id)
        return mission

    async def run_next(self, mission_id: str, task_id: str) -> Mission:
        mission = await self._require_mission(mission_id)
        if task_id in mission.processed_task_ids or mission.terminal:
            return mission
        if mission.status in {MissionStatus.PAUSED, MissionStatus.PAUSED_BUDGET}:
            return mission
        if mission.status in {MissionStatus.WAITING_EXTERNAL, MissionStatus.WAITING_APPROVAL}:
            return mission

        step = mission.current_step
        if step is None:
            mission.status = MissionStatus.COMPLETED
            return await self.repository.save_mission(mission, mission.version)

        pause_reason = self._budget_pause_reason(mission, step)
        if pause_reason:
            mission.status = MissionStatus.PAUSED_BUDGET
            self._remember_task(mission, task_id)
            saved = await self.repository.save_mission(mission, mission.version)
            await self._event(saved, "BUDGET_PAUSED", pause_reason, step.id)
            return saved

        step.status = StepStatus.RUNNING
        step.started_at = step.started_at or utc_now()
        step.attempts += 1
        mission.status = MissionStatus.RUNNING
        mission = await self.repository.save_mission(mission, mission.version)
        step = mission.current_step
        assert step is not None

        try:
            if step.kind == StepKind.PLAN:
                await self._run_planning_step(mission, step)
            elif step.kind == StepKind.WAIT_EXTERNAL:
                step.status = StepStatus.WAITING
                mission.status = MissionStatus.WAITING_EXTERNAL
            elif step.kind == StepKind.APPROVAL:
                await self._open_approval(mission, step)
                step.status = StepStatus.WAITING
                mission.status = MissionStatus.WAITING_APPROVAL
            else:
                output = await self._run_tool_step(mission, step)
                if step.kind == StepKind.BOOK_AND_CONFIRM:
                    self._require_verified_completion(output)
                step.output = output
                mission.usage.tool_calls += 1
                self._complete_current_step(mission)
        except Exception as exc:
            return await self._handle_step_error(mission, step, task_id, exc)

        self._remember_task(mission, task_id)
        saved = await self.repository.save_mission(mission, mission.version)
        await self._event(
            saved,
            "STEP_WAITING" if step.status == StepStatus.WAITING else "STEP_COMPLETED",
            self._step_event_message(saved, step),
            step.id,
            {"status": saved.status.value},
        )
        if saved.status == MissionStatus.RUNNING:
            await self.dispatcher.dispatch(saved.id)
        return saved

    async def resume_external(
        self,
        mission_id: str,
        *,
        event_id: str,
        payload: dict[str, Any],
    ) -> Mission:
        mission = await self._require_mission(mission_id)
        dedupe_id = f"external:{event_id}"
        if dedupe_id in mission.processed_task_ids:
            return mission
        step = mission.current_step
        if mission.status != MissionStatus.WAITING_EXTERNAL or not step:
            raise InvalidTransition(f"Mission {mission.id} is not waiting for an external event")
        if step.kind != StepKind.WAIT_EXTERNAL:
            raise InvalidTransition("Current step is not an external wait boundary")

        step.output = {"event_id": event_id, **payload}
        self._complete_current_step(mission)
        self._remember_task(mission, dedupe_id)
        saved = await self.repository.save_mission(mission, mission.version)
        await self._event(
            saved,
            "EXTERNAL_EVENT_RECEIVED",
            "External response received. Mission resumed.",
            step.id,
            payload,
        )
        await self.dispatcher.dispatch(saved.id)
        return saved

    async def pause(self, mission_id: str) -> Mission:
        mission = await self._require_mission(mission_id)
        if mission.terminal:
            raise InvalidTransition(f"Mission {mission.id} is already terminal")
        if mission.status in {MissionStatus.WAITING_APPROVAL, MissionStatus.PAUSED}:
            return mission
        mission.status = MissionStatus.PAUSED
        saved = await self.repository.save_mission(mission, mission.version)
        await self._event(saved, "MISSION_PAUSED", "Mission paused safely by its owner.")
        return saved

    async def resume(self, mission_id: str) -> Mission:
        mission = await self._require_mission(mission_id)
        if mission.status not in {MissionStatus.PAUSED, MissionStatus.PAUSED_BUDGET}:
            raise InvalidTransition(f"Mission {mission.id} is not paused")
        mission.status = MissionStatus.RUNNING
        saved = await self.repository.save_mission(mission, mission.version)
        await self._event(saved, "MISSION_RESUMED", "Mission resumed by its owner.")
        await self.dispatcher.dispatch(saved.id)
        return saved

    async def decide_approval(
        self,
        approval_id: str,
        *,
        approved: bool,
        decided_by: str,
        note: str | None = None,
    ) -> Mission:
        approval = await self.repository.get_approval(approval_id)
        if approval is None:
            raise MissionNotFound(f"Approval {approval_id} not found")
        desired = ApprovalStatus.APPROVED if approved else ApprovalStatus.REJECTED
        if approval.status not in {ApprovalStatus.PENDING, desired}:
            raise InvalidTransition(f"Approval already {approval.status.value.lower()}")

        if approval.status == ApprovalStatus.PENDING:
            approval.status = desired
            approval.decided_by = decided_by
            approval.decision_note = note
            approval.decided_at = utc_now()
            await self.repository.save_approval(approval)

        mission = await self._require_mission(approval.mission_id)
        step = mission.current_step
        if (
            mission.status == MissionStatus.WAITING_APPROVAL
            and step
            and step.id == approval.step_id
        ):
            if approved:
                step.output = {"approval_id": approval.id, "approved_by": decided_by}
                self._complete_current_step(mission)
            else:
                step.status = StepStatus.SKIPPED
                step.completed_at = utc_now()
                mission.status = MissionStatus.CANCELLED
            saved = await self.repository.save_mission(mission, mission.version)
        else:
            saved = mission

        await self._event(
            saved,
            "APPROVAL_DECIDED",
            "Human approved the proposed action."
            if approved
            else "Human rejected the proposed action.",
            approval.step_id,
            {"approval_id": approval.id, "decision": desired.value},
        )
        if approved and saved.status == MissionStatus.RUNNING:
            await self.dispatcher.dispatch(saved.id)
        return saved

    async def _run_planning_step(self, mission: Mission, step: MissionStep) -> None:
        result = await self.planner.plan(mission.outcome, mission.owner_id, mission.id)
        self._validate_plan(result.steps)
        mission.summary = result.summary
        mission.authority = result.authority.model_copy(deep=True)
        mission.authority.spend_limit_usd = min(
            mission.authority.spend_limit_usd,
            self.settings.max_workflow_cost_usd,
        )
        mission.usage.model_calls += 1
        mission.usage.input_tokens += result.input_tokens
        mission.usage.output_tokens += result.output_tokens
        mission.usage.estimated_model_cost_usd = self._estimate_model_cost(
            mission.usage.input_tokens,
            mission.usage.output_tokens,
        )
        step.output = {"summary": result.summary, "step_count": len(result.steps)}
        step.status = StepStatus.COMPLETED
        step.completed_at = utc_now()
        mission.steps.extend(
            MissionStep(name=draft.name, kind=draft.kind, order=index, input=draft.input)
            for index, draft in enumerate(result.steps, start=1)
        )
        mission.current_step_index = 1
        mission.status = MissionStatus.RUNNING

    async def _run_tool_step(self, mission: Mission, step: MissionStep) -> dict[str, Any]:
        payload = {**step.input, "mission_context": self._mission_context(mission)}
        if step.kind == StepKind.CHECK_CALENDAR:
            return await self.tools.check_calendar(payload, step.idempotency_key)
        if step.kind == StepKind.CONTACT_ATTENDEE:
            return await self.tools.contact_attendee(payload, step.idempotency_key)
        if step.kind == StepKind.BOOK_AND_CONFIRM:
            return await self.tools.book_and_confirm(payload, step.idempotency_key)
        raise InvalidTransition(f"No tool adapter for step kind {step.kind.value}")

    async def _open_approval(self, mission: Mission, step: MissionStep) -> None:
        context = self._mission_context(mission)
        approval = Approval(
            id=f"ap-{step.id}",
            mission_id=mission.id,
            step_id=step.id,
            title="Approve calendar booking",
            description=(
                "Henry found a viable slot. The calendar write is outside delegated "
                "authority and remains blocked until approved."
            ),
            risk=RiskLevel.MEDIUM,
            proposed_action={"action": "create_calendar_event", "context": context},
        )
        await self.repository.create_approval(approval)

    async def _handle_step_error(
        self,
        mission: Mission,
        step: MissionStep,
        task_id: str,
        exc: Exception,
    ) -> Mission:
        step.last_error = f"{type(exc).__name__}: {exc}"[:500]
        if step.attempts >= self.settings.max_retries_per_step:
            step.status = StepStatus.FAILED
            step.completed_at = utc_now()
            mission.status = MissionStatus.FAILED
            self._remember_task(mission, task_id)
            saved = await self.repository.save_mission(mission, mission.version)
            await self._event(saved, "STEP_FAILED", step.last_error, step.id)
            return saved

        step.status = StepStatus.PENDING
        mission.status = MissionStatus.RUNNING
        saved = await self.repository.save_mission(mission, mission.version)
        await self._event(saved, "STEP_RETRY", step.last_error, step.id)
        raise RuntimeError(f"Retryable mission step failure: {step.last_error}") from exc

    def _validate_plan(self, drafts: list[Any]) -> None:
        if len(drafts) + 1 > self.settings.max_workflow_steps:
            raise ValueError("Plan exceeds the configured workflow step cap")
        kinds = [draft.kind for draft in drafts]
        if StepKind.PLAN in kinds:
            raise ValueError("Planner cannot create a nested planning step")
        if StepKind.BOOK_AND_CONFIRM in kinds:
            book_index = kinds.index(StepKind.BOOK_AND_CONFIRM)
            if book_index == 0 or kinds[book_index - 1] != StepKind.APPROVAL:
                raise ValueError("BOOK_AND_CONFIRM must immediately follow APPROVAL")
        if StepKind.WAIT_EXTERNAL in kinds:
            wait_index = kinds.index(StepKind.WAIT_EXTERNAL)
            if StepKind.CONTACT_ATTENDEE not in kinds[:wait_index]:
                raise ValueError("WAIT_EXTERNAL requires a preceding CONTACT_ATTENDEE")

    def _budget_pause_reason(self, mission: Mission, step: MissionStep) -> str | None:
        mission_limit = min(
            mission.authority.spend_limit_usd,
            self.settings.max_workflow_cost_usd,
        )
        if mission.usage.estimated_model_cost_usd >= mission_limit:
            return "Workflow model-cost ceiling reached."
        if (
            step.kind == StepKind.PLAN
            and mission.usage.model_calls >= self.settings.max_model_calls
        ):
            return "Workflow model-call ceiling reached."
        if step.kind not in {StepKind.PLAN, StepKind.WAIT_EXTERNAL, StepKind.APPROVAL}:
            if mission.usage.tool_calls >= self.settings.max_tool_calls:
                return "Workflow tool-call ceiling reached."
        return None

    def _estimate_model_cost(self, input_tokens: int, output_tokens: int) -> float:
        cost = (
            input_tokens * self.settings.model_input_usd_per_million
            + output_tokens * self.settings.model_output_usd_per_million
        ) / 1_000_000
        return round(cost, 6)

    @staticmethod
    def _complete_current_step(mission: Mission) -> None:
        step = mission.current_step
        if step is None:
            return
        step.status = StepStatus.COMPLETED
        step.completed_at = utc_now()
        mission.current_step_index += 1
        mission.status = (
            MissionStatus.COMPLETED
            if mission.current_step_index >= len(mission.steps)
            else MissionStatus.RUNNING
        )

    @staticmethod
    def _mission_context(mission: Mission) -> dict[str, Any]:
        context = {
            step.kind.value: step.output
            for step in mission.steps
            if step.status == StepStatus.COMPLETED and step.output
        }
        context["OUTCOME"] = mission.outcome
        context["AUTHORITY"] = mission.authority.model_dump(mode="json")
        return context

    @staticmethod
    def _require_verified_completion(output: dict[str, Any]) -> None:
        verification = output.get("verification")
        if not isinstance(verification, dict):
            raise ValueError("Completion evidence is missing")
        if verification.get("status") != "READ_BACK_OK":
            raise ValueError("External state did not satisfy the completion contract")

    @staticmethod
    def _remember_task(mission: Mission, task_id: str) -> None:
        if task_id not in mission.processed_task_ids:
            mission.processed_task_ids.append(task_id)
            mission.processed_task_ids = mission.processed_task_ids[-50:]

    async def _require_mission(self, mission_id: str) -> Mission:
        mission = await self.repository.get_mission(mission_id)
        if mission is None:
            raise MissionNotFound(f"Mission {mission_id} not found")
        return mission

    async def _event(
        self,
        mission: Mission,
        event_type: str,
        message: str,
        step_id: str | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        await self.repository.append_event(
            ExecutionEvent(
                mission_id=mission.id,
                event_type=event_type,
                message=message,
                step_id=step_id,
                data=data or {},
            )
        )

    @staticmethod
    def _step_event_message(mission: Mission, step: MissionStep) -> str:
        if mission.status == MissionStatus.WAITING_EXTERNAL:
            return "Paused until the attendee replies."
        if mission.status == MissionStatus.WAITING_APPROVAL:
            return "Paused at the human approval boundary."
        if mission.status == MissionStatus.COMPLETED:
            return "Mission completed and externally verified."
        return f"Completed: {step.name}"

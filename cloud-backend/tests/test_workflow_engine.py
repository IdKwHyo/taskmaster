from __future__ import annotations

from typing import Any

import pytest

from henry_cloud.agents.planner import DemoMissionPlanner
from henry_cloud.config import Settings
from henry_cloud.domain.errors import InvalidTransition, MissionNotFound
from henry_cloud.domain.models import (
    AuthorityEnvelope,
    Mission,
    MissionStatus,
    MissionStep,
    PlanResult,
    StepDraft,
    StepKind,
    StepStatus,
)
from henry_cloud.infrastructure.repositories.memory import InMemoryMissionRepository
from henry_cloud.infrastructure.tasks.local import LocalDispatcher
from henry_cloud.infrastructure.tools.demo import DemoWorkflowTools
from henry_cloud.services.workflow_engine import WorkflowEngine


def make_settings(**updates: Any) -> Settings:
    return Settings.model_construct(
        max_workflow_steps=updates.get("max_workflow_steps", 8),
        max_model_calls=updates.get("max_model_calls", 6),
        max_tool_calls=updates.get("max_tool_calls", 12),
        max_retries_per_step=updates.get("max_retries_per_step", 2),
        max_workflow_cost_usd=updates.get("max_workflow_cost_usd", 0.25),
        model_input_usd_per_million=1.50,
        model_output_usd_per_million=9.00,
    )


def build_engine(
    *,
    planner: Any | None = None,
    tools: Any | None = None,
    settings: Settings | None = None,
) -> tuple[WorkflowEngine, InMemoryMissionRepository, LocalDispatcher, Any]:
    repository = InMemoryMissionRepository()
    dispatcher = LocalDispatcher()
    selected_tools = tools or DemoWorkflowTools()
    engine = WorkflowEngine(
        repository=repository,
        dispatcher=dispatcher,
        planner=planner or DemoMissionPlanner(),
        tools=selected_tools,
        settings=settings or make_settings(),
    )
    return engine, repository, dispatcher, selected_tools


async def advance_to_external_wait(engine: WorkflowEngine, mission_id: str) -> None:
    for task_id in ("task-plan", "task-calendar", "task-contact", "task-wait"):
        await engine.run_next(mission_id, task_id)


@pytest.mark.asyncio
async def test_mission_waits_resumes_requires_approval_and_completes() -> None:
    engine, repository, _, tools = build_engine()
    mission = await engine.create_mission("Coordinate a 30-minute project review with A", "owner-1")

    await advance_to_external_wait(engine, mission.id)
    waiting = await repository.get_mission(mission.id)
    assert waiting is not None
    assert waiting.status == MissionStatus.WAITING_EXTERNAL
    assert waiting.current_step and waiting.current_step.kind == StepKind.WAIT_EXTERNAL

    await engine.resume_external(
        mission.id,
        event_id="discord-message-42",
        payload={
            "attendee": "A",
            "selected_slot": "2026-08-18T10:00:00+07:00",
        },
    )
    approval_wait = await engine.run_next(mission.id, "task-approval")
    assert approval_wait.status == MissionStatus.WAITING_APPROVAL

    approvals = await repository.list_approvals(status="PENDING")
    assert len(approvals) == 1
    resumed = await engine.decide_approval(
        approvals[0].id,
        approved=True,
        decided_by="owner-1",
    )
    assert resumed.status == MissionStatus.RUNNING

    completed = await engine.run_next(mission.id, "task-book")
    assert completed.status == MissionStatus.COMPLETED
    assert all(step.status == StepStatus.COMPLETED for step in completed.steps)
    assert completed.authority.spend_limit_usd == 0.10
    assert completed.current_step is None
    verification = completed.steps[-1].output["verification"]
    assert verification["status"] == "READ_BACK_OK"

    calls_before_duplicate = len(tools.calls)
    duplicate = await engine.run_next(mission.id, "task-book")
    assert duplicate.status == MissionStatus.COMPLETED
    assert len(tools.calls) == calls_before_duplicate


@pytest.mark.asyncio
async def test_rejected_approval_cancels_without_booking() -> None:
    engine, repository, _, tools = build_engine()
    mission = await engine.create_mission("Schedule a review with A", "owner-1")
    await advance_to_external_wait(engine, mission.id)
    await engine.resume_external(
        mission.id,
        event_id="reply-1",
        payload={"selected_slot": "2026-08-18T10:00:00+07:00"},
    )
    await engine.run_next(mission.id, "task-approval")
    approval = (await repository.list_approvals(status="PENDING"))[0]

    cancelled = await engine.decide_approval(
        approval.id,
        approved=False,
        decided_by="owner-1",
        note="Use a different day",
    )
    assert cancelled.status == MissionStatus.CANCELLED
    assert not any(name == "book_and_confirm" for name, _ in tools.calls)


class ExpensivePlanner(DemoMissionPlanner):
    async def plan(self, outcome: str, owner_id: str, mission_id: str) -> PlanResult:
        result = await super().plan(outcome, owner_id, mission_id)
        result.input_tokens = 1_000_000
        return result


class UnverifiedTools(DemoWorkflowTools):
    async def book_and_confirm(self, payload: dict[str, Any], action_id: str) -> dict[str, Any]:
        return {"calendar_event_id": "created-without-read-back", "status": "confirmed"}


@pytest.mark.asyncio
async def test_completion_contract_rejects_unverified_external_state() -> None:
    engine, repository, _, _ = build_engine(tools=UnverifiedTools())
    mission = await engine.create_mission("Schedule a review with A", "owner-1")
    await advance_to_external_wait(engine, mission.id)
    await engine.resume_external(
        mission.id,
        event_id="reply-verified-path",
        payload={"selected_slot": "2026-08-24T10:00:00+07:00"},
    )
    await engine.run_next(mission.id, "approval")
    approval = (await repository.list_approvals(status="PENDING"))[0]
    await engine.decide_approval(approval.id, approved=True, decided_by="owner-1")

    with pytest.raises(RuntimeError, match="Retryable"):
        await engine.run_next(mission.id, "book-unverified")
    persisted = await repository.get_mission(mission.id)
    assert persisted and persisted.status == MissionStatus.RUNNING
    assert "Completion evidence is missing" in persisted.current_step.last_error


class HighLimitPlanner(DemoMissionPlanner):
    async def plan(self, outcome: str, owner_id: str, mission_id: str) -> PlanResult:
        result = await super().plan(outcome, owner_id, mission_id)
        result.authority = AuthorityEnvelope(spend_limit_usd=2.0)
        return result


@pytest.mark.asyncio
async def test_user_authority_is_persisted_and_clamped_to_system_limit() -> None:
    engine, _, _, _ = build_engine(
        planner=HighLimitPlanner(),
        settings=make_settings(max_workflow_cost_usd=0.25),
    )
    mission = await engine.create_mission("Schedule a review with A", "owner-1")
    planned = await engine.run_next(mission.id, "plan-authority")
    assert planned.authority.spend_limit_usd == 0.25
    assert "create_calendar_event" in planned.authority.approval_required_for


@pytest.mark.asyncio
async def test_owner_pause_blocks_dispatched_work_until_resume() -> None:
    engine, repository, dispatcher, _ = build_engine()
    mission = await engine.create_mission("Schedule a review with A", "owner-1")

    paused = await engine.pause(mission.id)
    assert paused.status == MissionStatus.PAUSED
    ignored = await engine.run_next(mission.id, "already-dispatched")
    assert ignored.status == MissionStatus.PAUSED
    assert ignored.current_step.kind == StepKind.PLAN

    resumed = await engine.resume(mission.id)
    assert resumed.status == MissionStatus.RUNNING
    assert dispatcher.pending[-1][0] == mission.id
    persisted = await repository.get_mission(mission.id)
    assert persisted and persisted.status == MissionStatus.RUNNING


@pytest.mark.asyncio
async def test_cost_ceiling_pauses_before_next_action() -> None:
    engine, _, _, _ = build_engine(
        planner=ExpensivePlanner(),
        settings=make_settings(max_workflow_cost_usd=0.25),
    )
    mission = await engine.create_mission("Schedule a review with A", "owner-1")
    planned = await engine.run_next(mission.id, "task-plan")
    assert planned.usage.estimated_model_cost_usd == 1.5

    paused = await engine.run_next(mission.id, "task-calendar")
    assert paused.status == MissionStatus.PAUSED_BUDGET
    assert paused.usage.tool_calls == 0


class FlakyTools(DemoWorkflowTools):
    def __init__(self) -> None:
        super().__init__()
        self.action_ids: list[str] = []

    async def check_calendar(self, payload: dict[str, Any], action_id: str) -> dict[str, Any]:
        self.action_ids.append(action_id)
        if len(self.action_ids) == 1:
            raise ConnectionError("temporary calendar outage")
        return await super().check_calendar(payload, action_id)


@pytest.mark.asyncio
async def test_retry_reuses_action_id_and_succeeds() -> None:
    tools = FlakyTools()
    engine, repository, _, _ = build_engine(tools=tools)
    mission = await engine.create_mission("Schedule a review with A", "owner-1")
    await engine.run_next(mission.id, "task-plan")

    with pytest.raises(RuntimeError, match="Retryable"):
        await engine.run_next(mission.id, "task-calendar")
    after_failure = await repository.get_mission(mission.id)
    assert after_failure and after_failure.current_step
    assert after_failure.current_step.status == StepStatus.PENDING

    recovered = await engine.run_next(mission.id, "task-calendar")
    assert recovered.status == MissionStatus.RUNNING
    assert tools.action_ids[0] == tools.action_ids[1]


class UnsafePlanner:
    async def plan(self, outcome: str, owner_id: str, mission_id: str) -> PlanResult:
        return PlanResult(
            summary="Unsafe plan",
            steps=[StepDraft(name="Book immediately", kind=StepKind.BOOK_AND_CONFIRM)],
        )


@pytest.mark.asyncio
async def test_engine_rejects_plan_that_bypasses_approval() -> None:
    engine, repository, _, _ = build_engine(planner=UnsafePlanner())
    mission = await engine.create_mission("Schedule a review with A", "owner-1")

    with pytest.raises(RuntimeError, match="Retryable"):
        await engine.run_next(mission.id, "task-plan")
    persisted = await repository.get_mission(mission.id)
    assert persisted and persisted.current_step
    assert persisted.current_step.status == StepStatus.PENDING


@pytest.mark.asyncio
async def test_run_next_is_idempotent_and_does_not_advance_waiting_mission() -> None:
    engine, repository, _, _ = build_engine()
    mission = await engine.create_mission("Schedule a review with A", "owner")
    planned = await engine.run_next(mission.id, "plan-once")
    duplicate = await engine.run_next(mission.id, "plan-once")
    assert duplicate.version == planned.version
    assert duplicate.current_step_index == planned.current_step_index

    await engine.run_next(mission.id, "calendar")
    await engine.run_next(mission.id, "contact")
    waiting = await engine.run_next(mission.id, "wait")
    unchanged = await engine.run_next(mission.id, "should-not-run")
    assert unchanged.status == MissionStatus.WAITING_EXTERNAL
    assert unchanged.version == waiting.version
    assert await repository.get_mission(mission.id) == unchanged


@pytest.mark.asyncio
async def test_run_next_completes_mission_with_no_steps() -> None:
    engine, repository, _, _ = build_engine()
    mission = Mission(outcome="Already done", owner_id="owner", steps=[])
    await repository.create_mission(mission)
    completed = await engine.run_next(mission.id, "task-empty")
    assert completed.status == MissionStatus.COMPLETED


@pytest.mark.asyncio
async def test_external_event_deduplication_and_invalid_states() -> None:
    engine, _, _, _ = build_engine()
    mission = await engine.create_mission("Schedule a review with A", "owner")
    with pytest.raises(InvalidTransition, match="not waiting"):
        await engine.resume_external(mission.id, event_id="early", payload={})

    await advance_to_external_wait(engine, mission.id)
    resumed = await engine.resume_external(
        mission.id,
        event_id="reply-1",
        payload={"selected_slot": "2026-08-18T10:00:00+07:00"},
    )
    duplicate = await engine.resume_external(
        mission.id,
        event_id="reply-1",
        payload={"selected_slot": "different"},
    )
    assert duplicate.version == resumed.version

    impossible = Mission(
        outcome="Broken state",
        owner_id="owner",
        status=MissionStatus.WAITING_EXTERNAL,
        steps=[MissionStep(name="Approval", kind=StepKind.APPROVAL, order=0)],
    )
    await engine.repository.create_mission(impossible)
    with pytest.raises(InvalidTransition, match="not an external wait"):
        await engine.resume_external(impossible.id, event_id="reply", payload={})


@pytest.mark.asyncio
async def test_missing_and_conflicting_approval_decisions() -> None:
    engine, repository, _, _ = build_engine()
    with pytest.raises(MissionNotFound, match="Approval"):
        await engine.decide_approval("missing", approved=True, decided_by="owner")

    mission = await engine.create_mission("Schedule a review with A", "owner")
    await advance_to_external_wait(engine, mission.id)
    await engine.resume_external(
        mission.id,
        event_id="reply",
        payload={"selected_slot": "2026-08-18T10:00:00+07:00"},
    )
    await engine.run_next(mission.id, "approval")
    approval = (await repository.list_approvals(status="PENDING"))[0]
    rejected = await engine.decide_approval(
        approval.id,
        approved=False,
        decided_by="owner",
    )
    assert rejected.status == MissionStatus.CANCELLED
    same_decision = await engine.decide_approval(
        approval.id,
        approved=False,
        decided_by="owner",
    )
    assert same_decision.status == MissionStatus.CANCELLED
    with pytest.raises(InvalidTransition, match="already rejected"):
        await engine.decide_approval(approval.id, approved=True, decided_by="owner")


class AlwaysFailTools(DemoWorkflowTools):
    async def check_calendar(self, payload: dict[str, Any], action_id: str) -> dict[str, Any]:
        raise ConnectionError("calendar unavailable")


@pytest.mark.asyncio
async def test_step_fails_after_retry_cap() -> None:
    engine, _, _, _ = build_engine(tools=AlwaysFailTools())
    mission = await engine.create_mission("Schedule a review with A", "owner")
    await engine.run_next(mission.id, "plan")
    with pytest.raises(RuntimeError, match="Retryable"):
        await engine.run_next(mission.id, "calendar-task")
    failed = await engine.run_next(mission.id, "calendar-task")
    assert failed.status == MissionStatus.FAILED
    assert failed.current_step.status == StepStatus.FAILED


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("usage_field", "cap_setting", "expected_message"),
    [
        ("model_calls", "max_model_calls", "model-call"),
        ("tool_calls", "max_tool_calls", "tool-call"),
    ],
)
async def test_call_caps_pause_before_execution(
    usage_field: str,
    cap_setting: str,
    expected_message: str,
) -> None:
    settings = make_settings(**{cap_setting: 1})
    engine, repository, _, _ = build_engine(settings=settings)
    mission = await engine.create_mission("Schedule a review with A", "owner")
    if usage_field == "model_calls":
        stored = await repository.get_mission(mission.id)
        setattr(stored.usage, usage_field, 1)
        await repository.save_mission(stored, stored.version)
        paused = await engine.run_next(mission.id, "capped")
    else:
        await engine.run_next(mission.id, "plan")
        stored = await repository.get_mission(mission.id)
        setattr(stored.usage, usage_field, 1)
        await repository.save_mission(stored, stored.version)
        paused = await engine.run_next(mission.id, "capped")
    assert paused.status == MissionStatus.PAUSED_BUDGET
    events = await repository.list_events(mission.id)
    assert expected_message in events[-1].message


class StaticPlanner:
    def __init__(self, steps: list[StepDraft]) -> None:
        self.steps = steps

    async def plan(self, outcome: str, owner_id: str, mission_id: str) -> PlanResult:
        return PlanResult(summary="Static", steps=self.steps)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("steps", "message"),
    [
        ([StepDraft(name="Nested", kind=StepKind.PLAN)], "nested planning"),
        ([StepDraft(name="Wait", kind=StepKind.WAIT_EXTERNAL)], "preceding"),
    ],
)
async def test_invalid_plan_shapes_are_retried(steps: list[StepDraft], message: str) -> None:
    engine, repository, _, _ = build_engine(planner=StaticPlanner(steps))
    mission = await engine.create_mission("Schedule a review with A", "owner")
    with pytest.raises(RuntimeError, match="Retryable"):
        await engine.run_next(mission.id, "bad-plan")
    persisted = await repository.get_mission(mission.id)
    assert message in persisted.current_step.last_error


@pytest.mark.asyncio
async def test_plan_step_cap_and_missing_tool_adapter() -> None:
    engine, _, _, _ = build_engine(settings=make_settings(max_workflow_steps=2))
    mission = await engine.create_mission("Schedule a review with A", "owner")
    with pytest.raises(RuntimeError, match="Retryable"):
        await engine.run_next(mission.id, "too-many")

    unsupported = Mission(
        outcome="Unsupported",
        owner_id="owner",
        status=MissionStatus.RUNNING,
        steps=[MissionStep(name="Wait", kind=StepKind.WAIT_EXTERNAL, order=0)],
    )
    with pytest.raises(InvalidTransition, match="No tool adapter"):
        await engine._run_tool_step(unsupported, unsupported.steps[0])


@pytest.mark.asyncio
async def test_private_helpers_handle_empty_context_caps_and_missing_mission() -> None:
    engine, _, _, _ = build_engine()
    empty = Mission(outcome="Done", owner_id="owner", steps=[])
    engine._complete_current_step(empty)
    assert empty.current_step_index == 0
    for index in range(55):
        engine._remember_task(empty, f"task-{index}")
    engine._remember_task(empty, "task-54")
    assert len(empty.processed_task_ids) == 50
    assert empty.processed_task_ids[-1] == "task-54"
    context = engine._mission_context(empty)
    assert context["OUTCOME"] == "Done"
    assert context["AUTHORITY"]["spend_limit_usd"] == 0.10
    assert "create_calendar_event" in context["AUTHORITY"]["approval_required_for"]
    engine._validate_plan([StepDraft(name="Check", kind=StepKind.CHECK_CALENDAR)])
    with pytest.raises(MissionNotFound):
        await engine._require_mission("missing")

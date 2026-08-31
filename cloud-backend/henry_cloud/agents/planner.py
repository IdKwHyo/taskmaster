from __future__ import annotations

import json

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from henry_cloud.agents.agent import root_agent
from henry_cloud.domain.models import AuthorityEnvelope, PlanResult, StepDraft, StepKind


class AdkMissionPlanner:
    """One bounded Gemini/ADK planning call per mission."""

    app_name = "henry_cloud"

    def __init__(self) -> None:
        self._sessions = InMemorySessionService()
        self._runner = Runner(
            agent=root_agent,
            app_name=self.app_name,
            session_service=self._sessions,
        )

    async def plan(self, outcome: str, owner_id: str, mission_id: str) -> PlanResult:
        session_id = f"plan-{mission_id}"
        await self._sessions.create_session(
            app_name=self.app_name,
            user_id=owner_id,
            session_id=session_id,
        )
        message = types.Content(
            role="user",
            parts=[types.Part(text=json.dumps({"outcome": outcome}))],
        )
        final_text: str | None = None
        input_tokens = 0
        output_tokens = 0
        async for event in self._runner.run_async(
            user_id=owner_id,
            session_id=session_id,
            new_message=message,
        ):
            usage = getattr(event, "usage_metadata", None)
            if usage:
                input_tokens += int(getattr(usage, "prompt_token_count", 0) or 0)
                output_tokens += int(getattr(usage, "candidates_token_count", 0) or 0)
                output_tokens += int(getattr(usage, "thoughts_token_count", 0) or 0)
            if event.is_final_response() and event.content and event.content.parts:
                final_text = event.content.parts[0].text
        if not final_text:
            raise RuntimeError("Google ADK returned no final mission plan")
        result = PlanResult.model_validate_json(final_text)
        result.input_tokens = input_tokens
        result.output_tokens = output_tokens
        return result


class DemoMissionPlanner:
    """Deterministic local planner; production uses AdkMissionPlanner."""

    async def plan(self, outcome: str, owner_id: str, mission_id: str) -> PlanResult:
        return PlanResult(
            summary="Coordinate availability, pause for the reply, then request approval to book.",
            authority=AuthorityEnvelope(
                allowed_actions=[
                    "inspect_calendar",
                    "contact_attendee_once",
                    "prepare_calendar_event",
                ],
                approval_required_for=["create_calendar_event"],
                forbidden_actions=[
                    "move_existing_commitments",
                    "contact_attendee_twice",
                ],
                spend_limit_usd=0.10,
                completion_contract=[
                    "calendar_event_created",
                    "event_read_back_matches_approved_slot",
                ],
            ),
            steps=[
                StepDraft(
                    name="Check owner's calendar",
                    kind=StepKind.CHECK_CALENDAR,
                    input={"window": "next_week", "duration_minutes": 30},
                ),
                StepDraft(
                    name="Ask attendee for availability",
                    kind=StepKind.CONTACT_ATTENDEE,
                    input={"attendee": "A", "duration_minutes": 30},
                ),
                StepDraft(name="Wait for attendee response", kind=StepKind.WAIT_EXTERNAL),
                StepDraft(name="Request owner approval", kind=StepKind.APPROVAL),
                StepDraft(name="Book event and confirm", kind=StepKind.BOOK_AND_CONFIRM),
            ],
        )

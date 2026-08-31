from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(UTC)


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:10]}"


class MissionStatus(StrEnum):
    PLANNING = "PLANNING"
    RUNNING = "RUNNING"
    WAITING_EXTERNAL = "WAITING_EXTERNAL"
    WAITING_APPROVAL = "WAITING_APPROVAL"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    PAUSED_BUDGET = "PAUSED_BUDGET"
    CANCELLED = "CANCELLED"


class StepStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    WAITING = "WAITING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


class StepKind(StrEnum):
    PLAN = "PLAN"
    CHECK_CALENDAR = "CHECK_CALENDAR"
    CONTACT_ATTENDEE = "CONTACT_ATTENDEE"
    WAIT_EXTERNAL = "WAIT_EXTERNAL"
    APPROVAL = "APPROVAL"
    BOOK_AND_CONFIRM = "BOOK_AND_CONFIRM"


class ApprovalStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class RiskLevel(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class StepDraft(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: StepKind
    input: dict[str, Any] = Field(default_factory=dict)


class AuthorityEnvelope(BaseModel):
    """The explicit boundary between delegated work and human judgment."""

    allowed_actions: list[str] = Field(
        default_factory=lambda: [
            "inspect_calendar",
            "contact_attendee_once",
            "prepare_calendar_event",
        ],
        max_length=12,
    )
    approval_required_for: list[str] = Field(
        default_factory=lambda: ["create_calendar_event"],
        max_length=12,
    )
    forbidden_actions: list[str] = Field(
        default_factory=lambda: ["move_existing_commitments", "contact_attendee_twice"],
        max_length=12,
    )
    spend_limit_usd: float = Field(default=0.10, gt=0, le=20)
    completion_contract: list[str] = Field(
        default_factory=lambda: [
            "calendar_event_created",
            "event_read_back_matches_approved_slot",
        ],
        min_length=1,
        max_length=12,
    )


class PlanResult(BaseModel):
    summary: str = Field(min_length=1, max_length=500)
    steps: list[StepDraft] = Field(min_length=1, max_length=7)
    authority: AuthorityEnvelope = Field(default_factory=AuthorityEnvelope)
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)


class MissionStep(BaseModel):
    id: str = Field(default_factory=lambda: new_id("step"))
    name: str
    kind: StepKind
    status: StepStatus = StepStatus.PENDING
    order: int
    attempts: int = 0
    idempotency_key: str = Field(default_factory=lambda: new_id("act"))
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    last_error: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None


class UsageLedger(BaseModel):
    model_calls: int = 0
    tool_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    estimated_model_cost_usd: float = 0.0


class Mission(BaseModel):
    id: str = Field(default_factory=lambda: new_id("m"))
    outcome: str = Field(min_length=3, max_length=1000)
    owner_id: str
    status: MissionStatus = MissionStatus.PLANNING
    summary: str | None = None
    authority: AuthorityEnvelope = Field(default_factory=AuthorityEnvelope)
    steps: list[MissionStep]
    current_step_index: int = 0
    usage: UsageLedger = Field(default_factory=UsageLedger)
    processed_task_ids: list[str] = Field(default_factory=list)
    version: int = 0
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    @property
    def current_step(self) -> MissionStep | None:
        if 0 <= self.current_step_index < len(self.steps):
            return self.steps[self.current_step_index]
        return None

    @property
    def terminal(self) -> bool:
        return self.status in {
            MissionStatus.COMPLETED,
            MissionStatus.FAILED,
            MissionStatus.CANCELLED,
        }


class Approval(BaseModel):
    id: str = Field(default_factory=lambda: new_id("ap"))
    mission_id: str
    step_id: str
    title: str
    description: str
    risk: RiskLevel = RiskLevel.MEDIUM
    proposed_action: dict[str, Any] = Field(default_factory=dict)
    status: ApprovalStatus = ApprovalStatus.PENDING
    decided_by: str | None = None
    decision_note: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    decided_at: datetime | None = None


class ExecutionEvent(BaseModel):
    id: str = Field(default_factory=lambda: new_id("evt"))
    mission_id: str
    event_type: str
    message: str
    step_id: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)

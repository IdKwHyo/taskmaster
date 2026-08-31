from typing import Any, Literal

from pydantic import BaseModel, Field


class CreateMissionRequest(BaseModel):
    outcome: str = Field(min_length=3, max_length=1000)
    owner_id: str = Field(default="demo-user", min_length=1, max_length=128)


class ExternalEventRequest(BaseModel):
    event_id: str = Field(min_length=1, max_length=200)
    payload: dict[str, Any] = Field(default_factory=dict)


class ApprovalDecisionRequest(BaseModel):
    decision: Literal["approve", "reject"]
    decided_by: str = Field(default="demo-user", min_length=1, max_length=128)
    note: str | None = Field(default=None, max_length=500)


class RunMissionTaskRequest(BaseModel):
    mission_id: str
    task_id: str


class MissionControlRequest(BaseModel):
    action: Literal["pause", "resume"]

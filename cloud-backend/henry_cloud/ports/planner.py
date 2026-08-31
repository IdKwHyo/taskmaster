from typing import Protocol

from henry_cloud.domain.models import PlanResult


class MissionPlanner(Protocol):
    async def plan(self, outcome: str, owner_id: str, mission_id: str) -> PlanResult: ...

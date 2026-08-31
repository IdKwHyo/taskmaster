from __future__ import annotations

import asyncio
from copy import deepcopy

from henry_cloud.domain.errors import VersionConflict
from henry_cloud.domain.models import Approval, ExecutionEvent, Mission, utc_now


class InMemoryMissionRepository:
    """Deterministic repository for tests and local UI integration."""

    def __init__(self) -> None:
        self._missions: dict[str, Mission] = {}
        self._events: dict[str, list[ExecutionEvent]] = {}
        self._approvals: dict[str, Approval] = {}
        self._lock = asyncio.Lock()

    async def create_mission(self, mission: Mission) -> Mission:
        async with self._lock:
            if mission.id in self._missions:
                raise VersionConflict(f"Mission {mission.id} already exists")
            self._missions[mission.id] = deepcopy(mission)
            return deepcopy(mission)

    async def get_mission(self, mission_id: str) -> Mission | None:
        async with self._lock:
            mission = self._missions.get(mission_id)
            return deepcopy(mission) if mission else None

    async def save_mission(self, mission: Mission, expected_version: int) -> Mission:
        async with self._lock:
            current = self._missions.get(mission.id)
            if current is None or current.version != expected_version:
                actual = None if current is None else current.version
                raise VersionConflict(
                    f"Mission {mission.id} expected version {expected_version}, got {actual}"
                )
            saved = mission.model_copy(deep=True)
            saved.version = expected_version + 1
            saved.updated_at = utc_now()
            self._missions[mission.id] = saved
            return deepcopy(saved)

    async def list_missions(self, owner_id: str | None = None, limit: int = 50) -> list[Mission]:
        async with self._lock:
            missions = list(self._missions.values())
            if owner_id is not None:
                missions = [mission for mission in missions if mission.owner_id == owner_id]
            missions.sort(key=lambda mission: mission.created_at, reverse=True)
            return deepcopy(missions[:limit])

    async def append_event(self, event: ExecutionEvent) -> None:
        async with self._lock:
            self._events.setdefault(event.mission_id, []).append(deepcopy(event))

    async def list_events(self, mission_id: str, limit: int = 100) -> list[ExecutionEvent]:
        async with self._lock:
            return deepcopy(self._events.get(mission_id, [])[-limit:])

    async def create_approval(self, approval: Approval) -> Approval:
        async with self._lock:
            existing = self._approvals.get(approval.id)
            if existing:
                return deepcopy(existing)
            self._approvals[approval.id] = deepcopy(approval)
            return deepcopy(approval)

    async def get_approval(self, approval_id: str) -> Approval | None:
        async with self._lock:
            approval = self._approvals.get(approval_id)
            return deepcopy(approval) if approval else None

    async def save_approval(self, approval: Approval) -> Approval:
        async with self._lock:
            self._approvals[approval.id] = deepcopy(approval)
            return deepcopy(approval)

    async def list_approvals(self, status: str | None = None, limit: int = 50) -> list[Approval]:
        async with self._lock:
            approvals = list(self._approvals.values())
            if status:
                approvals = [approval for approval in approvals if approval.status.value == status]
            approvals.sort(key=lambda approval: approval.created_at, reverse=True)
            return deepcopy(approvals[:limit])

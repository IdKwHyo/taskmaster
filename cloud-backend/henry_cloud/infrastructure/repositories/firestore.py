from __future__ import annotations

from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore
from google.cloud.firestore_v1.async_transaction import async_transactional

from henry_cloud.domain.errors import VersionConflict
from henry_cloud.domain.models import Approval, ExecutionEvent, Mission, utc_now


class FirestoreMissionRepository:
    """Firestore repository with optimistic concurrency for Cloud Tasks retries."""

    def __init__(self, project_id: str | None = None) -> None:
        self._client = firestore.AsyncClient(project=project_id)
        self._missions = self._client.collection("missions")
        self._approvals = self._client.collection("approvals")

    async def create_mission(self, mission: Mission) -> Mission:
        ref = self._missions.document(mission.id)
        await ref.create(mission.model_dump(mode="json"))
        return mission

    async def get_mission(self, mission_id: str) -> Mission | None:
        snapshot = await self._missions.document(mission_id).get()
        return Mission.model_validate(snapshot.to_dict()) if snapshot.exists else None

    async def save_mission(self, mission: Mission, expected_version: int) -> Mission:
        ref = self._missions.document(mission.id)
        transaction = self._client.transaction()

        @async_transactional
        async def commit(txn: firestore.AsyncTransaction) -> Mission:
            snapshot = await ref.get(transaction=txn)
            actual_version = snapshot.get("version") if snapshot.exists else None
            if actual_version != expected_version:
                raise VersionConflict(
                    f"Mission {mission.id} expected version {expected_version}, "
                    f"got {actual_version}"
                )
            saved = mission.model_copy(deep=True)
            saved.version = expected_version + 1
            saved.updated_at = utc_now()
            txn.set(ref, saved.model_dump(mode="json"))
            return saved

        return await commit(transaction)

    async def list_missions(self, owner_id: str | None = None, limit: int = 50) -> list[Mission]:
        query = self._missions.order_by("created_at", direction=firestore.Query.DESCENDING)
        if owner_id is not None:
            query = query.where("owner_id", "==", owner_id)
        snapshots = query.limit(limit).stream()
        return [Mission.model_validate(snapshot.to_dict()) async for snapshot in snapshots]

    async def append_event(self, event: ExecutionEvent) -> None:
        ref = self._missions.document(event.mission_id).collection("events").document(event.id)
        await ref.create(event.model_dump(mode="json"))

    async def list_events(self, mission_id: str, limit: int = 100) -> list[ExecutionEvent]:
        query = (
            self._missions.document(mission_id)
            .collection("events")
            .order_by("created_at")
            .limit(limit)
        )
        return [ExecutionEvent.model_validate(item.to_dict()) async for item in query.stream()]

    async def create_approval(self, approval: Approval) -> Approval:
        ref = self._approvals.document(approval.id)
        try:
            await ref.create(approval.model_dump(mode="json"))
            return approval
        except AlreadyExists:
            snapshot = await ref.get()
            return Approval.model_validate(snapshot.to_dict())

    async def get_approval(self, approval_id: str) -> Approval | None:
        snapshot = await self._approvals.document(approval_id).get()
        return Approval.model_validate(snapshot.to_dict()) if snapshot.exists else None

    async def save_approval(self, approval: Approval) -> Approval:
        await self._approvals.document(approval.id).set(approval.model_dump(mode="json"))
        return approval

    async def list_approvals(self, status: str | None = None, limit: int = 50) -> list[Approval]:
        query = self._approvals.order_by("created_at", direction=firestore.Query.DESCENDING)
        if status:
            query = query.where("status", "==", status)
        return [
            Approval.model_validate(item.to_dict()) async for item in query.limit(limit).stream()
        ]

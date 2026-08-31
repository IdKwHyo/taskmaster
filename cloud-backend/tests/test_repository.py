import pytest

from henry_cloud.domain.errors import VersionConflict
from henry_cloud.domain.models import (
    Approval,
    ApprovalStatus,
    ExecutionEvent,
    Mission,
    MissionStep,
    StepKind,
)
from henry_cloud.infrastructure.repositories.memory import InMemoryMissionRepository


@pytest.mark.asyncio
async def test_optimistic_version_blocks_stale_worker_write() -> None:
    repository = InMemoryMissionRepository()
    mission = Mission(
        outcome="Schedule a review",
        owner_id="owner-1",
        steps=[MissionStep(name="Plan", kind=StepKind.PLAN, order=0)],
    )
    await repository.create_mission(mission)
    worker_a = await repository.get_mission(mission.id)
    worker_b = await repository.get_mission(mission.id)
    assert worker_a and worker_b

    worker_a.summary = "Worker A won"
    saved = await repository.save_mission(worker_a, expected_version=0)
    assert saved.version == 1

    worker_b.summary = "Stale worker overwrote state"
    with pytest.raises(VersionConflict):
        await repository.save_mission(worker_b, expected_version=0)


@pytest.mark.asyncio
async def test_memory_repository_covers_lists_events_and_approvals() -> None:
    repository = InMemoryMissionRepository()
    mission_a = Mission(
        outcome="Schedule A",
        owner_id="owner-a",
        steps=[MissionStep(name="Plan", kind=StepKind.PLAN, order=0)],
    )
    mission_b = Mission(
        outcome="Schedule B",
        owner_id="owner-b",
        steps=[MissionStep(name="Plan", kind=StepKind.PLAN, order=0)],
    )
    await repository.create_mission(mission_a)
    await repository.create_mission(mission_b)

    with pytest.raises(VersionConflict):
        await repository.create_mission(mission_a)
    assert await repository.get_mission("missing") is None
    assert len(await repository.list_missions(limit=1)) == 1
    assert [item.id for item in await repository.list_missions("owner-a")] == [mission_a.id]

    event = ExecutionEvent(mission_id=mission_a.id, event_type="TEST", message="recorded")
    await repository.append_event(event)
    await repository.append_event(
        ExecutionEvent(mission_id=mission_a.id, event_type="TEST_2", message="recorded")
    )
    assert [item.event_type for item in await repository.list_events(mission_a.id, limit=1)] == [
        "TEST_2"
    ]
    assert await repository.list_events("missing") == []

    approval = Approval(
        mission_id=mission_a.id,
        step_id=mission_a.steps[0].id,
        title="Approve",
        description="Test approval",
    )
    assert (await repository.create_approval(approval)).id == approval.id
    assert (await repository.create_approval(approval)).id == approval.id
    assert await repository.get_approval("missing") is None
    approval.status = ApprovalStatus.APPROVED
    await repository.save_approval(approval)
    assert (await repository.get_approval(approval.id)).status == ApprovalStatus.APPROVED
    assert len(await repository.list_approvals(status="APPROVED")) == 1
    assert len(await repository.list_approvals()) == 1
    assert await repository.list_approvals(status="PENDING") == []

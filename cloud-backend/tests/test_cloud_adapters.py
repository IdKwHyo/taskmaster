from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from google.api_core.exceptions import AlreadyExists

from henry_cloud.agents import planner as planner_module
from henry_cloud.agents.planner import AdkMissionPlanner
from henry_cloud.domain.errors import VersionConflict
from henry_cloud.domain.models import (
    Approval,
    ExecutionEvent,
    Mission,
    MissionStep,
    StepKind,
)
from henry_cloud.infrastructure.repositories import firestore as firestore_module
from henry_cloud.infrastructure.repositories.firestore import FirestoreMissionRepository
from henry_cloud.infrastructure.tasks import cloud_tasks as cloud_tasks_module
from henry_cloud.infrastructure.tasks.cloud_tasks import CloudTasksDispatcher


class Snapshot:
    def __init__(self, data: dict | None = None, *, exists: bool = True) -> None:
        self._data = data or {}
        self.exists = exists

    def to_dict(self) -> dict:
        return self._data

    def get(self, key: str):
        return self._data[key]


class Query:
    def __init__(self, snapshots: list[Snapshot]) -> None:
        self.snapshots = snapshots
        self.where_calls: list[tuple] = []
        self.limit_value: int | None = None

    def order_by(self, *args, **kwargs):
        return self

    def where(self, *args):
        self.where_calls.append(args)
        return self

    def limit(self, value: int):
        self.limit_value = value
        return self

    def stream(self):
        async def generate():
            for snapshot in self.snapshots:
                yield snapshot

        return generate()


def mission() -> Mission:
    return Mission(
        outcome="Coordinate a review",
        owner_id="owner",
        steps=[MissionStep(name="Plan", kind=StepKind.PLAN, order=0)],
    )


def test_firestore_repository_initializes_collections(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Mock()
    monkeypatch.setattr(firestore_module.firestore, "AsyncClient", Mock(return_value=client))
    repository = FirestoreMissionRepository("project-1")
    assert repository._client is client
    assert client.collection.call_args_list[0].args == ("missions",)
    assert client.collection.call_args_list[1].args == ("approvals",)


@pytest.mark.asyncio
async def test_firestore_mission_create_get_save_and_conflict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item = mission()
    ref = Mock()
    ref.create = AsyncMock()
    ref.get = AsyncMock(return_value=Snapshot(item.model_dump(mode="json")))
    collection = Mock()
    collection.document.return_value = ref
    transaction = Mock()
    client = Mock()
    client.transaction.return_value = transaction

    repository = object.__new__(FirestoreMissionRepository)
    repository._missions = collection
    repository._client = client

    assert await repository.create_mission(item) is item
    ref.create.assert_awaited_once()
    assert (await repository.get_mission(item.id)).id == item.id

    monkeypatch.setattr(firestore_module, "async_transactional", lambda function: function)
    saved = await repository.save_mission(item, expected_version=0)
    assert saved.version == 1
    transaction.set.assert_called_once()

    ref.get = AsyncMock(return_value=Snapshot({"version": 9}))
    with pytest.raises(VersionConflict, match="got 9"):
        await repository.save_mission(item, expected_version=0)

    ref.get = AsyncMock(return_value=Snapshot(exists=False))
    assert await repository.get_mission("missing") is None


@pytest.mark.asyncio
async def test_firestore_lists_events_and_approvals() -> None:
    item = mission()
    approval = Approval(
        mission_id=item.id,
        step_id=item.steps[0].id,
        title="Approve",
        description="Boundary",
    )
    event = ExecutionEvent(mission_id=item.id, event_type="TEST", message="Recorded")

    mission_query = Query([Snapshot(item.model_dump(mode="json"))])
    event_query = Query([Snapshot(event.model_dump(mode="json"))])
    event_ref = Mock()
    event_ref.create = AsyncMock()
    event_collection = Mock()
    event_collection.document.return_value = event_ref
    event_collection.order_by.return_value = event_query
    mission_ref = Mock()
    mission_ref.collection.return_value = event_collection
    missions = Mock()
    missions.order_by.return_value = mission_query
    missions.document.return_value = mission_ref

    approval_query = Query([Snapshot(approval.model_dump(mode="json"))])
    approval_ref = Mock()
    approval_ref.create = AsyncMock()
    approval_ref.get = AsyncMock(return_value=Snapshot(approval.model_dump(mode="json")))
    approval_ref.set = AsyncMock()
    approvals = Mock()
    approvals.document.return_value = approval_ref
    approvals.order_by.return_value = approval_query

    repository = object.__new__(FirestoreMissionRepository)
    repository._missions = missions
    repository._approvals = approvals

    listed = await repository.list_missions(owner_id="owner", limit=3)
    assert listed[0].id == item.id
    assert mission_query.where_calls == [("owner_id", "==", "owner")]
    assert mission_query.limit_value == 3
    assert (await repository.list_missions(limit=1))[0].id == item.id

    await repository.append_event(event)
    event_ref.create.assert_awaited_once()
    assert (await repository.list_events(item.id, limit=4))[0].event_type == "TEST"
    assert event_query.limit_value == 4

    assert await repository.create_approval(approval) is approval
    assert (await repository.get_approval(approval.id)).id == approval.id
    assert await repository.save_approval(approval) is approval
    approval_ref.set.assert_awaited_once()
    assert (await repository.list_approvals(status="PENDING", limit=2))[0].id == approval.id
    assert approval_query.where_calls == [("status", "==", "PENDING")]
    assert (await repository.list_approvals(limit=1))[0].id == approval.id

    approval_ref.get = AsyncMock(return_value=Snapshot(exists=False))
    assert await repository.get_approval("missing") is None


@pytest.mark.asyncio
async def test_firestore_create_approval_is_idempotent() -> None:
    item = mission()
    approval = Approval(
        mission_id=item.id,
        step_id=item.steps[0].id,
        title="Approve",
        description="Boundary",
    )
    ref = Mock()
    ref.create = AsyncMock(side_effect=AlreadyExists("exists"))
    ref.get = AsyncMock(return_value=Snapshot(approval.model_dump(mode="json")))
    approvals = Mock()
    approvals.document.return_value = ref
    repository = object.__new__(FirestoreMissionRepository)
    repository._approvals = approvals

    existing = await repository.create_approval(approval)
    assert existing.id == approval.id
    ref.get.assert_awaited_once()


@pytest.mark.asyncio
async def test_cloud_tasks_builds_authenticated_immediate_and_delayed_tasks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = Mock()
    client.queue_path.return_value = "projects/p/locations/r/queues/q"
    client.create_task.return_value = object()
    monkeypatch.setattr(cloud_tasks_module.tasks_v2, "CloudTasksClient", Mock(return_value=client))
    dispatcher = CloudTasksDispatcher(
        project_id="p",
        region="r",
        queue="q",
        service_url="https://worker.example/",
        service_account_email="runtime@example.iam.gserviceaccount.com",
    )
    assert dispatcher._service_url == "https://worker.example"

    task_id = await dispatcher.dispatch("m-1", task_id="task-known")
    assert task_id == "task-known"
    request = client.create_task.call_args.args[0]
    assert request.task.name.endswith("/tasks/task-known")
    assert request.task.http_request.url.endswith("/internal/tasks/run-mission")
    assert json.loads(request.task.http_request.body) == {
        "mission_id": "m-1",
        "task_id": "task-known",
    }
    assert request.task.http_request.oidc_token.audience == "https://worker.example"
    assert "schedule_time" not in request.task

    generated = await dispatcher.dispatch("m-2", delay_seconds=5)
    assert generated.startswith("task-")
    delayed = client.create_task.call_args.args[0].task
    assert "schedule_time" in delayed


class Event:
    def __init__(self, *, final: bool, text: str | None = None, usage=None) -> None:
        self.usage_metadata = usage
        self.content = (
            SimpleNamespace(parts=[SimpleNamespace(text=text)]) if text is not None else None
        )
        self._final = final

    def is_final_response(self) -> bool:
        return self._final


class RunnerStream:
    def __init__(self, events: list[Event]) -> None:
        self.events = events

    def run_async(self, **kwargs):
        async def generate():
            for event in self.events:
                yield event

        return generate()


def test_adk_planner_initializes_google_runner(monkeypatch: pytest.MonkeyPatch) -> None:
    sessions = object()
    runner = object()
    monkeypatch.setattr(planner_module, "InMemorySessionService", Mock(return_value=sessions))
    runner_factory = Mock(return_value=runner)
    monkeypatch.setattr(planner_module, "Runner", runner_factory)
    planner = AdkMissionPlanner()
    assert planner._sessions is sessions
    assert planner._runner is runner
    assert runner_factory.call_args.kwargs["app_name"] == "henry_cloud"


@pytest.mark.asyncio
async def test_adk_planner_parses_plan_and_usage() -> None:
    plan_json = json.dumps(
        {
            "summary": "Safe plan",
            "steps": [{"name": "Check", "kind": "CHECK_CALENDAR", "input": {}}],
        }
    )
    usage = SimpleNamespace(
        prompt_token_count=20,
        candidates_token_count=10,
        thoughts_token_count=5,
    )
    planner = object.__new__(AdkMissionPlanner)
    planner._sessions = SimpleNamespace(create_session=AsyncMock())
    planner._runner = RunnerStream(
        [Event(final=False, usage=usage), Event(final=True, text=plan_json)]
    )
    result = await planner.plan("Coordinate", "owner", "m-1")
    assert result.summary == "Safe plan"
    assert result.input_tokens == 20
    assert result.output_tokens == 15
    planner._sessions.create_session.assert_awaited_once()


@pytest.mark.asyncio
async def test_adk_planner_rejects_missing_final_response() -> None:
    planner = object.__new__(AdkMissionPlanner)
    planner._sessions = SimpleNamespace(create_session=AsyncMock())
    planner._runner = RunnerStream([Event(final=False)])
    with pytest.raises(RuntimeError, match="no final mission plan"):
        await planner.plan("Coordinate", "owner", "m-1")

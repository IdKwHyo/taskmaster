from __future__ import annotations

import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from henry_cloud.agents.planner import DemoMissionPlanner
from henry_cloud.api import auth as auth_module
from henry_cloud.api.auth import require_write_auth
from henry_cloud.api.routes import _http_error
from henry_cloud.config import Settings
from henry_cloud.container import Container, get_container
from henry_cloud.domain.errors import InvalidTransition, MissionNotFound, VersionConflict
from henry_cloud.infrastructure.repositories.memory import InMemoryMissionRepository
from henry_cloud.infrastructure.tasks.local import LocalDispatcher
from henry_cloud.infrastructure.tools.demo import DemoWorkflowTools
from henry_cloud.main import app
from henry_cloud.services.workflow_engine import WorkflowEngine


def api_container() -> Container:
    settings = Settings.model_construct(
        dispatcher="local",
        model="gemini-3.5-flash",
        daily_soft_limit_usd=2.0,
        total_budget_usd=20.0,
        max_workflow_steps=8,
        max_model_calls=6,
        max_tool_calls=12,
        max_retries_per_step=2,
        max_workflow_cost_usd=0.25,
        model_input_usd_per_million=1.50,
        model_output_usd_per_million=9.00,
    )
    repository = InMemoryMissionRepository()
    dispatcher = LocalDispatcher()
    planner = DemoMissionPlanner()
    tools = DemoWorkflowTools()
    engine = WorkflowEngine(
        repository=repository,
        dispatcher=dispatcher,
        planner=planner,
        tools=tools,
        settings=settings,
    )
    dispatcher.bind(engine.run_next)
    return Container(settings, repository, dispatcher, planner, tools, engine)


def wait_for_status(client: TestClient, mission_id: str, expected: str) -> dict:
    for _ in range(100):
        mission = client.get(f"/api/v1/missions/{mission_id}").json()
        if mission["status"] == expected:
            return mission
        time.sleep(0.01)
    raise AssertionError(f"Mission did not reach {expected}")


def test_dashboard_api_runs_full_async_mission() -> None:
    container = api_container()
    app.dependency_overrides[get_container] = lambda: container
    try:
        with TestClient(app) as client:
            assert client.get("/healthz").json()["status"] == "ok"
            created = client.post(
                "/api/v1/missions",
                json={
                    "outcome": "Coordinate a 30-minute project review with A next week",
                    "owner_id": "judge-demo",
                },
            )
            assert created.status_code == 202
            mission_id = created.json()["id"]
            wait_for_status(client, mission_id, "WAITING_EXTERNAL")
            assert len(client.get("/api/v1/missions").json()["missions"]) == 1
            assert len(client.get(f"/api/v1/missions/{mission_id}/events").json()["events"]) >= 1
            assert client.get("/api/v1/admin/summary").json()["active"] == 1
            assert client.get("/api/v1/admin/costs").json()["total_budget_usd"] == 20.0

            response = client.post(
                f"/api/v1/missions/{mission_id}/external-events",
                json={
                    "event_id": "discord-reply-1",
                    "payload": {
                        "attendee": "A",
                        "selected_slot": "2026-08-18T10:00:00+07:00",
                    },
                },
            )
            assert response.status_code == 200
            wait_for_status(client, mission_id, "WAITING_APPROVAL")

            approvals = client.get("/api/v1/approvals?status=PENDING").json()["approvals"]
            assert len(approvals) == 1
            decision = client.post(
                f"/api/v1/approvals/{approvals[0]['id']}/decision",
                json={"decision": "approve", "decided_by": "judge-demo"},
            )
            assert decision.status_code == 200
            completed = wait_for_status(client, mission_id, "COMPLETED")
            assert completed["usage"]["tool_calls"] == 3
    finally:
        app.dependency_overrides.clear()


def test_api_not_found_validation_and_internal_task_protection() -> None:
    container = api_container()
    app.dependency_overrides[get_container] = lambda: container
    try:
        with TestClient(app) as client:
            assert client.get("/api/v1/missions/missing").status_code == 404
            assert client.get("/api/v1/missions/missing/events").status_code == 404
            assert client.post("/api/v1/missions", json={"outcome": "x"}).status_code == 422
            assert (
                client.post(
                    "/api/v1/missions/missing/external-events",
                    json={"event_id": "event-1", "payload": {}},
                ).status_code
                == 404
            )
            assert (
                client.post(
                    "/api/v1/approvals/missing/decision",
                    json={"decision": "approve"},
                ).status_code
                == 404
            )
            assert (
                client.post(
                    "/api/v1/missions/missing/control",
                    json={"action": "pause"},
                ).status_code
                == 404
            )

            container.settings.dispatcher = "cloud_tasks"
            task_body = {"mission_id": "missing", "task_id": "task-1"}
            assert client.post("/internal/tasks/run-mission", json=task_body).status_code == 403
            assert (
                client.post(
                    "/internal/tasks/run-mission",
                    json=task_body,
                    headers={"X-Cloudtasks-Taskname": "queue/task-1"},
                ).status_code
                == 404
            )
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_write_auth_disabled_valid_and_invalid(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_module, "get_settings", lambda: SimpleNamespace(api_key=""))
    assert await require_write_auth(None) is None

    monkeypatch.setattr(auth_module, "get_settings", lambda: SimpleNamespace(api_key="secret"))
    assert await require_write_auth("Bearer secret") is None
    with pytest.raises(HTTPException) as missing:
        await require_write_auth(None)
    assert missing.value.status_code == 401
    with pytest.raises(HTTPException):
        await require_write_auth("Basic secret")


def test_http_error_mapping() -> None:
    assert _http_error(MissionNotFound("missing")).status_code == 404
    assert _http_error(InvalidTransition("bad state")).status_code == 409
    assert _http_error(VersionConflict("stale")).status_code == 409
    generic = _http_error(RuntimeError("secret detail"))
    assert generic.status_code == 500
    assert generic.detail == "Mission execution failed"

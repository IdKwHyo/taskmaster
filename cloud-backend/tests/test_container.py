from unittest.mock import Mock

import pytest

from henry_cloud import container as container_module
from henry_cloud.agents.planner import DemoMissionPlanner
from henry_cloud.config import Settings
from henry_cloud.infrastructure.repositories.memory import InMemoryMissionRepository
from henry_cloud.infrastructure.tasks.local import LocalDispatcher
from henry_cloud.infrastructure.tools.demo import DemoWorkflowTools


def settings(**updates) -> Settings:
    values = {
        "repository": "memory",
        "dispatcher": "local",
        "planner_mode": "demo",
        "tool_mode": "demo",
        "project_id": "",
        "cloud_region": "asia-southeast1",
        "task_queue": "henry-workflows",
        "service_url": "",
        "task_service_account": "",
        "max_workflow_steps": 8,
        "max_model_calls": 6,
        "max_tool_calls": 12,
        "max_retries_per_step": 2,
        "max_workflow_cost_usd": 0.25,
        "model_input_usd_per_million": 1.5,
        "model_output_usd_per_million": 9.0,
    }
    values.update(updates)
    return Settings.model_construct(**values)


def test_require_rejects_empty_and_returns_value() -> None:
    assert container_module._require("value", "NAME") == "value"
    with pytest.raises(ValueError, match="NAME is required"):
        container_module._require("", "NAME")


def test_container_builds_local_demo_stack(monkeypatch: pytest.MonkeyPatch) -> None:
    container_module.get_container.cache_clear()
    monkeypatch.setattr(container_module, "get_settings", lambda: settings())
    built = container_module.get_container()
    assert isinstance(built.repository, InMemoryMissionRepository)
    assert isinstance(built.dispatcher, LocalDispatcher)
    assert isinstance(built.planner, DemoMissionPlanner)
    assert isinstance(built.tools, DemoWorkflowTools)
    assert built.dispatcher._handler == built.engine.run_next
    assert container_module.get_container() is built
    container_module.get_container.cache_clear()


def test_container_selects_all_production_adapters(monkeypatch: pytest.MonkeyPatch) -> None:
    container_module.get_container.cache_clear()
    production = settings(
        repository="firestore",
        dispatcher="cloud_tasks",
        planner_mode="adk",
        tool_mode="live",
        project_id="project-1",
        service_url="https://worker.example",
        task_service_account="runtime@example.iam.gserviceaccount.com",
    )
    repository = object()
    dispatcher = object()
    planner = object()
    tools = object()
    engine = object()
    monkeypatch.setattr(container_module, "get_settings", lambda: production)
    firestore_factory = Mock(return_value=repository)
    tasks_factory = Mock(return_value=dispatcher)
    planner_factory = Mock(return_value=planner)
    tools_factory = Mock(return_value=tools)
    engine_factory = Mock(return_value=engine)
    monkeypatch.setattr(container_module, "FirestoreMissionRepository", firestore_factory)
    monkeypatch.setattr(container_module, "CloudTasksDispatcher", tasks_factory)
    monkeypatch.setattr(container_module, "AdkMissionPlanner", planner_factory)
    monkeypatch.setattr(container_module, "CalendarDiscordWorkflowTools", tools_factory)
    monkeypatch.setattr(container_module, "WorkflowEngine", engine_factory)

    built = container_module.get_container()
    assert (built.repository, built.dispatcher, built.planner, built.tools, built.engine) == (
        repository,
        dispatcher,
        planner,
        tools,
        engine,
    )
    firestore_factory.assert_called_once_with("project-1")
    assert tasks_factory.call_args.kwargs["service_url"] == "https://worker.example"
    tools_factory.assert_called_once_with(production)
    container_module.get_container.cache_clear()


def test_container_fails_fast_when_cloud_task_settings_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    container_module.get_container.cache_clear()
    monkeypatch.setattr(
        container_module,
        "get_settings",
        lambda: settings(dispatcher="cloud_tasks", project_id=""),
    )
    with pytest.raises(ValueError, match="GOOGLE_CLOUD_PROJECT"):
        container_module.get_container()
    container_module.get_container.cache_clear()

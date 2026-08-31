from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from henry_cloud.agents.planner import AdkMissionPlanner, DemoMissionPlanner
from henry_cloud.config import Settings, get_settings
from henry_cloud.infrastructure.repositories.firestore import FirestoreMissionRepository
from henry_cloud.infrastructure.repositories.memory import InMemoryMissionRepository
from henry_cloud.infrastructure.tasks.cloud_tasks import CloudTasksDispatcher
from henry_cloud.infrastructure.tasks.local import LocalDispatcher
from henry_cloud.infrastructure.tools.demo import DemoWorkflowTools
from henry_cloud.infrastructure.tools.google_discord import CalendarDiscordWorkflowTools
from henry_cloud.ports.dispatcher import WorkflowDispatcher
from henry_cloud.ports.planner import MissionPlanner
from henry_cloud.ports.repository import MissionRepository
from henry_cloud.ports.tools import WorkflowTools
from henry_cloud.services.workflow_engine import WorkflowEngine


@dataclass(frozen=True)
class Container:
    settings: Settings
    repository: MissionRepository
    dispatcher: WorkflowDispatcher
    planner: MissionPlanner
    tools: WorkflowTools
    engine: WorkflowEngine


def _require(value: str, name: str) -> str:
    if not value:
        raise ValueError(f"{name} is required for this production adapter")
    return value


@lru_cache
def get_container() -> Container:
    settings = get_settings()
    repository: MissionRepository = (
        FirestoreMissionRepository(settings.project_id or None)
        if settings.repository == "firestore"
        else InMemoryMissionRepository()
    )
    if settings.dispatcher == "cloud_tasks":
        dispatcher: WorkflowDispatcher = CloudTasksDispatcher(
            project_id=_require(settings.project_id, "GOOGLE_CLOUD_PROJECT"),
            region=settings.cloud_region,
            queue=settings.task_queue,
            service_url=_require(settings.service_url, "HENRY_SERVICE_URL"),
            service_account_email=_require(
                settings.task_service_account, "HENRY_TASK_SERVICE_ACCOUNT"
            ),
        )
    else:
        dispatcher = LocalDispatcher()
    planner: MissionPlanner = (
        DemoMissionPlanner() if settings.planner_mode == "demo" else AdkMissionPlanner()
    )
    if settings.tool_mode == "live":
        tools: WorkflowTools = CalendarDiscordWorkflowTools(settings)
    elif settings.tool_mode == "calendar":
        tools = CalendarDiscordWorkflowTools(settings, discord_enabled=False)
    else:
        tools = DemoWorkflowTools()
    engine = WorkflowEngine(
        repository=repository,
        dispatcher=dispatcher,
        planner=planner,
        tools=tools,
        settings=settings,
    )
    if isinstance(dispatcher, LocalDispatcher):
        dispatcher.bind(engine.run_next)
    return Container(settings, repository, dispatcher, planner, tools, engine)


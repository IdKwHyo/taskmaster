from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status

from henry_cloud.api.auth import require_write_auth
from henry_cloud.api.schemas import (
    ApprovalDecisionRequest,
    CreateMissionRequest,
    ExternalEventRequest,
    MissionControlRequest,
    RunMissionTaskRequest,
)
from henry_cloud.container import Container, get_container
from henry_cloud.domain.errors import InvalidTransition, MissionNotFound, VersionConflict
from henry_cloud.domain.models import MissionStatus

router = APIRouter(prefix="/api/v1")
internal_router = APIRouter(prefix="/internal/tasks")


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, MissionNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, (InvalidTransition, VersionConflict)):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=500, detail="Mission execution failed")


@router.post(
    "/missions",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_write_auth)],
)
async def create_mission(
    request: CreateMissionRequest,
    container: Container = Depends(get_container),
):
    return await container.engine.create_mission(request.outcome, request.owner_id)


@router.get("/missions")
async def list_missions(
    owner_id: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    container: Container = Depends(get_container),
):
    return {"missions": await container.repository.list_missions(owner_id, limit)}


@router.get("/missions/{mission_id}")
async def get_mission(mission_id: str, container: Container = Depends(get_container)):
    mission = await container.repository.get_mission(mission_id)
    if mission is None:
        raise HTTPException(status_code=404, detail="Mission not found")
    return mission


@router.post(
    "/missions/{mission_id}/control",
    dependencies=[Depends(require_write_auth)],
)
async def control_mission(
    mission_id: str,
    request: MissionControlRequest,
    container: Container = Depends(get_container),
):
    try:
        if request.action == "pause":
            return await container.engine.pause(mission_id)
        return await container.engine.resume(mission_id)
    except (MissionNotFound, InvalidTransition, VersionConflict) as exc:
        raise _http_error(exc) from exc


@router.get("/missions/{mission_id}/events")
async def list_mission_events(
    mission_id: str,
    limit: int = Query(default=100, ge=1, le=250),
    container: Container = Depends(get_container),
):
    if await container.repository.get_mission(mission_id) is None:
        raise HTTPException(status_code=404, detail="Mission not found")
    return {"events": await container.repository.list_events(mission_id, limit)}


@router.post(
    "/missions/{mission_id}/external-events",
    dependencies=[Depends(require_write_auth)],
)
async def resume_external_event(
    mission_id: str,
    request: ExternalEventRequest,
    container: Container = Depends(get_container),
):
    try:
        return await container.engine.resume_external(
            mission_id,
            event_id=request.event_id,
            payload=request.payload,
        )
    except (MissionNotFound, InvalidTransition, VersionConflict) as exc:
        raise _http_error(exc) from exc


@router.get("/approvals")
async def list_approvals(
    approval_status: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=100),
    container: Container = Depends(get_container),
):
    return {"approvals": await container.repository.list_approvals(approval_status, limit)}


@router.post(
    "/approvals/{approval_id}/decision",
    dependencies=[Depends(require_write_auth)],
)
async def decide_approval(
    approval_id: str,
    request: ApprovalDecisionRequest,
    container: Container = Depends(get_container),
):
    try:
        return await container.engine.decide_approval(
            approval_id,
            approved=request.decision == "approve",
            decided_by=request.decided_by,
            note=request.note,
        )
    except (MissionNotFound, InvalidTransition, VersionConflict) as exc:
        raise _http_error(exc) from exc


@router.get("/admin/summary")
async def admin_summary(container: Container = Depends(get_container)):
    missions = await container.repository.list_missions(limit=100)
    counts = {status.value: 0 for status in MissionStatus}
    for mission in missions:
        counts[mission.status.value] += 1
    return {
        "counts": counts,
        "active": sum(
            counts[state]
            for state in (
                "PLANNING",
                "RUNNING",
                "WAITING_EXTERNAL",
                "WAITING_APPROVAL",
                "PAUSED",
            )
        ),
        "step_cap": container.settings.max_workflow_steps,
        "model_call_cap": container.settings.max_model_calls,
        "tool_call_cap": container.settings.max_tool_calls,
    }


@router.get("/admin/costs")
async def admin_costs(container: Container = Depends(get_container)):
    missions = await container.repository.list_missions(limit=100)
    today = datetime.now(UTC).date()
    today_missions = [mission for mission in missions if mission.created_at.date() == today]
    today_model_cost = round(
        sum(mission.usage.estimated_model_cost_usd for mission in today_missions), 4
    )
    return {
        "date": today.isoformat(),
        "model_estimated_usd": today_model_cost,
        "model_calls": sum(mission.usage.model_calls for mission in today_missions),
        "input_tokens": sum(mission.usage.input_tokens for mission in today_missions),
        "output_tokens": sum(mission.usage.output_tokens for mission in today_missions),
        "estimated_monthly_model_usd": round(today_model_cost * 30, 2),
        "daily_soft_limit_usd": container.settings.daily_soft_limit_usd,
        "total_budget_usd": container.settings.total_budget_usd,
        "method": "workflow token ledger; Cloud Run and Firestore billing excluded",
    }


@internal_router.post("/run-mission")
async def run_mission_task(
    request: RunMissionTaskRequest,
    x_cloudtasks_taskname: str | None = Header(default=None),
    container: Container = Depends(get_container),
):
    if container.settings.dispatcher == "cloud_tasks" and not x_cloudtasks_taskname:
        raise HTTPException(status_code=403, detail="Cloud Tasks request header required")
    try:
        return await container.engine.run_next(request.mission_id, request.task_id)
    except (MissionNotFound, InvalidTransition, VersionConflict) as exc:
        raise _http_error(exc) from exc

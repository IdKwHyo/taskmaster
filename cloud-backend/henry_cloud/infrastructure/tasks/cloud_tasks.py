from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta

from google.cloud import tasks_v2
from google.protobuf import timestamp_pb2

from henry_cloud.domain.models import new_id


class CloudTasksDispatcher:
    def __init__(
        self,
        *,
        project_id: str,
        region: str,
        queue: str,
        service_url: str,
        service_account_email: str,
    ) -> None:
        self._client = tasks_v2.CloudTasksClient()
        self._parent = self._client.queue_path(project_id, region, queue)
        self._service_url = service_url.rstrip("/")
        self._service_account_email = service_account_email

    async def dispatch(
        self,
        mission_id: str,
        *,
        delay_seconds: int = 0,
        task_id: str | None = None,
    ) -> str:
        resolved_id = task_id or new_id("task")
        body = json.dumps({"mission_id": mission_id, "task_id": resolved_id}).encode()
        task = tasks_v2.Task(
            name=f"{self._parent}/tasks/{resolved_id}",
            http_request=tasks_v2.HttpRequest(
                http_method=tasks_v2.HttpMethod.POST,
                url=f"{self._service_url}/internal/tasks/run-mission",
                headers={"Content-Type": "application/json"},
                oidc_token=tasks_v2.OidcToken(
                    service_account_email=self._service_account_email,
                    audience=self._service_url,
                ),
                body=body,
            ),
        )
        if delay_seconds > 0:
            scheduled = timestamp_pb2.Timestamp()
            scheduled.FromDatetime(datetime.now(UTC) + timedelta(seconds=delay_seconds))
            task.schedule_time = scheduled
        await asyncio.to_thread(
            self._client.create_task,
            tasks_v2.CreateTaskRequest(parent=self._parent, task=task),
        )
        return resolved_id

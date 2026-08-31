from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

from henry_cloud.domain.models import new_id


class LocalDispatcher:
    """Records dispatches; API tests or a local runner decide when to execute them."""

    def __init__(self) -> None:
        self.pending: list[tuple[str, str, int]] = []
        self._handler: Callable[[str, str], Awaitable[object]] | None = None

    def bind(self, handler: Callable[[str, str], Awaitable[object]]) -> None:
        self._handler = handler

    async def dispatch(
        self,
        mission_id: str,
        *,
        delay_seconds: int = 0,
        task_id: str | None = None,
    ) -> str:
        resolved_id = task_id or new_id("task")
        self.pending.append((mission_id, resolved_id, delay_seconds))
        if self._handler:
            loop = asyncio.get_running_loop()

            def launch() -> None:
                task = asyncio.create_task(self._handler(mission_id, resolved_id))
                task.add_done_callback(self._consume_result)

            if delay_seconds:
                loop.call_later(delay_seconds, launch)
            else:
                loop.call_soon(launch)
        return resolved_id

    @staticmethod
    def _consume_result(task: asyncio.Task[object]) -> None:
        try:
            task.result()
        except Exception:
            # Local mode has no retry service; the engine has already persisted the failure.
            pass


class InlineDispatcher:
    """Convenience dispatcher for local demos; never use it in Cloud Run production."""

    def __init__(self, handler: Callable[[str, str], Awaitable[object]]) -> None:
        self._handler = handler

    async def dispatch(
        self,
        mission_id: str,
        *,
        delay_seconds: int = 0,
        task_id: str | None = None,
    ) -> str:
        resolved_id = task_id or new_id("task")
        if delay_seconds:
            raise ValueError("InlineDispatcher does not support delayed work")
        await self._handler(mission_id, resolved_id)
        return resolved_id

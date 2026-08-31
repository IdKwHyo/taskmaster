from typing import Protocol


class WorkflowDispatcher(Protocol):
    async def dispatch(
        self,
        mission_id: str,
        *,
        delay_seconds: int = 0,
        task_id: str | None = None,
    ) -> str: ...

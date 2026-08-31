import asyncio
from unittest.mock import AsyncMock, Mock

import pytest

from henry_cloud.infrastructure.tasks.local import InlineDispatcher, LocalDispatcher


@pytest.mark.asyncio
async def test_local_dispatcher_records_unbound_work() -> None:
    dispatcher = LocalDispatcher()
    task_id = await dispatcher.dispatch("m-1", task_id="known", delay_seconds=2)
    assert task_id == "known"
    assert dispatcher.pending == [("m-1", "known", 2)]


@pytest.mark.asyncio
async def test_local_dispatcher_runs_immediate_and_delayed_handlers() -> None:
    dispatcher = LocalDispatcher()
    handler = AsyncMock(return_value=None)
    dispatcher.bind(handler)

    generated = await dispatcher.dispatch("m-now")
    assert generated.startswith("task-")
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    handler.assert_awaited_once_with("m-now", generated)

    await dispatcher.dispatch("m-later", task_id="later", delay_seconds=0.001)
    await asyncio.sleep(0.01)
    handler.assert_awaited_with("m-later", "later")


def test_local_dispatcher_consumes_background_errors() -> None:
    failed = Mock()
    failed.result.side_effect = RuntimeError("persisted")
    LocalDispatcher._consume_result(failed)
    failed.result.assert_called_once()


@pytest.mark.asyncio
async def test_inline_dispatcher_calls_handler_and_rejects_delay() -> None:
    handler = AsyncMock(return_value=None)
    dispatcher = InlineDispatcher(handler)
    generated = await dispatcher.dispatch("m-1")
    handler.assert_awaited_once_with("m-1", generated)

    with pytest.raises(ValueError, match="delayed work"):
        await dispatcher.dispatch("m-1", delay_seconds=1)

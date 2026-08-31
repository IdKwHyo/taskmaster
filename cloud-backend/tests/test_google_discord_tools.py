from __future__ import annotations

import json
from datetime import datetime
from unittest.mock import AsyncMock, Mock
from zoneinfo import ZoneInfo

import pytest
from googleapiclient.errors import HttpError

from henry_cloud.config import Settings
from henry_cloud.infrastructure.tools import google_discord as tools_module
from henry_cloud.infrastructure.tools.google_discord import CalendarDiscordWorkflowTools


class Operation:
    def __init__(self, result=None, error: Exception | None = None) -> None:
        self.result = result or {}
        self.error = error

    def execute(self):
        if self.error:
            raise self.error
        return self.result


class CalendarEvents:
    def __init__(self) -> None:
        self.list_result: dict = {"items": []}
        self.insert_result: dict = {"id": "created", "htmlLink": "https://calendar/event"}
        self.get_result: dict = {"id": "existing", "htmlLink": "https://calendar/existing"}
        self.insert_error: Exception | None = None
        self.last_insert_body: dict | None = None

    def list(self, **kwargs):
        return Operation(self.list_result)

    def insert(self, **kwargs):
        self.last_insert_body = kwargs["body"]
        return Operation(self.insert_result, self.insert_error)

    def get(self, **kwargs):
        result = dict(self.get_result)
        if self.last_insert_body:
            result["start"] = self.last_insert_body["start"]
        return Operation(result)


class Calendar:
    def __init__(self, events: CalendarEvents) -> None:
        self._events = events

    def events(self) -> CalendarEvents:
        return self._events


class Response:
    def __init__(self, payload: dict) -> None:
        self._payload = payload
        self.raise_for_status = Mock()

    def json(self) -> dict:
        return self._payload


def live_settings(**overrides) -> Settings:
    values = {
        "google_oauth_token_json": json.dumps({"token": "test"}),
        "discord_bot_token": "discord-token",
        "contacts_json": json.dumps({"A": "123"}),
        "timezone": "Asia/Bangkok",
    }
    values.update(overrides)
    return Settings.model_construct(**values)


def bare_tools(events: CalendarEvents | None = None) -> CalendarDiscordWorkflowTools:
    tools = object.__new__(CalendarDiscordWorkflowTools)
    tools._calendar = Calendar(events or CalendarEvents())
    tools._contacts = {"a": "123"}
    tools._timezone = ZoneInfo("Asia/Bangkok")
    tools._http = AsyncMock()
    return tools


def test_live_tools_validate_credentials_and_initialize(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError, match="OAUTH"):
        CalendarDiscordWorkflowTools(live_settings(google_oauth_token_json=""))
    with pytest.raises(ValueError, match="DISCORD"):
        CalendarDiscordWorkflowTools(live_settings(discord_bot_token=""))

    credentials = object()
    calendar = object()
    http = object()
    from_info = Mock(return_value=credentials)
    monkeypatch.setattr(tools_module.Credentials, "from_authorized_user_info", from_info)
    monkeypatch.setattr(tools_module, "build", Mock(return_value=calendar))
    monkeypatch.setattr(tools_module.httpx, "AsyncClient", Mock(return_value=http))

    tools = CalendarDiscordWorkflowTools(live_settings())
    assert tools._calendar is calendar
    assert tools._contacts == {"a": "123"}
    assert tools._http is http
    from_info.assert_called_once()


@pytest.mark.asyncio
async def test_check_calendar_filters_all_day_events_and_returns_slots() -> None:
    events = CalendarEvents()
    events.list_result = {
        "items": [
            {
                "summary": "Busy meeting",
                "start": {"dateTime": "2026-08-18T10:00:00+07:00"},
                "end": {"dateTime": "2026-08-18T11:00:00+07:00"},
            },
            {"summary": "All day", "start": {"date": "2026-08-19"}},
        ]
    }
    tools = bare_tools(events)
    result = await tools.check_calendar({"duration_minutes": 30}, "act-1")
    assert result["busy_event_count"] == 1
    assert result["source"] == "google_calendar"
    assert len(result["available_slots"]) <= 3


@pytest.mark.asyncio
async def test_contact_attendee_formats_slots_and_default_fallback() -> None:
    tools = bare_tools()
    tools._send_discord = AsyncMock(return_value={"channel_id": "channel", "message_id": "message"})
    result = await tools.contact_attendee(
        {
            "attendee": "A",
            "duration_minutes": 45,
            "mission_context": {"CHECK_CALENDAR": {"available_slots": ["slot-1"]}},
        },
        "act-1",
    )
    assert result["status"] == "sent"
    assert "slot-1" in tools._send_discord.await_args.args[1]

    await tools.contact_attendee({}, "act-2")
    assert "Reply with a time" in tools._send_discord.await_args.args[1]


@pytest.mark.asyncio
async def test_book_requires_slot_creates_event_and_confirms_contact() -> None:
    events = CalendarEvents()
    tools = bare_tools(events)
    tools._send_discord = AsyncMock(return_value={})
    payload = {
        "mission_context": {
            "WAIT_EXTERNAL": {
                "attendee": "A",
                "selected_slot": "2026-08-18T10:00:00+07:00",
                "duration_minutes": 45,
                "title": "Project review",
            }
        }
    }
    result = await tools.book_and_confirm(payload, "act-1")
    assert result["calendar_event_id"] == "created"
    assert result["status"] == "confirmed"
    assert result["verification"]["status"] == "READ_BACK_OK"
    assert events.last_insert_body["summary"] == "Project review"
    assert events.last_insert_body["end"]["dateTime"].endswith("10:45:00+07:00")
    tools._send_discord.assert_awaited_once()

    with pytest.raises(ValueError, match="No approved slot"):
        await tools.book_and_confirm({"mission_context": {}}, "act-empty")


@pytest.mark.asyncio
async def test_book_falls_back_to_calendar_slot_and_handles_duplicate_event() -> None:
    events = CalendarEvents()
    response = Mock(status=409, reason="Conflict")
    response.get.return_value = None
    events.insert_error = HttpError(response, b"duplicate")
    tools = bare_tools(events)
    tools._contacts = {}
    result = await tools.book_and_confirm(
        {"mission_context": {"CHECK_CALENDAR": {"available_slots": ["2026-08-18T10:00:00+07:00"]}}},
        "stable-action",
    )
    assert result["calendar_event_id"] == "existing"


@pytest.mark.asyncio
async def test_book_reraises_non_conflict_calendar_error() -> None:
    events = CalendarEvents()
    response = Mock(status=500, reason="Server Error")
    response.get.return_value = None
    events.insert_error = HttpError(response, b"failure")
    tools = bare_tools(events)
    with pytest.raises(HttpError):
        await tools.book_and_confirm(
            {
                "mission_context": {
                    "CHECK_CALENDAR": {"available_slots": ["2026-08-18T10:00:00+07:00"]}
                }
            },
            "act-fail",
        )


@pytest.mark.asyncio
async def test_book_rejects_calendar_read_back_mismatch() -> None:
    events = CalendarEvents()
    tools = bare_tools(events)
    tools._contacts = {}

    original_get = events.get

    def mismatched_get(**kwargs):
        operation = original_get(**kwargs)
        operation.result["start"] = {"dateTime": "2026-08-24T11:00:00+07:00"}
        return operation

    events.get = mismatched_get
    with pytest.raises(ValueError, match="read-back"):
        await tools.book_and_confirm(
            {
                "mission_context": {
                    "CHECK_CALENDAR": {
                        "available_slots": ["2026-08-24T10:00:00+07:00"]
                    }
                }
            },
            "act-mismatch",
        )


@pytest.mark.asyncio
async def test_send_discord_resolves_contact_and_posts_idempotent_message() -> None:
    tools = bare_tools()
    tools._http.post = AsyncMock(
        side_effect=[Response({"id": "channel-1"}), Response({"id": "message-1"})]
    )
    result = await tools._send_discord("A", "Hello", "nonce-1")
    assert result == {"channel_id": "channel-1", "message_id": "message-1"}
    assert tools._http.post.await_args_list[1].kwargs["json"]["enforce_nonce"] is True

    with pytest.raises(ValueError, match="No Discord contact"):
        await tools._send_discord("Unknown", "Hello", "nonce-2")


def test_candidate_slots_respects_business_hours_weekends_and_busy_ranges() -> None:
    tools = bare_tools()
    start = datetime.fromisoformat("2026-08-14T16:30:00+07:00")  # Friday
    end = datetime.fromisoformat("2026-08-17T11:00:00+07:00")  # Monday
    slots = tools._candidate_slots(
        start,
        end,
        [
            {
                "start": "2026-08-17T09:00:00+07:00",
                "end": "2026-08-17T10:00:00+07:00",
            }
        ],
        60,
    )
    assert all(datetime.fromisoformat(slot).weekday() < 5 for slot in slots)
    assert "2026-08-17T09:00:00+07:00" not in slots
    assert all(datetime.fromisoformat(slot).hour < 17 for slot in slots)

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from henry_cloud.config import Settings

CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.events"]


class CalendarDiscordWorkflowTools:
    """Cloud-safe versions of the Calendar and Discord tools in henry-play5."""

    def __init__(self, settings: Settings, *, discord_enabled: bool = True) -> None:
        if not settings.google_oauth_token_json:
            raise ValueError("HENRY_GOOGLE_OAUTH_TOKEN_JSON is required for live tools")
        if discord_enabled and not settings.discord_bot_token:
            raise ValueError("DISCORD_BOT_TOKEN is required for live tools")
        token_info = json.loads(settings.google_oauth_token_json)
        credentials = Credentials.from_authorized_user_info(token_info, CALENDAR_SCOPES)
        self._calendar = build("calendar", "v3", credentials=credentials, cache_discovery=False)
        self._discord_token = settings.discord_bot_token
        self._discord_enabled = discord_enabled
        self._contacts: dict[str, str] = {
            name.casefold(): str(user_id)
            for name, user_id in json.loads(settings.contacts_json).items()
        }
        self._timezone = ZoneInfo(settings.timezone)
        self._http = httpx.AsyncClient(
            base_url="https://discord.com/api/v10",
            headers={"Authorization": f"Bot {self._discord_token}"},
            timeout=15,
        )

    async def check_calendar(self, payload: dict[str, Any], action_id: str) -> dict[str, Any]:
        now = datetime.now(self._timezone)
        start = (now + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=7)

        def fetch() -> dict[str, Any]:
            return (
                self._calendar.events()
                .list(
                    calendarId="primary",
                    timeMin=start.astimezone(UTC).isoformat(),
                    timeMax=end.astimezone(UTC).isoformat(),
                    singleEvents=True,
                    orderBy="startTime",
                    maxResults=50,
                )
                .execute()
            )

        response = await asyncio.to_thread(fetch)
        busy = [
            {
                "start": item.get("start", {}).get("dateTime"),
                "end": item.get("end", {}).get("dateTime"),
                "summary": item.get("summary", "Busy"),
            }
            for item in response.get("items", [])
            if item.get("start", {}).get("dateTime")
        ]
        slots = self._candidate_slots(start, end, busy, int(payload.get("duration_minutes", 30)))
        return {
            "available_slots": slots[:3],
            "busy_event_count": len(busy),
            "source": "google_calendar",
        }

    async def contact_attendee(self, payload: dict[str, Any], action_id: str) -> dict[str, Any]:
        attendee = str(payload.get("attendee", "A"))
        context = payload.get("mission_context", {})
        slots = context.get("CHECK_CALENDAR", {}).get("available_slots", [])
        slot_text = "\n".join(f"• {slot}" for slot in slots) or "• Reply with a time that works"
        message = (
            f"Henry is coordinating a {payload.get('duration_minutes', 30)}-minute review. "
            f"Which option works for you?\n{slot_text}\n\nReply to Henry with your choice."
        )
        if not self._discord_enabled:
            return {"recipient": attendee, "status": "simulated", "channel": "dashboard", "action_id": action_id}
        result = await self._send_discord(attendee, message, action_id)
        return {"recipient": attendee, "status": "sent", **result}

    async def book_and_confirm(self, payload: dict[str, Any], action_id: str) -> dict[str, Any]:
        context = payload.get("mission_context", {})
        response = context.get("WAIT_EXTERNAL", {})
        available = context.get("CHECK_CALENDAR", {}).get("available_slots", [])
        slot = response.get("selected_slot") or (available[0] if available else None)
        if not slot:
            raise ValueError("No approved slot is available to book")
        start = datetime.fromisoformat(slot)
        duration = int(response.get("duration_minutes", 30))
        end = start + timedelta(minutes=duration)
        attendee = str(response.get("attendee", "A"))
        event_id = hashlib.sha256(action_id.encode()).hexdigest()[:24]
        body = {
            "id": event_id,
            "summary": response.get("title", "Project review with A"),
            "start": {"dateTime": start.isoformat(), "timeZone": str(self._timezone)},
            "end": {"dateTime": end.isoformat(), "timeZone": str(self._timezone)},
            "description": f"Created by Henry mission engine. Action: {action_id}",
        }

        def insert() -> dict[str, Any]:
            try:
                return self._calendar.events().insert(calendarId="primary", body=body).execute()
            except HttpError as exc:
                if exc.resp.status != 409:
                    raise
                return self._calendar.events().get(calendarId="primary", eventId=event_id).execute()

        event = await asyncio.to_thread(insert)
        resolved_event_id = event.get("id", event_id)

        def read_back() -> dict[str, Any]:
            return (
                self._calendar.events()
                .get(calendarId="primary", eventId=resolved_event_id)
                .execute()
            )

        persisted = await asyncio.to_thread(read_back)
        persisted_start = persisted.get("start", {}).get("dateTime")
        if persisted_start != start.isoformat():
            raise ValueError("Calendar read-back did not match the approved start time")
        confirmation = f"Booked: {body['summary']} on {start.strftime('%A %d %B at %H:%M')}."
        if self._discord_enabled and attendee.casefold() in self._contacts:
            await self._send_discord(attendee, confirmation, f"{action_id}-confirm")
        return {
            "calendar_event_id": resolved_event_id,
            "html_link": event.get("htmlLink"),
            "start": start.isoformat(),
            "status": "confirmed",
            "verification": {
                "status": "READ_BACK_OK",
                "calendar_event_id": resolved_event_id,
                "persisted_start": persisted_start,
            },
        }

    async def _send_discord(self, name: str, content: str, nonce: str) -> dict[str, Any]:
        recipient_id = self._contacts.get(name.casefold())
        if not recipient_id:
            raise ValueError(f"No Discord contact configured for {name!r}")
        dm_response = await self._http.post(
            "/users/@me/channels", json={"recipient_id": recipient_id}
        )
        dm_response.raise_for_status()
        channel_id = dm_response.json()["id"]
        message_response = await self._http.post(
            f"/channels/{channel_id}/messages",
            json={"content": content, "nonce": nonce, "enforce_nonce": True},
        )
        message_response.raise_for_status()
        return {"channel_id": channel_id, "message_id": message_response.json()["id"]}

    def _candidate_slots(
        self,
        start: datetime,
        end: datetime,
        busy: list[dict[str, Any]],
        duration_minutes: int,
    ) -> list[str]:
        duration = timedelta(minutes=duration_minutes)
        busy_ranges = [
            (datetime.fromisoformat(item["start"]), datetime.fromisoformat(item["end"]))
            for item in busy
        ]
        slots: list[str] = []
        cursor = start
        while cursor < end and len(slots) < 6:
            if cursor.weekday() < 5 and 9 <= cursor.hour < 17:
                candidate_end = cursor + duration
                if candidate_end.hour <= 17 and not any(
                    cursor < busy_end and candidate_end > busy_start
                    for busy_start, busy_end in busy_ranges
                ):
                    slots.append(cursor.isoformat())
            cursor += timedelta(minutes=30)
        return slots

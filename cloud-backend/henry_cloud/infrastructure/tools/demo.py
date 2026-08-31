from typing import Any


class DemoWorkflowTools:
    """Reliable demo implementation with stable, inspectable outputs."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def check_calendar(self, payload: dict[str, Any], action_id: str) -> dict[str, Any]:
        self.calls.append(("check_calendar", action_id))
        return {
            "available_slots": [
                "2026-08-18T10:00:00+07:00",
                "2026-08-19T14:30:00+07:00",
            ],
            "source": "demo_calendar",
        }

    async def contact_attendee(self, payload: dict[str, Any], action_id: str) -> dict[str, Any]:
        self.calls.append(("contact_attendee", action_id))
        return {
            "message_id": action_id,
            "recipient": payload.get("attendee", "A"),
            "status": "sent",
        }

    async def book_and_confirm(self, payload: dict[str, Any], action_id: str) -> dict[str, Any]:
        self.calls.append(("book_and_confirm", action_id))
        event_id = action_id.replace("-", "")[:24]
        return {
            "calendar_event_id": event_id,
            "status": "confirmed",
            "verification": {
                "status": "READ_BACK_OK",
                "calendar_event_id": event_id,
                "evidence": "Demo adapter read-back matches the approved slot.",
            },
        }

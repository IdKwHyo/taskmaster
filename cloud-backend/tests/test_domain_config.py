from datetime import UTC

import pytest
from pydantic import ValidationError

from henry_cloud.config import Settings, get_settings
from henry_cloud.domain.models import Mission, MissionStatus, MissionStep, StepKind, new_id, utc_now


def test_time_and_id_helpers() -> None:
    now = utc_now()
    assert now.tzinfo == UTC
    first = new_id("m")
    second = new_id("m")
    assert first.startswith("m-")
    assert first != second


def test_mission_current_step_and_terminal_properties() -> None:
    mission = Mission(
        outcome="Coordinate a review",
        owner_id="owner",
        steps=[MissionStep(name="Plan", kind=StepKind.PLAN, order=0)],
    )
    assert mission.current_step is mission.steps[0]
    assert mission.terminal is False

    mission.current_step_index = 3
    assert mission.current_step is None
    mission.status = MissionStatus.COMPLETED
    assert mission.terminal is True
    mission.status = MissionStatus.FAILED
    assert mission.terminal is True
    mission.status = MissionStatus.CANCELLED
    assert mission.terminal is True


def test_settings_parse_origins_and_enforce_caps() -> None:
    settings = Settings(
        HENRY_ALLOWED_ORIGINS="https://one.example, https://two.example",
        HENRY_MAX_WORKFLOW_STEPS=8,
    )
    assert settings.allowed_origins == ["https://one.example", "https://two.example"]

    existing = ["https://one.example"]
    settings = Settings(HENRY_ALLOWED_ORIGINS=existing)
    assert settings.allowed_origins == existing

    with pytest.raises(ValidationError):
        Settings(HENRY_MAX_WORKFLOW_STEPS=0)


def test_get_settings_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    get_settings.cache_clear()
    monkeypatch.setenv("HENRY_MODEL", "gemini-test")
    first = get_settings()
    monkeypatch.setenv("HENRY_MODEL", "changed-after-cache")
    assert get_settings() is first
    assert first.model == "gemini-test"
    get_settings.cache_clear()

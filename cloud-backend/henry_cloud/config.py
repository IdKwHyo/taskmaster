from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = Field(default="development", alias="HENRY_ENVIRONMENT")
    service_role: str = Field(default="all", alias="HENRY_SERVICE_ROLE")
    model: str = Field(default="gemini-3.5-flash", alias="HENRY_MODEL")
    repository: str = Field(default="memory", alias="HENRY_REPOSITORY")
    dispatcher: str = Field(default="local", alias="HENRY_DISPATCHER")
    planner_mode: str = Field(default="adk", alias="HENRY_PLANNER")
    tool_mode: str = Field(default="demo", alias="HENRY_TOOL_MODE")
    api_key: str = Field(default="", alias="HENRY_API_KEY")
    allowed_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173"], alias="HENRY_ALLOWED_ORIGINS"
    )

    project_id: str = Field(default="", alias="GOOGLE_CLOUD_PROJECT")
    cloud_region: str = Field(default="asia-southeast1", alias="HENRY_CLOUD_REGION")
    task_queue: str = Field(default="henry-workflows", alias="HENRY_TASK_QUEUE")
    service_url: str = Field(default="", alias="HENRY_SERVICE_URL")
    task_service_account: str = Field(default="", alias="HENRY_TASK_SERVICE_ACCOUNT")

    max_workflow_steps: int = Field(default=8, alias="HENRY_MAX_WORKFLOW_STEPS", ge=1, le=20)
    max_model_calls: int = Field(default=6, alias="HENRY_MAX_MODEL_CALLS", ge=1, le=50)
    max_tool_calls: int = Field(default=12, alias="HENRY_MAX_TOOL_CALLS", ge=1, le=100)
    max_retries_per_step: int = Field(default=2, alias="HENRY_MAX_RETRIES_PER_STEP", ge=1, le=5)
    max_output_tokens: int = Field(default=2048, alias="HENRY_MAX_OUTPUT_TOKENS", ge=128)
    max_workflow_cost_usd: float = Field(default=0.25, alias="HENRY_MAX_WORKFLOW_COST_USD", gt=0)
    daily_soft_limit_usd: float = Field(default=2.0, alias="HENRY_DAILY_SOFT_LIMIT_USD", gt=0)
    total_budget_usd: float = Field(default=20.0, alias="HENRY_TOTAL_BUDGET_USD", gt=0)

    model_input_usd_per_million: float = Field(
        default=1.50, alias="HENRY_MODEL_INPUT_USD_PER_MILLION"
    )
    model_output_usd_per_million: float = Field(
        default=9.00, alias="HENRY_MODEL_OUTPUT_USD_PER_MILLION"
    )

    google_oauth_token_json: str = Field(default="", alias="HENRY_GOOGLE_OAUTH_TOKEN_JSON")
    discord_bot_token: str = Field(default="", alias="DISCORD_BOT_TOKEN")
    contacts_json: str = Field(default="{}", alias="HENRY_CONTACTS_JSON")
    timezone: str = Field(default="Asia/Bangkok", alias="HENRY_TIMEZONE")

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from henry_cloud.api.routes import internal_router, router
from henry_cloud.config import get_settings

settings = get_settings()
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.JSONRenderer(),
    ]
)

app = FastAPI(
    title="Henry Cloud",
    version="0.1.0",
    description="The AI that finishes the job: durable autonomous missions with human boundaries.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
if settings.service_role != "worker":
    app.include_router(router)
if settings.service_role != "api":
    app.include_router(internal_router)


@app.get("/healthz", include_in_schema=False)
async def healthz() -> dict[str, str]:
    return {"status": "ok", "service": "henry-cloud", "model": settings.model}

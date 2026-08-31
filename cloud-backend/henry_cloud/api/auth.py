import hmac

from fastapi import Header, HTTPException, status

from henry_cloud.config import get_settings


async def require_write_auth(authorization: str | None = Header(default=None)) -> None:
    expected = get_settings().api_key
    if not expected:
        return
    prefix = "Bearer "
    supplied = (
        authorization[len(prefix) :] if authorization and authorization.startswith(prefix) else ""
    )
    if not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API token")

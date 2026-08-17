"""Verifies the short-lived internal JWT minted by the Next.js app.

This backend never sees Auth.js's own session cookie/JWE — that's fragile and
version-coupled to Auth.js internals. Instead, Next.js's
app/api/internal/token/route.ts reads the real session server-side and mints a
separate 60s HS256 token just for calling this API. We only ever verify that
token's signature + claims here.

INTERNAL_JWT_SECRET_PREV (optional) lets the shared secret rotate without
downtime: verification tries the current secret first, falls back to the
previous one, so tokens minted just before a rotation still validate.
"""
import os
from typing import Optional

import jwt
from fastapi import Depends, Header, HTTPException

AUDIENCE = "chessai-backend"
ISSUER = "chessai-frontend"


class CurrentUser:
    __slots__ = ("user_id", "email")

    def __init__(self, user_id: str, email: Optional[str]):
        self.user_id = user_id
        self.email = email


def _secrets() -> list[str]:
    current = os.environ["INTERNAL_JWT_SECRET"]
    prev = os.environ.get("INTERNAL_JWT_SECRET_PREV")
    return [s for s in (current, prev) if s]


def _decode(token: str) -> dict:
    last_error: Optional[Exception] = None
    for secret in _secrets():
        try:
            return jwt.decode(
                token,
                secret,
                algorithms=["HS256"],
                audience=AUDIENCE,
                issuer=ISSUER,
            )
        except jwt.InvalidTokenError as e:
            last_error = e
            continue
    raise last_error or jwt.InvalidTokenError("no secret configured")


def _extract_bearer(authorization: Optional[str]) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    return authorization.split(" ", 1)[1].strip()


async def get_current_user(authorization: Optional[str] = Header(None)) -> CurrentUser:
    """Required auth — raises 401 if no valid token is present."""
    token = _extract_bearer(authorization)
    try:
        payload = _decode(token)
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid or expired token")
    return CurrentUser(user_id=payload["sub"], email=payload.get("email"))


async def get_current_user_optional(authorization: Optional[str] = Header(None)) -> Optional[CurrentUser]:
    """Best-effort auth for endpoints that work both signed-in and anonymous."""
    if not authorization:
        return None
    try:
        token = _extract_bearer(authorization)
        payload = _decode(token)
    except (HTTPException, jwt.InvalidTokenError):
        return None
    return CurrentUser(user_id=payload["sub"], email=payload.get("email"))


def _admin_user_ids() -> set[str]:
    raw = os.environ.get("ADMIN_USER_IDS", "")
    return {uid.strip() for uid in raw.split(",") if uid.strip()}


async def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Gates the admin dashboard's backend endpoints. Deliberately keyed on
    Prisma user id (ADMIN_USER_IDS, comma-separated), not email — a
    username/password signup never sets `email` at all (see
    app/api/auth/register/route.ts), so an email-based check would silently
    exclude exactly the accounts most likely to be the site owner's. This is
    a defense-in-depth backstop, not the primary discovery UX — that's
    frontend/app/admin/page.tsx, which shows a rejected user their own id
    directly on the page."""
    if user.user_id not in _admin_user_ids():
        raise HTTPException(403, "Not an admin.")
    return user

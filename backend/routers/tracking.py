import logging
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from auth import CurrentUser, get_current_user_optional
from db import get_pool

logger = logging.getLogger(__name__)
router = APIRouter()


class PageViewRequest(BaseModel):
    path: str = Field(..., min_length=1, max_length=500)
    referrer: Optional[str] = None


@router.post("/pageview")
async def track_pageview(
    req: PageViewRequest,
    request: Request,
    user: Optional[CurrentUser] = Depends(get_current_user_optional),
):
    """Fire-and-forget from the frontend (PageViewTracker.tsx) — a tracking
    beacon failing should never surface to the visitor, so this swallows
    errors instead of raising, unlike app.feedback's insert."""
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO app.page_view (path, user_id, referrer, user_agent)
                VALUES ($1, $2, $3, $4)
                """,
                req.path,
                user.user_id if user else None,
                req.referrer,
                request.headers.get("user-agent"),
            )
    except Exception as e:
        logger.warning("Failed to record page view: %s", e)
    return {"ok": True}

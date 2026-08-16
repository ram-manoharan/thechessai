import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth import CurrentUser, get_current_user_optional
from db import get_pool

logger = logging.getLogger(__name__)
router = APIRouter()


class FeedbackRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    rating: Optional[int] = Field(None, ge=1, le=5)
    page_path: Optional[str] = None


@router.post("/submit")
async def submit_feedback(
    req: FeedbackRequest,
    request: Request,
    user: Optional[CurrentUser] = Depends(get_current_user_optional),
):
    """Works both signed-in and anonymous — unlike the mistake-pattern side
    channel elsewhere in this app, a failure here IS the whole point of the
    request, so it raises instead of swallowing the error."""
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO app.feedback (user_id, email, rating, message, page_path, user_agent)
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                user.user_id if user else None,
                user.email if user else None,
                req.rating,
                req.message.strip(),
                req.page_path,
                request.headers.get("user-agent"),
            )
        return {"ok": True}
    except Exception as e:
        logger.error("Failed to persist feedback: %s", e)
        raise HTTPException(500, "Could not save feedback right now — try again in a moment.")

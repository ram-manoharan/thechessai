import logging

from fastapi import APIRouter, Depends, Query

from auth import require_admin
from db import get_pool

logger = logging.getLogger(__name__)
# Every route on this router requires admin — gated once here rather than
# per-endpoint, since none of these need the CurrentUser object itself.
router = APIRouter(dependencies=[Depends(require_admin)])


@router.get("/overview")
async def admin_overview():
    """Everything on the dashboard's top stat-card row. Deliberately its own
    set of fresh queries rather than reusing stats.platform's cached
    5-minute-stale numbers — an admin actively checking this page wants the
    real current count, not what was true a few minutes ago."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        games_analyzed = await conn.fetchval("SELECT COUNT(*) FROM app.analyzed_game")
        profiles_generated = await conn.fetchval("SELECT COUNT(*) FROM app.saved_profile")
        own_puzzles_solved = await conn.fetchval("SELECT COUNT(*) FROM app.puzzle_progress WHERE solved")
        lichess_puzzles_solved = await conn.fetchval("SELECT COUNT(*) FROM app.lichess_puzzle_progress WHERE solved")
        feedback_count = await conn.fetchval("SELECT COUNT(*) FROM app.feedback")
        feedback_avg_rating = await conn.fetchval("SELECT AVG(rating) FROM app.feedback WHERE rating IS NOT NULL")
        pageviews_total = await conn.fetchval("SELECT COUNT(*) FROM app.page_view")
        pageviews_today = await conn.fetchval(
            "SELECT COUNT(*) FROM app.page_view WHERE created_at >= date_trunc('day', now())"
        )
        pageviews_7d = await conn.fetchval(
            "SELECT COUNT(*) FROM app.page_view WHERE created_at >= now() - interval '7 days'"
        )
    return {
        "games_analyzed": games_analyzed,
        "profiles_generated": profiles_generated,
        "puzzles_solved": own_puzzles_solved + lichess_puzzles_solved,
        "feedback_count": feedback_count,
        "feedback_avg_rating": round(float(feedback_avg_rating), 2) if feedback_avg_rating is not None else None,
        "pageviews_total": pageviews_total,
        "pageviews_today": pageviews_today,
        "pageviews_7d": pageviews_7d,
    }


@router.get("/feedback")
async def admin_feedback(limit: int = Query(100, ge=1, le=500)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, user_id, email, rating, message, page_path, created_at
            FROM app.feedback
            ORDER BY created_at DESC
            LIMIT $1
            """,
            limit,
        )
    return {"feedback": [dict(r) | {"created_at": r["created_at"].isoformat()} for r in rows]}


@router.get("/pageviews")
async def admin_pageviews():
    pool = await get_pool()
    async with pool.acquire() as conn:
        top_paths = await conn.fetch(
            """
            SELECT path, COUNT(*) AS views
            FROM app.page_view
            WHERE created_at >= now() - interval '30 days'
            GROUP BY path
            ORDER BY views DESC
            LIMIT 10
            """
        )
        daily = await conn.fetch(
            """
            SELECT date_trunc('day', created_at)::date AS day, COUNT(*) AS views
            FROM app.page_view
            WHERE created_at >= now() - interval '14 days'
            GROUP BY 1
            ORDER BY 1
            """
        )
    return {
        "top_paths": [{"path": r["path"], "views": r["views"]} for r in top_paths],
        "daily": [{"day": r["day"].isoformat(), "views": r["views"]} for r in daily],
    }

"""Public, unauthenticated platform-wide counters -- the numbers the
homepage's "pitch" section shows. Deliberately narrow: three counts, no
per-user data, no auth required (matches the existing unauthenticated
/api/health precedent). Registered-user count is NOT computed here --
public.users is Prisma/Next.js-owned; the frontend's own /api/stats route
combines that count with what this endpoint returns.
"""
import logging

from fastapi import APIRouter

import cache_service
from db import get_pool

logger = logging.getLogger(__name__)
router = APIRouter()

_CACHE_KEY = "stats:platform"
_CACHE_TTL_SECONDS = 300  # 5 min -- fresh enough for a homepage pitch, cheap enough to not hammer Postgres on every visit


async def _compute_platform_stats() -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        games_analyzed = await conn.fetchval("SELECT COUNT(*) FROM app.analyzed_game")
        profiles_generated = await conn.fetchval("SELECT COUNT(*) FROM app.saved_profile")
        own_puzzles_solved = await conn.fetchval("SELECT COUNT(*) FROM app.puzzle_progress WHERE solved")
        lichess_puzzles_solved = await conn.fetchval("SELECT COUNT(*) FROM app.lichess_puzzle_progress WHERE solved")
    return {
        "games_analyzed": games_analyzed,
        "profiles_generated": profiles_generated,
        "puzzles_solved": own_puzzles_solved + lichess_puzzles_solved,
    }


@router.get("/platform")
async def platform_stats():
    return await cache_service.get_or_set(_CACHE_KEY, _compute_platform_stats, ttl_seconds=_CACHE_TTL_SECONDS)

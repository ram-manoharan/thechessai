"""Redis cache-aside helpers.

Two uses:
1. Wraps player_profile_service.build_player_profile — currently recomputed
   from scratch on every view (refetching + reanalysing up to 100 games from
   Lichess/Chess.com). TTL is jittered (~+/-8min around 1hr) so many cached
   entries created around the same time don't all expire in the same instant
   and trigger a simultaneous stampede of expensive recomputes.
2. The banned-user denylist checked by Next.js at token-mint time (the one
   real session-revocation checkpoint in an otherwise stateless JWT system).
"""
import os
import json
import random
import logging
from typing import Any, Awaitable, Callable, Optional

import redis as redis_sync
import redis.asyncio as redis

logger = logging.getLogger(__name__)

_BASE_TTL_SECONDS = 3600
_JITTER_SECONDS = 480  # +/- 8 minutes

_client: Optional[redis.Redis] = None
_sync_client: Optional["redis_sync.Redis"] = None


def get_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(os.environ["REDIS_URL"], decode_responses=True)
    return _client


def get_sync_client() -> "redis_sync.Redis":
    """For call sites that are themselves sync (e.g. a `def` SSE generator that
    FastAPI runs in a worker thread) — using the async client there would
    require an event loop that doesn't exist in that thread."""
    global _sync_client
    if _sync_client is None:
        _sync_client = redis_sync.from_url(os.environ["REDIS_URL"], decode_responses=True)
    return _sync_client


def _jittered_ttl() -> int:
    return _BASE_TTL_SECONDS + random.randint(-_JITTER_SECONDS, _JITTER_SECONDS)


def profile_cache_key(user_id: str, provider: str) -> str:
    return f"profile:{user_id}:{provider}"


def get_cached_stats_sync(user_id: str, provider: str) -> Optional[dict]:
    try:
        cached = get_sync_client().get(profile_cache_key(user_id, provider))
        return json.loads(cached) if cached is not None else None
    except Exception as e:
        logger.warning("Redis sync read failed for %s/%s: %s", user_id, provider, e)
        return None


def set_cached_stats_sync(user_id: str, provider: str, stats: dict) -> None:
    try:
        get_sync_client().set(
            profile_cache_key(user_id, provider), json.dumps(stats), ex=_jittered_ttl()
        )
    except Exception as e:
        logger.warning("Redis sync write failed for %s/%s: %s", user_id, provider, e)


async def get_or_set(
    key: str, compute: Callable[[], Awaitable[Any]], ttl_seconds: Optional[int] = None
) -> Any:
    """Cache-aside: return the cached value if present, else compute, cache, return.
    `ttl_seconds` overrides the default jittered ~1h TTL for callers that want
    something shorter (e.g. import.py's proxied external-API responses,
    where staleness of more than a few minutes matters to the user). If
    `compute()` raises, nothing is cached and the exception propagates
    normally -- only successful results are ever cached.
    """
    client = get_client()
    try:
        cached = await client.get(key)
        if cached is not None:
            return json.loads(cached)
    except Exception as e:
        logger.warning("Redis read failed for %s, falling through to compute: %s", key, e)

    value = await compute()

    try:
        await client.set(key, json.dumps(value), ex=ttl_seconds if ttl_seconds is not None else _jittered_ttl())
    except Exception as e:
        logger.warning("Redis write failed for %s (serving uncached): %s", key, e)

    return value


async def invalidate(key: str) -> None:
    try:
        await get_client().delete(key)
    except Exception as e:
        logger.warning("Redis invalidate failed for %s: %s", key, e)

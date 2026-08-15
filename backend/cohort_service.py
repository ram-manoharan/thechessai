"""Anonymized, cross-user cohort stats over app.mistake_event -- "what do
players at this level typically get wrong here." Lazy cache-aside, mirroring
app.profile_cache's existing self-healing pattern (see cache_service.py):
whichever request notices a (elo_band, tactical_theme) pair's stats are
stale just recomputes them inline. No cron/scheduler -- none exists in this
codebase and this doesn't need one at today's scale.

MIN_SAMPLE_SIZE is a hard floor, not a suggestion: below it, a "stat" is
really just describing a handful of identifiable people, not a cohort.
Enforced here AND by app.cohort_mistake_stats' own CHECK constraint.
"""
import json
import logging
from typing import Optional

from db import get_pool

logger = logging.getLogger(__name__)

MIN_SAMPLE_SIZE = 30
_STALE_AFTER = "24 hours"


async def get_cohort_stats(elo_band: Optional[str], tactical_theme: Optional[str]) -> Optional[dict]:
    """None if the theme/band is unset, or if fewer than MIN_SAMPLE_SIZE
    players have hit this exact combination -- callers should treat None as
    "no cohort insight available," not an error."""
    if not elo_band or not tactical_theme:
        return None
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                f"""
                SELECT sample_size, avg_cp_loss, cognitive_error_breakdown
                FROM app.cohort_mistake_stats
                WHERE elo_band = $1 AND tactical_theme = $2
                  AND computed_at > now() - interval '{_STALE_AFTER}'
                """,
                elo_band, tactical_theme,
            )
            if row is None:
                row = await _recompute(conn, elo_band, tactical_theme)
            if row is None:
                return None
            breakdown = row["cognitive_error_breakdown"]
            return {
                "sample_size": row["sample_size"],
                "avg_cp_loss": round(float(row["avg_cp_loss"]), 1),
                # asyncpg returns JSONB as a raw string (no codec registered
                # on this pool, matching the rest of the codebase -- see
                # routers/user.py's json.loads(row["payload"])).
                "cognitive_error_breakdown": json.loads(breakdown) if isinstance(breakdown, str) else breakdown,
            }
    except Exception:
        # Cohort insight is a bonus overlay, never worth failing the caller
        # (typically the mistake-fingerprint endpoint) over.
        logger.warning("get_cohort_stats failed for band=%s theme=%s", elo_band, tactical_theme, exc_info=True)
        return None


async def _recompute(conn, elo_band: str, tactical_theme: str) -> Optional[dict]:
    main = await conn.fetchrow(
        "SELECT COUNT(*) AS n, AVG(cp_loss) AS avg_cp_loss FROM app.mistake_event WHERE elo_band = $1 AND tactical_theme = $2",
        elo_band, tactical_theme,
    )
    if main is None or main["n"] < MIN_SAMPLE_SIZE:
        return None

    breakdown_rows = await conn.fetch(
        """
        SELECT cognitive_error_type, COUNT(*) AS n FROM app.mistake_event
        WHERE elo_band = $1 AND tactical_theme = $2 AND cognitive_error_type IS NOT NULL
        GROUP BY cognitive_error_type
        """,
        elo_band, tactical_theme,
    )
    breakdown = {r["cognitive_error_type"]: r["n"] for r in breakdown_rows}

    return await conn.fetchrow(
        """
        INSERT INTO app.cohort_mistake_stats (elo_band, tactical_theme, sample_size, avg_cp_loss, cognitive_error_breakdown, computed_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, now())
        ON CONFLICT (elo_band, tactical_theme) DO UPDATE SET
            sample_size = EXCLUDED.sample_size,
            avg_cp_loss = EXCLUDED.avg_cp_loss,
            cognitive_error_breakdown = EXCLUDED.cognitive_error_breakdown,
            computed_at = now()
        RETURNING sample_size, avg_cp_loss, cognitive_error_breakdown
        """,
        elo_band, tactical_theme, main["n"], float(main["avg_cp_loss"]), json.dumps(breakdown),
    )

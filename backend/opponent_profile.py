"""Per-opponent behavioral profile, built from a tracking user's own saved
games against a named opponent. Powers replay's "AI clone of this specific
opponent" deviation model in routers/replay.py.

app.opponent_mistake_event only stores flagged moves, so it alone can't
produce a real error rate -- it needs a total-moves denominator. That
denominator is reused for free from app.analyzed_game.payload.moves_data
(every move, not just flagged ones) rather than adding a second, heavier
capture path.

Short Redis TTL cache-aside (not a dedicated table like cohort_service.py's
24h-cached one): this is one user's private per-opponent data, not an
expensive cross-user aggregate, and the 300s window exists purely to smooth
repeated calls within one replay session (replay/move fires once per ply).
"""
import json
import logging
from typing import Optional

import cache_service
from db import get_pool

logger = logging.getLogger(__name__)

MIN_SAMPLE_SIZE = 8
_GAMES_CONSIDERED_LIMIT = 50
_CACHE_TTL_SECONDS = 300
_LOW_CLOCK_THRESHOLD = 30  # seconds; matches ai_service.py's existing time-pressure prompt threshold


async def get_opponent_profile(tracked_by_user_id: str, opponent_name: str) -> Optional[dict]:
    """None if the opponent has no name, or fewer than MIN_SAMPLE_SIZE flagged
    moves have been observed for them -- callers should treat None exactly
    like "no history yet," identical to today's behavior."""
    opponent_name = (opponent_name or "").strip()
    if not opponent_name:
        return None
    cache_key = f"opponent_profile:{tracked_by_user_id}:{opponent_name}"
    try:
        return await cache_service.get_or_set(
            cache_key, lambda: _compute(tracked_by_user_id, opponent_name), ttl_seconds=_CACHE_TTL_SECONDS
        )
    except Exception:
        logger.warning("get_opponent_profile failed for user=%s opponent=%s", tracked_by_user_id, opponent_name, exc_info=True)
        return None


async def _compute(tracked_by_user_id: str, opponent_name: str) -> Optional[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        mistake_rows = await conn.fetch(
            """
            SELECT phase, tactical_theme, clock_remaining
            FROM app.opponent_mistake_event
            WHERE tracked_by_user_id = $1 AND opponent_name = $2
            """,
            tracked_by_user_id, opponent_name,
        )
        if len(mistake_rows) < MIN_SAMPLE_SIZE:
            return None

        game_rows = await conn.fetch(
            """
            SELECT id, player_color, payload FROM app.analyzed_game
            WHERE user_id = $1
              AND ((player_color = 'white' AND black = $2) OR (player_color = 'black' AND white = $2))
            ORDER BY updated_at DESC LIMIT $3
            """,
            tracked_by_user_id, opponent_name, _GAMES_CONSIDERED_LIMIT,
        )

    phase_total: dict[str, int] = {}
    phase_flagged: dict[str, int] = {}
    low_clock_total = 0
    low_clock_flagged = 0
    rest_total = 0
    rest_flagged = 0

    for g in game_rows:
        opponent_cap = "Black" if g["player_color"].capitalize() == "White" else "White"
        payload = g["payload"]
        payload = json.loads(payload) if isinstance(payload, str) else payload
        moves_data = (payload or {}).get("moves_data") or []
        for m in moves_data:
            if m.get("color") != opponent_cap:
                continue
            phase = m.get("phase") or "Unknown"
            is_flagged = any(k in (m.get("classification") or "") for k in ("Blunder", "Mistake", "Inaccuracy"))
            phase_total[phase] = phase_total.get(phase, 0) + 1
            if is_flagged:
                phase_flagged[phase] = phase_flagged.get(phase, 0) + 1

            clock = m.get("clock_remaining")
            if clock is not None:
                if clock < _LOW_CLOCK_THRESHOLD:
                    low_clock_total += 1
                    if is_flagged:
                        low_clock_flagged += 1
                else:
                    rest_total += 1
                    if is_flagged:
                        rest_flagged += 1

    phase_error_rate = {
        phase: round(phase_flagged.get(phase, 0) / total, 3)
        for phase, total in phase_total.items() if total > 0
    }

    theme_counts: dict[str, int] = {}
    for r in mistake_rows:
        theme = r["tactical_theme"]
        if theme:
            theme_counts[theme] = theme_counts.get(theme, 0) + 1
    total_theme_hits = sum(theme_counts.values()) or 1
    theme_distribution = {theme: round(n / total_theme_hits, 3) for theme, n in theme_counts.items()}

    low_clock_rate = (low_clock_flagged / low_clock_total) if low_clock_total >= 5 else None
    rest_rate = (rest_flagged / rest_total) if rest_total >= 5 else None
    time_pressure_elevated = (
        low_clock_rate is not None and rest_rate is not None and low_clock_rate > rest_rate * 1.5
    )

    return {
        "sample_size": len(mistake_rows),
        "games_considered": len(game_rows),
        "phase_error_rate": phase_error_rate,
        "theme_distribution": theme_distribution,
        "time_pressure": {
            "elevated": time_pressure_elevated,
            "low_clock_error_rate": round(low_clock_rate, 3) if low_clock_rate is not None else None,
            "baseline_error_rate": round(rest_rate, 3) if rest_rate is not None else None,
        },
    }

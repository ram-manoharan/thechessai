"""User account endpoints: profile lookup, chess.com/lichess username
linking, and puzzle-progress recording.

Reads/writes `public.users` / `public.chess_profiles` (owned + migrated by
Prisma in the Next.js app — see frontend/prisma/schema.prisma) via raw SQL
over the shared asyncpg pool. This backend never runs migrations against
those tables, only queries them; `app.puzzle_progress` (this backend's own
schema) is the only table here it actually owns.
"""
import hashlib
import json
import datetime
import logging
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import CurrentUser, get_current_user
from db import get_pool

logger = logging.getLogger(__name__)
router = APIRouter()

_HEADERS = {"User-Agent": "chessAIlytics/1.0 (github.com/chessAIlytics)"}


async def _lichess_username_exists(username: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://lichess.org/api/user/{username.strip()}", headers=_HEADERS
            )
        return resp.status_code == 200
    except Exception as e:
        logger.warning("Lichess username check failed for %s: %s", username, e)
        raise HTTPException(502, "Couldn't verify that Lichess username — try again.")


async def _chesscom_username_exists(username: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://api.chess.com/pub/player/{username.strip()}", headers=_HEADERS
            )
        return resp.status_code == 200
    except Exception as e:
        logger.warning("Chess.com username check failed for %s: %s", username, e)
        raise HTTPException(502, "Couldn't verify that Chess.com username — try again.")


class ChessLinksRequest(BaseModel):
    lichess_username: Optional[str] = None
    chesscom_username: Optional[str] = None


@router.get("/me")
async def get_me(user: CurrentUser = Depends(get_current_user)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT u."id", u."name", u."email", u."image",
                   cp."lichessUsername", cp."chesscomUsername", cp."lichessVerified"
            FROM "users" u
            LEFT JOIN "chess_profiles" cp ON cp."userId" = u."id"
            WHERE u."id" = $1
            """,
            user.user_id,
        )
    if row is None:
        raise HTTPException(404, "User not found")
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "image": row["image"],
        "lichess_username": row["lichessUsername"],
        "chesscom_username": row["chesscomUsername"],
        "lichess_verified": row["lichessVerified"] or False,
    }


@router.put("/chess-links")
async def update_chess_links(
    req: ChessLinksRequest, user: CurrentUser = Depends(get_current_user)
):
    if req.lichess_username is not None and req.lichess_username.strip():
        if not await _lichess_username_exists(req.lichess_username):
            raise HTTPException(404, f"No Lichess user named '{req.lichess_username}'.")
    if req.chesscom_username is not None and req.chesscom_username.strip():
        if not await _chesscom_username_exists(req.chesscom_username):
            raise HTTPException(404, f"No Chess.com user named '{req.chesscom_username}'.")

    lichess_val = req.lichess_username.strip() if req.lichess_username else None
    chesscom_val = req.chesscom_username.strip() if req.chesscom_username else None

    pool = await get_pool()
    async with pool.acquire() as conn:
        try:
            await conn.execute(
                """
                INSERT INTO "chess_profiles" ("userId", "lichessUsername", "chesscomUsername", "lichessVerified", "updatedAt")
                VALUES ($1, $2, $3, false, now())
                ON CONFLICT ("userId") DO UPDATE SET
                    "lichessUsername"  = COALESCE(EXCLUDED."lichessUsername", "chess_profiles"."lichessUsername"),
                    "chesscomUsername" = COALESCE(EXCLUDED."chesscomUsername", "chess_profiles"."chesscomUsername"),
                    -- Hand-typed edits are never auto-verified; only the Lichess
                    -- OAuth sign-in path (in auth.ts) sets this true.
                    "lichessVerified"  = CASE WHEN $2 IS NOT NULL THEN false ELSE "chess_profiles"."lichessVerified" END,
                    "updatedAt"        = now()
                """,
                user.user_id, lichess_val, chesscom_val,
            )
        except Exception as e:
            # Most likely a unique-constraint hit (username already linked to another account)
            raise HTTPException(409, f"That username is already linked to another account.") from e

    return {"ok": True}


class PuzzleProgressRequest(BaseModel):
    puzzle_fen: str
    solved: bool = True


# Spaced-repetition intervals: 1st solve -> back in 1 day, 2nd consecutive
# solve -> 1 week, 3rd+ -> 1 month. Any miss resets the streak to 0 (back
# tomorrow) — simple, no external SRS library needed for this scale.
_SRS_INTERVAL_DAYS = {1: 1, 2: 7}
_SRS_DEFAULT_DAYS = 30


@router.post("/puzzle-progress")
async def record_puzzle_progress(
    req: PuzzleProgressRequest, user: CurrentUser = Depends(get_current_user)
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT streak FROM app.puzzle_progress WHERE user_id = $1 AND puzzle_fen = $2",
            user.user_id, req.puzzle_fen,
        )
        prev_streak = row["streak"] if row else 0
        if req.solved:
            new_streak = prev_streak + 1
            days = _SRS_INTERVAL_DAYS.get(new_streak, _SRS_DEFAULT_DAYS)
        else:
            new_streak = 0
            days = 1

        await conn.execute(
            """
            INSERT INTO app.puzzle_progress (user_id, puzzle_fen, solved, solved_at, streak, next_review_at)
            VALUES ($1, $2, $3, CASE WHEN $3 THEN now() ELSE NULL END, $4, now() + ($5 * interval '1 day'))
            ON CONFLICT (user_id, puzzle_fen) DO UPDATE SET
                solved         = EXCLUDED.solved,
                solved_at      = CASE WHEN EXCLUDED.solved THEN now() ELSE app.puzzle_progress.solved_at END,
                streak         = EXCLUDED.streak,
                next_review_at = EXCLUDED.next_review_at
            """,
            user.user_id, req.puzzle_fen, req.solved, new_streak, days,
        )
    return {"ok": True, "streak": new_streak, "next_review_in_days": days}


@router.get("/mistake-fingerprint")
async def get_mistake_fingerprint(user: CurrentUser = Depends(get_current_user), limit: int = 5):
    """Per-user aggregation of app.mistake_pattern — which tactical/positional
    themes cost this player the most, ranked by total cp lost (a proxy for
    Elo impact) rather than raw frequency, so one costly recurring pattern
    outranks several trivial ones. Drives both the coaching-report summary
    and the puzzle queue's prioritization below.

    Each theme also carries `recent_occurrences` (last 30 days, vs the
    lifetime `occurrences` total) and a `sparkline` of up to the last 8
    cp_loss values in chronological order — so the fingerprint reads as a
    trend (getting better/worse at this pattern) instead of a static list."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT theme, COUNT(*) AS occurrences, AVG(cp_loss) AS avg_cp_loss, SUM(cp_loss) AS total_cp_loss,
                   COUNT(*) FILTER (WHERE occurred_at >= now() - interval '30 days') AS recent_occurrences
            FROM app.mistake_pattern
            WHERE user_id = $1
            GROUP BY theme
            ORDER BY SUM(cp_loss) DESC
            LIMIT $2
            """,
            user.user_id, limit,
        )

        themes = []
        for r in rows:
            spark_rows = await conn.fetch(
                """
                SELECT cp_loss FROM app.mistake_pattern
                WHERE user_id = $1 AND theme = $2
                ORDER BY occurred_at DESC
                LIMIT 8
                """,
                user.user_id, r["theme"],
            )
            themes.append({
                "theme":              r["theme"],
                "occurrences":        r["occurrences"],
                "recent_occurrences": r["recent_occurrences"],
                "avg_cp_loss":        round(float(r["avg_cp_loss"]), 1),
                "total_cp_loss":      r["total_cp_loss"],
                "sparkline":          [sr["cp_loss"] for sr in reversed(spark_rows)],
            })

    return {"themes": themes}


@router.get("/puzzle-queue")
async def get_puzzle_queue(user: CurrentUser = Depends(get_current_user), limit: int = 10):
    """Puzzles due for spaced-repetition practice today, from this user's own
    analyzed games, prioritized by their top-3 weakness themes."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        theme_rows = await conn.fetch(
            """
            SELECT theme FROM app.mistake_pattern WHERE user_id = $1
            GROUP BY theme ORDER BY SUM(cp_loss) DESC LIMIT 3
            """,
            user.user_id,
        )
        top_themes = [r["theme"] for r in theme_rows]

        rows = await conn.fetch(
            """
            SELECT sp.fen, sp.best_move_san, sp.continuation, sp.theme, sp.cp_loss, sp.phase,
                   sp.source_white, sp.source_black, sp.source_date,
                   COALESCE(pp.streak, 0) AS streak,
                   COALESCE(pp.next_review_at, now()) AS next_review_at
            FROM app.saved_puzzle sp
            LEFT JOIN app.puzzle_progress pp ON pp.user_id = sp.user_id AND pp.puzzle_fen = sp.fen
            WHERE sp.user_id = $1
              AND COALESCE(pp.next_review_at, now()) <= now()
            ORDER BY (sp.theme = ANY($2::text[])) DESC, next_review_at ASC
            LIMIT $3
            """,
            user.user_id, top_themes, limit,
        )
    return {
        "top_themes": top_themes,
        "puzzles": [
            {
                "fen":           r["fen"],
                "best_move_san": r["best_move_san"],
                "continuation":  list(r["continuation"]),
                "theme":         r["theme"],
                "cp_loss":       r["cp_loss"],
                "phase":         r["phase"],
                "game_white":    r["source_white"],
                "game_black":    r["source_black"],
                "game_date":     r["source_date"],
                "streak":        r["streak"],
            }
            for r in rows
        ],
    }


# ── Analyzed-game & profile history (dashboard) ─────────────────────────────
#
# Deliberately NOT wired into the /game/stream or /profile/stream SSE
# endpoints themselves — those are delicate sync generators, and threading an
# asyncpg write through them risks the exact event-loop corruption bug this
# backend has already been bitten by once (see routers/analysis.py history).
# Instead the frontend calls these plain endpoints once, after a stream
# finishes, to save the finished result. Reading it back is then a pure
# hydration (no Stockfish/AI recompute), which is the whole point.

class SaveGameRequest(BaseModel):
    pgn: str
    white: Optional[str] = None
    black: Optional[str] = None
    game_date: Optional[str] = None
    result: Optional[str] = None
    event: Optional[str] = None
    player_color: str
    opening_name: Optional[str] = None
    opening_eco: Optional[str] = None
    estimated_elo: Optional[int] = None
    accuracy_white: Optional[float] = None
    accuracy_black: Optional[float] = None
    # Exactly what the frontend store needs to re-hydrate: metadata,
    # positions, opening, moves_data, ai_report, estimated_elo.
    payload: dict[str, Any]


@router.post("/games")
async def save_analyzed_game(req: SaveGameRequest, user: CurrentUser = Depends(get_current_user)):
    pgn_hash = hashlib.md5(req.pgn.encode()).hexdigest()
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO app.analyzed_game
                (user_id, pgn_hash, pgn, white, black, game_date, result, event, player_color,
                 opening_name, opening_eco, estimated_elo, accuracy_white, accuracy_black, payload, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb, now())
            ON CONFLICT (user_id, pgn_hash) DO UPDATE SET
                white          = EXCLUDED.white,
                black          = EXCLUDED.black,
                game_date      = EXCLUDED.game_date,
                result         = EXCLUDED.result,
                event          = EXCLUDED.event,
                player_color   = EXCLUDED.player_color,
                opening_name   = EXCLUDED.opening_name,
                opening_eco    = EXCLUDED.opening_eco,
                estimated_elo  = EXCLUDED.estimated_elo,
                accuracy_white = EXCLUDED.accuracy_white,
                accuracy_black = EXCLUDED.accuracy_black,
                payload        = EXCLUDED.payload,
                updated_at     = now()
            RETURNING id
            """,
            user.user_id, pgn_hash, req.pgn, req.white, req.black, req.game_date, req.result,
            req.event, req.player_color, req.opening_name, req.opening_eco, req.estimated_elo,
            req.accuracy_white, req.accuracy_black, json.dumps(req.payload),
        )
    return {"ok": True, "id": row["id"]}


@router.get("/games")
async def list_analyzed_games(user: CurrentUser = Depends(get_current_user), limit: int = 20):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, white, black, game_date, result, event, player_color,
                   opening_name, opening_eco, estimated_elo, accuracy_white, accuracy_black, created_at
            FROM app.analyzed_game
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            user.user_id, limit,
        )
    return {
        "games": [
            {
                "id":             r["id"],
                "white":          r["white"],
                "black":          r["black"],
                "game_date":      r["game_date"],
                "result":         r["result"],
                "event":          r["event"],
                "player_color":   r["player_color"],
                "opening_name":   r["opening_name"],
                "opening_eco":    r["opening_eco"],
                "estimated_elo":  r["estimated_elo"],
                "accuracy_white": r["accuracy_white"],
                "accuracy_black": r["accuracy_black"],
                "created_at":     r["created_at"].isoformat(),
            }
            for r in rows
        ]
    }


@router.get("/games/{game_id}")
async def get_analyzed_game(game_id: int, user: CurrentUser = Depends(get_current_user)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT pgn, player_color, payload, created_at FROM app.analyzed_game WHERE id = $1 AND user_id = $2",
            game_id, user.user_id,
        )
    if row is None:
        raise HTTPException(404, "Game not found")
    return {
        "pgn": row["pgn"],
        "player_color": row["player_color"],
        "payload": json.loads(row["payload"]),
        "created_at": row["created_at"].isoformat(),
    }


@router.delete("/games/{game_id}")
async def delete_analyzed_game(game_id: int, user: CurrentUser = Depends(get_current_user)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM app.analyzed_game WHERE id = $1 AND user_id = $2", game_id, user.user_id,
        )
    if result == "DELETE 0":
        raise HTTPException(404, "Game not found")
    return {"ok": True}


class SaveProfileRequest(BaseModel):
    provider: str  # "lichess" | "chesscom" | "pgn"
    username: Optional[str] = None
    player_name: str
    games_count: int = 0
    # Full ProfileStats plus the AI-written narrative — a pure hydration
    # source for the profile page, same idea as SaveGameRequest.payload.
    payload: dict[str, Any]


@router.post("/profiles")
async def save_profile(req: SaveProfileRequest, user: CurrentUser = Depends(get_current_user)):
    if req.provider not in ("lichess", "chesscom", "pgn"):
        raise HTTPException(400, "provider must be lichess, chesscom, or pgn")
    pool = await get_pool()
    async with pool.acquire() as conn:
        if req.provider == "pgn":
            # No stable identity to upsert on — every paste is its own
            # history entry (see migration comment: NULL username never
            # collides with the unique constraint).
            row = await conn.fetchrow(
                """
                INSERT INTO app.saved_profile (user_id, provider, username, player_name, games_count, payload, updated_at)
                VALUES ($1, 'pgn', NULL, $2, $3, $4::jsonb, now())
                RETURNING id
                """,
                user.user_id, req.player_name, req.games_count, json.dumps(req.payload),
            )
        else:
            if not req.username:
                raise HTTPException(400, "username is required for lichess/chesscom profiles")
            row = await conn.fetchrow(
                """
                INSERT INTO app.saved_profile (user_id, provider, username, player_name, games_count, payload, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
                ON CONFLICT (user_id, provider, username) DO UPDATE SET
                    player_name = EXCLUDED.player_name,
                    games_count = EXCLUDED.games_count,
                    payload     = EXCLUDED.payload,
                    updated_at  = now()
                RETURNING id
                """,
                user.user_id, req.provider, req.username, req.player_name, req.games_count, json.dumps(req.payload),
            )
    return {"ok": True, "id": row["id"]}


@router.get("/profiles")
async def list_saved_profiles(user: CurrentUser = Depends(get_current_user), limit: int = 20):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, provider, username, player_name, games_count, created_at
            FROM app.saved_profile
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            user.user_id, limit,
        )
    return {
        "profiles": [
            {
                "id":          r["id"],
                "provider":    r["provider"],
                "username":    r["username"],
                "player_name": r["player_name"],
                "games_count": r["games_count"],
                "created_at":  r["created_at"].isoformat(),
            }
            for r in rows
        ]
    }


@router.get("/profiles/{profile_id}")
async def get_saved_profile(profile_id: int, user: CurrentUser = Depends(get_current_user)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT player_name, payload, created_at FROM app.saved_profile WHERE id = $1 AND user_id = $2",
            profile_id, user.user_id,
        )
    if row is None:
        raise HTTPException(404, "Profile not found")
    return {
        "player_name": row["player_name"],
        "payload": json.loads(row["payload"]),
        "created_at": row["created_at"].isoformat(),
    }


@router.delete("/profiles/{profile_id}")
async def delete_saved_profile(profile_id: int, user: CurrentUser = Depends(get_current_user)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM app.saved_profile WHERE id = $1 AND user_id = $2", profile_id, user.user_id,
        )
    if result == "DELETE 0":
        raise HTTPException(404, "Profile not found")
    return {"ok": True}


@router.get("/puzzle-stats")
async def get_puzzle_stats(user: CurrentUser = Depends(get_current_user)):
    """Streak, today's solved count, total, and queue depth for the daily practice header."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        today_solved = await conn.fetchval(
            "SELECT COUNT(*) FROM app.puzzle_progress WHERE user_id = $1 AND solved = true AND DATE(solved_at) = CURRENT_DATE",
            user.user_id,
        )
        total_solved = await conn.fetchval(
            "SELECT COUNT(*) FROM app.puzzle_progress WHERE user_id = $1 AND solved = true",
            user.user_id,
        )
        queue_size = await conn.fetchval(
            """
            SELECT COUNT(*) FROM app.saved_puzzle sp
            LEFT JOIN app.puzzle_progress pp ON pp.user_id = sp.user_id AND pp.puzzle_fen = sp.fen
            WHERE sp.user_id = $1 AND COALESCE(pp.next_review_at, now()) <= now()
            """,
            user.user_id,
        )
        solve_dates = await conn.fetch(
            "SELECT DISTINCT DATE(solved_at) AS d FROM app.puzzle_progress WHERE user_id=$1 AND solved=true ORDER BY d DESC",
            user.user_id,
        )

    streak = 0
    if solve_dates:
        today     = datetime.date.today()
        yesterday = today - datetime.timedelta(days=1)
        first     = solve_dates[0]["d"]
        if first in (today, yesterday):
            streak   = 1
            expected = first - datetime.timedelta(days=1)
            for row in solve_dates[1:]:
                if row["d"] == expected:
                    streak  += 1
                    expected -= datetime.timedelta(days=1)
                else:
                    break

    return {
        "daily_streak": streak,
        "today_solved": int(today_solved),
        "total_solved": int(total_solved),
        "queue_size":   int(queue_size),
        "session_goal": 5,
    }


@router.get("/dashboard-summary")
async def get_dashboard_summary(user: CurrentUser = Depends(get_current_user)):
    """Overview counts for the account dashboard — cheap aggregate queries,
    no payload bodies, safe to call on every dashboard visit."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        games_count    = await conn.fetchval("SELECT COUNT(*) FROM app.analyzed_game WHERE user_id = $1", user.user_id)
        profiles_count = await conn.fetchval("SELECT COUNT(*) FROM app.saved_profile WHERE user_id = $1", user.user_id)
        puzzles_solved = await conn.fetchval(
            "SELECT COUNT(*) FROM app.puzzle_progress WHERE user_id = $1 AND solved = true", user.user_id,
        )
        best_streak = await conn.fetchval(
            "SELECT COALESCE(MAX(streak), 0) FROM app.puzzle_progress WHERE user_id = $1", user.user_id,
        )
        top_theme = await conn.fetchrow(
            """
            SELECT theme, SUM(cp_loss) AS total_cp_loss FROM app.mistake_pattern
            WHERE user_id = $1 GROUP BY theme ORDER BY SUM(cp_loss) DESC LIMIT 1
            """,
            user.user_id,
        )
        last_activity = await conn.fetchval(
            """
            SELECT MAX(t) FROM (
                SELECT MAX(created_at) AS t FROM app.analyzed_game WHERE user_id = $1
                UNION ALL
                SELECT MAX(created_at) AS t FROM app.saved_profile WHERE user_id = $1
                UNION ALL
                SELECT MAX(solved_at)  AS t FROM app.puzzle_progress WHERE user_id = $1 AND solved = true
            ) activity
            """,
            user.user_id,
        )
    return {
        "games_analyzed":   games_count,
        "profiles_built":   profiles_count,
        "puzzles_solved":   puzzles_solved,
        "best_streak":      best_streak,
        "top_mistake_theme": top_theme["theme"] if top_theme else None,
        "last_activity_at": last_activity.isoformat() if last_activity else None,
    }

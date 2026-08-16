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

import chess
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import CurrentUser, get_current_user
from db import get_pool
from puzzle_themes import (
    get_lichess_themes, puzzle_rating_range, EXPLORATION_THEMES,
    LICHESS_THEME_LABELS, weakness_from_lichess_theme,
)
from chess_analysis import classify_tactical_theme
from mistake_features import extract_position_features
from ai_service import elo_band
import cohort_service
import mistake_jobs

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
    puzzle_fen: str = ""     # For own-game puzzles (keyed by FEN)
    puzzle_id:  str = ""     # For Lichess puzzles (keyed by puzzle_id)
    source:     str = "own_game"   # "own_game" | "lichess"
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
        if req.source == "lichess" and req.puzzle_id:
            # Lichess puzzle progress — FSRS-lite (stability doubles on success)
            row = await conn.fetchrow(
                "SELECT solve_count, fail_count, stability FROM app.lichess_puzzle_progress WHERE user_id=$1 AND puzzle_id=$2",
                user.user_id, req.puzzle_id,
            )
            if row:
                stability = float(row["stability"])
                solve_count = row["solve_count"]
                fail_count  = row["fail_count"]
            else:
                stability = 1.5
                solve_count = 0
                fail_count  = 0

            if req.solved:
                new_stability = min(stability * 2.0, 90.0)
                solve_count += 1
                next_days = new_stability
            else:
                new_stability = max(1.5, stability * 0.5)
                fail_count += 1
                next_days = 1.0

            await conn.execute(
                """
                INSERT INTO app.lichess_puzzle_progress
                    (user_id, puzzle_id, solved, solve_count, fail_count,
                     last_solved, stability, next_due)
                VALUES ($1, $2, $3, $4, $5,
                        CASE WHEN $3 THEN now() ELSE NULL END, $6,
                        now() + ($7 * interval '1 day'))
                ON CONFLICT (user_id, puzzle_id) DO UPDATE SET
                    solved      = EXCLUDED.solved,
                    solve_count = EXCLUDED.solve_count,
                    fail_count  = EXCLUDED.fail_count,
                    last_solved = CASE WHEN EXCLUDED.solved THEN now()
                                       ELSE app.lichess_puzzle_progress.last_solved END,
                    stability   = EXCLUDED.stability,
                    next_due    = EXCLUDED.next_due
                """,
                user.user_id, req.puzzle_id, req.solved,
                solve_count, fail_count, new_stability, next_days,
            )
            return {"ok": True, "streak": solve_count, "next_review_in_days": round(next_days)}

        # Own-game puzzle progress (existing Leitner system)
        if not req.puzzle_fen:
            raise HTTPException(400, "puzzle_fen required for own_game puzzles")
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
    """Per-user aggregation of app.mistake_event — which tactical/positional
    themes cost this player the most, ranked by total cp lost (a proxy for
    Elo impact) rather than raw frequency, so one costly recurring pattern
    outranks several trivial ones. Drives both the coaching-report summary
    and the puzzle queue's prioritization below.

    Reads app.mistake_event (populated automatically for every flagged move
    of every saved game, see routers/user.py's save_analyzed_game), not the
    older app.mistake_pattern (which only ever sees a move a user explicitly
    clicked "explain" on, and is left untouched — still fed by
    /position/explain — for that narrower use).

    Each theme also carries `recent_occurrences` (last 30 days, vs the
    lifetime `occurrences` total), a `sparkline` of up to the last 8
    cp_loss values in chronological order, and an optional `cohort` field —
    an anonymized "players at your level typically miss this too" stat,
    None when the sample size is too small to be meaningful (see
    cohort_service.py)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT tactical_theme AS theme, COUNT(*) AS occurrences, AVG(cp_loss) AS avg_cp_loss, SUM(cp_loss) AS total_cp_loss,
                   COUNT(*) FILTER (WHERE occurred_at >= now() - interval '30 days') AS recent_occurrences
            FROM app.mistake_event
            WHERE user_id = $1 AND tactical_theme IS NOT NULL
            GROUP BY tactical_theme
            ORDER BY SUM(cp_loss) DESC
            LIMIT $2
            """,
            user.user_id, limit,
        )

        user_band = await conn.fetchval(
            "SELECT elo_band FROM app.mistake_event WHERE user_id = $1 AND elo_band IS NOT NULL ORDER BY occurred_at DESC LIMIT 1",
            user.user_id,
        )

        themes = []
        for r in rows:
            spark_rows = await conn.fetch(
                """
                SELECT cp_loss FROM app.mistake_event
                WHERE user_id = $1 AND tactical_theme = $2
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
                "cohort":             await cohort_service.get_cohort_stats(user_band, r["theme"]),
            })

    return {"themes": themes}


def _parse_lichess_puzzle(fen: str, moves_str: str) -> dict | None:
    """Convert a Lichess puzzle (raw FEN + UCI moves) into our unified puzzle dict.

    Lichess encoding:
      FEN   = position BEFORE the opponent's forcing move
      moves[0] = opponent's forcing move (auto-apply, shown as context)
      moves[1], moves[3], … = user's solution moves (what we ask for)
      moves[2], moves[4], … = opponent auto-responses between solution moves
    """
    moves = moves_str.strip().split()
    if len(moves) < 2:
        return None
    try:
        board = chess.Board(fen)
        setup_uci  = chess.Move.from_uci(moves[0])
        setup_san  = board.san(setup_uci)
        board.push(setup_uci)
        puzzle_fen = board.fen()

        solution_sans: list[str] = []
        response_sans: list[str] = []
        for i, uci in enumerate(moves[1:]):
            mv = chess.Move.from_uci(uci)
            san = board.san(mv)
            board.push(mv)
            if i % 2 == 0:
                solution_sans.append(san)
            else:
                response_sans.append(san)

        # Full line for post-solve display (setup + all solution/response moves)
        full_line = [setup_san] + [
            m for pair in zip(solution_sans, response_sans + [""])
            for m in pair if m
        ]

        return {
            "puzzle_fen":    puzzle_fen,
            "setup_move_san": setup_san,
            "solution_sans": solution_sans,
            "response_sans": response_sans,
            "best_move_san": solution_sans[0] if solution_sans else "",
            "continuation":  full_line,
        }
    except Exception:
        return None


@router.get("/puzzle-queue")
async def get_puzzle_queue(user: CurrentUser = Depends(get_current_user), limit: int = 10):
    """Mixed daily puzzle queue:

    1. Own-game puzzles due for spaced-repetition review (highest priority —
       these come directly from the user's mistakes).
    2. Lichess DB puzzles targeted to the user's top weakness themes at an
       ELO-appropriate difficulty (70% weakness-targeted, 30% exploration).

    Lichess puzzles are only shown if the database has been populated via the
    import script (backend/scripts/import_lichess_puzzles.py).  If the table
    is empty the endpoint falls back to own-game puzzles only — no error.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        # ── 1. User's weakness profile ────────────────────────────────────
        # mistake_event's tactical_theme uses the same deterministic
        # classify_tactical_theme() vocabulary as saved_puzzle.theme below,
        # so the ANY($2::text[]) weighting a few lines down actually
        # matches now (mistake_pattern.theme was LLM free text from
        # /position/explain, which barely overlapped with saved_puzzle's
        # fixed vocabulary -- that comparison was close to a no-op before).
        theme_rows = await conn.fetch(
            """
            SELECT tactical_theme AS theme FROM app.mistake_event
            WHERE user_id = $1 AND tactical_theme IS NOT NULL
            GROUP BY tactical_theme ORDER BY SUM(cp_loss) DESC LIMIT 5
            """,
            user.user_id,
        )
        top_themes = [r["theme"] for r in theme_rows]

        top_cognitive_error = await conn.fetchval(
            """
            SELECT cognitive_error_type FROM app.mistake_event
            WHERE user_id = $1 AND cognitive_error_type IS NOT NULL
            GROUP BY cognitive_error_type ORDER BY COUNT(*) DESC LIMIT 1
            """,
            user.user_id,
        )

        # ── 2. Own-game puzzles due for review ────────────────────────────
        # LEFT JOIN LATERAL (not a plain join) because mistake_event has no
        # uniqueness constraint on (user_id, fen_before, best_move_san) --
        # a plain join could fan out and duplicate rows past LIMIT. Rows
        # with no linkable mistake_event (puzzle predates the ledger, or
        # its source game was deleted) fall through unaffected to the
        # existing theme-match/due-date ordering.
        own_rows = await conn.fetch(
            """
            SELECT sp.fen, sp.best_move_san, sp.continuation, sp.theme, sp.cp_loss, sp.phase,
                   sp.source_white, sp.source_black, sp.source_date,
                   COALESCE(pp.streak, 0) AS streak,
                   me.is_recurrence, me.cognitive_error_type
            FROM app.saved_puzzle sp
            LEFT JOIN app.puzzle_progress pp ON pp.user_id = sp.user_id AND pp.puzzle_fen = sp.fen
            LEFT JOIN LATERAL (
                SELECT
                    (m.recurred_event_id IS NOT NULL
                     OR EXISTS (SELECT 1 FROM app.mistake_event later WHERE later.recurred_event_id = m.id)
                    ) AS is_recurrence,
                    m.cognitive_error_type
                FROM app.mistake_event m
                WHERE m.user_id = sp.user_id AND m.fen_before = sp.fen AND m.best_move_san = sp.best_move_san
                ORDER BY m.occurred_at DESC LIMIT 1
            ) me ON TRUE
            WHERE sp.user_id = $1
              AND COALESCE(pp.next_review_at, now()) <= now()
            ORDER BY COALESCE(me.is_recurrence, FALSE) DESC,
                     (me.cognitive_error_type IS NOT NULL AND me.cognitive_error_type = $4) DESC,
                     (sp.theme = ANY($2::text[])) DESC,
                     COALESCE(pp.next_review_at, now()) ASC
            LIMIT $3
            """,
            user.user_id, top_themes, limit, top_cognitive_error,
        )
        puzzles: list[dict] = [
            {
                "source":        "own_game",
                "puzzle_id":     None,
                "fen":           r["fen"],
                "setup_move_san": None,
                "solution_sans": [r["best_move_san"]],
                "response_sans": [],
                "best_move_san": r["best_move_san"],
                "continuation":  list(r["continuation"] or []),
                "theme":         r["theme"],
                "theme_lichess": "",
                "theme_label":   r["theme"] or "Tactical",
                "themes":        [r["theme"]] if r["theme"] else [],
                "classification": "",
                "cp_loss":       r["cp_loss"],
                "phase":         r["phase"],
                "game_white":    r["source_white"],
                "game_black":    r["source_black"],
                "game_white_rating": None,
                "game_black_rating": None,
                "game_result":   None,
                "game_event":    None,
                "game_date":     str(r["source_date"]) if r["source_date"] else "",
                "lichess_url":   None,
                "rating":        None,
                "streak":        r["streak"],
            }
            for r in own_rows
        ]

        remaining = limit - len(puzzles)
        if remaining <= 0:
            return {"top_themes": top_themes, "puzzles": puzzles}

        # ── 3. Check whether Lichess DB has any puzzles ───────────────────
        lp_count = await conn.fetchval("SELECT COUNT(*) FROM app.lichess_puzzles")
        if lp_count == 0:
            return {"top_themes": top_themes, "puzzles": puzzles}

        # ── 4. User's estimated ELO → puzzle rating range ─────────────────
        elo_row = await conn.fetchrow(
            """
            SELECT estimated_elo FROM app.analyzed_game
            WHERE user_id = $1 AND estimated_elo IS NOT NULL
            ORDER BY created_at DESC LIMIT 1
            """,
            user.user_id,
        )
        estimated_elo = int(elo_row["estimated_elo"]) if elo_row else 1200
        p_min, p_max = puzzle_rating_range(estimated_elo)

        # IDs the user has already seen (not due again yet)
        seen = await conn.fetch(
            "SELECT puzzle_id FROM app.lichess_puzzle_progress WHERE user_id=$1 AND next_due > now()",
            user.user_id,
        )
        seen_ids = [r["puzzle_id"] for r in seen]

        # ── 5a. Weakness-targeted Lichess puzzles (70%) ───────────────────
        n_targeted = max(1, int(remaining * 0.7))
        lichess_themes: list[str] = []
        for wt in top_themes[:3]:
            lichess_themes.extend(get_lichess_themes(wt))

        targeted_rows = []
        if lichess_themes:
            targeted_rows = await conn.fetch(
                """
                SELECT puzzle_id, fen, moves, rating, themes,
                       game_white, game_black, game_white_rating, game_black_rating,
                       game_result, game_event, game_date, game_opening_name, game_url
                FROM app.lichess_puzzles
                WHERE themes && $1::text[]
                  AND rating BETWEEN $2 AND $3
                  AND rating_deviation < 150
                  AND popularity > 30
                  AND NOT (puzzle_id = ANY($4::text[]))
                ORDER BY random()
                LIMIT $5
                """,
                lichess_themes, p_min, p_max, seen_ids, n_targeted,
            )

        # ── 5b. Exploration Lichess puzzles (30%) ─────────────────────────
        n_explore = remaining - len(targeted_rows)
        explore_rows = []
        if n_explore > 0:
            already_ids = seen_ids + [r["puzzle_id"] for r in targeted_rows]
            explore_rows = await conn.fetch(
                """
                SELECT puzzle_id, fen, moves, rating, themes,
                       game_white, game_black, game_white_rating, game_black_rating,
                       game_result, game_event, game_date, game_opening_name, game_url
                FROM app.lichess_puzzles
                WHERE themes && $1::text[]
                  AND rating BETWEEN $2 AND $3
                  AND rating_deviation < 150
                  AND popularity > 30
                  AND NOT (puzzle_id = ANY($4::text[]))
                ORDER BY random()
                LIMIT $5
                """,
                EXPLORATION_THEMES, p_min, p_max, already_ids, n_explore,
            )

        # ── 6. Parse Lichess puzzles into unified format ──────────────────
        for r in list(targeted_rows) + list(explore_rows):
            parsed = _parse_lichess_puzzle(r["fen"], r["moves"])
            if not parsed:
                continue

            themes_list = list(r["themes"] or [])
            primary_theme = weakness_from_lichess_theme(themes_list[0]) if themes_list else "Tactical"
            theme_label   = LICHESS_THEME_LABELS.get(themes_list[0], primary_theme) if themes_list else "Tactical"

            # Format result for display ("1-0" → "White won", etc.)
            result_raw = r["game_result"] or ""
            result_display = {"1-0": "White won", "0-1": "Black won", "1/2-1/2": "Draw"}.get(result_raw, "")

            puzzles.append({
                "source":        "lichess",
                "puzzle_id":     r["puzzle_id"],
                "fen":           parsed["puzzle_fen"],
                "setup_move_san": parsed["setup_move_san"],
                "solution_sans": parsed["solution_sans"],
                "response_sans": parsed["response_sans"],
                "best_move_san": parsed["best_move_san"],
                "continuation":  parsed["continuation"],
                "theme":         primary_theme,
                "theme_lichess": themes_list[0] if themes_list else "",
                "theme_label":   theme_label,
                "themes":        themes_list,
                "classification": "",
                "cp_loss":       0,
                "phase":         _detect_phase_from_themes(themes_list),
                "game_white":    r["game_white"] or "White",
                "game_black":    r["game_black"] or "Black",
                "game_white_rating": r["game_white_rating"],
                "game_black_rating": r["game_black_rating"],
                "game_result":   result_raw,
                "game_result_display": result_display,
                "game_event":    r["game_event"] or "Lichess",
                "game_date":     str(r["game_date"]) if r["game_date"] else "",
                "lichess_url":   r["game_url"],
                "rating":        r["rating"],
                "streak":        0,
            })

    return {"top_themes": top_themes, "puzzles": puzzles}


def _detect_phase_from_themes(themes: list[str]) -> str:
    for t in themes:
        if t in {"endgame", "rookEndgame", "queenEndgame", "bishopEndgame",
                 "knightEndgame", "pawnEndgame", "queenRookEndgame"}:
            return "Endgame"
        if t in {"opening", "attackingF2F7"}:
            return "Opening"
    return "Middlegame"


# ── Analyzed-game & profile history (dashboard) ─────────────────────────────
#
# Deliberately NOT wired into the /game/stream or /profile/stream SSE
# endpoints themselves — those are delicate sync generators, and threading an
# asyncpg write through them risks the exact event-loop corruption bug this
# backend has already been bitten by once (see routers/analysis.py history).
# Instead the frontend calls these plain endpoints once, after a stream
# finishes, to save the finished result. Reading it back is then a pure
# hydration (no Stockfish/AI recompute), which is the whole point.

# ── Mistake ledger ("Recurrence Engine") ─────────────────────────────────────
#
# Populated automatically for every flagged move of the signed-in player's
# OWN moves, right alongside the analyzed_game save below — not just when a
# user clicks "explain" on one move (that's the older app.mistake_pattern,
# fed only by /position/explain in routers/analysis.py, left untouched).

_FLAGGED_CLASSIFICATIONS = ("Blunder", "Mistake", "Inaccuracy")


async def _persist_mistake_events(
    conn, user_id: str, game_id: int, player_color: str,
    estimated_elo: Optional[int], moves_data: list, positions: list,
) -> list[tuple[int, Optional[str]]]:
    """Idempotent: fully replaces this game's mistake_event rows every save,
    mirroring analyzed_game's own ON CONFLICT DO UPDATE upsert semantics on
    re-analysis. Only captures the signed-in player's own flagged moves
    (matches _estimate_game_elo's existing player-only filter elsewhere in
    this codebase) -- this is a self-improvement ledger, not an
    opponent-mistake tracker. Returns the (id, tactical_theme) pairs
    inserted, for the recurrence-linking pass and the cognitive-error
    backfill job that follow."""
    await conn.execute("DELETE FROM app.mistake_event WHERE game_id = $1", game_id)
    player_cap = player_color.capitalize()
    band = elo_band(estimated_elo)
    inserted: list[tuple[int, Optional[str]]] = []

    for i, m in enumerate(moves_data):
        if m.get("color") != player_cap:
            continue
        classification = m.get("classification", "")
        if not any(k in classification for k in _FLAGGED_CLASSIFICATIONS):
            continue
        fen_before = positions[i] if i < len(positions) else None
        if not fen_before:
            continue
        fen_after = m.get("fen") or (positions[i + 1] if i + 1 < len(positions) else fen_before)
        move_san = m.get("move_san") or m.get("san", "")
        if not move_san:
            continue
        best_move_san = m.get("best_move_san")

        theme = None
        try:
            if best_move_san:
                best_uci = chess.Board(fen_before).parse_san(best_move_san).uci()
                theme = classify_tactical_theme(fen_before, best_uci, m.get("phase", "Middlegame"))
        except Exception:
            logger.warning("mistake_event theme classification failed: game=%s ply=%s", game_id, i, exc_info=True)

        try:
            features = extract_position_features(fen_before, move_san)
        except Exception:
            logger.warning("mistake_event position_features failed: game=%s ply=%s", game_id, i, exc_info=True)
            features = {}

        row = await conn.fetchrow(
            """
            INSERT INTO app.mistake_event
                (user_id, game_id, move_number, color, ply, fen_before, fen_after,
                 move_san, best_move_san, classification, cp_loss, phase,
                 tactical_theme, position_features, elo_band)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
            RETURNING id
            """,
            user_id, game_id, m.get("move_number", 0), player_cap, i, fen_before, fen_after,
            move_san, best_move_san, classification, m.get("cp_loss", 0), m.get("phase"),
            theme, json.dumps(features), band,
        )
        inserted.append((row["id"], theme))

    # Phase 2: recurrence linking. Excludes this same game (game_id <> $3)
    # so a game with the same theme twice doesn't link to itself, and the
    # NOT EXISTS clause keeps each historical mistake cited as "the previous
    # occurrence" at most once, forming a clean chain rather than every
    # later mistake fanning out to the same old row.
    for event_id, theme in inserted:
        if not theme:
            continue
        await conn.execute(
            """
            WITH candidate AS (
                SELECT me.id FROM app.mistake_event me
                WHERE me.user_id = $1 AND me.tactical_theme = $2 AND me.game_id <> $3
                  AND NOT EXISTS (SELECT 1 FROM app.mistake_event later WHERE later.recurred_event_id = me.id)
                ORDER BY me.id DESC LIMIT 1
            )
            UPDATE app.mistake_event SET recurred_event_id = candidate.id
            FROM candidate WHERE app.mistake_event.id = $4
            """,
            user_id, theme, game_id, event_id,
        )
    return inserted


async def _persist_opponent_mistake_events(
    conn, tracked_by_user_id: str, game_id: int, player_color: str,
    opponent_name: Optional[str], moves_data: list, positions: list,
) -> None:
    """Same idempotent pattern as _persist_mistake_events, mirrored onto the
    OPPONENT's side of the board. Kept in a separate table (not user_id rows
    in mistake_event) since every existing mistake_event reader treats
    user_id as "who made this mistake" -- opponent errors under the
    tracker's own user_id would pollute their own stats. No-ops when the
    opponent has no name (nothing to key the identity on)."""
    opponent_name = (opponent_name or "").strip()
    if not opponent_name:
        return
    await conn.execute(
        "DELETE FROM app.opponent_mistake_event WHERE game_id = $1", game_id
    )
    opponent_cap = "Black" if player_color.capitalize() == "White" else "White"

    for i, m in enumerate(moves_data):
        if m.get("color") != opponent_cap:
            continue
        classification = m.get("classification", "")
        if not any(k in classification for k in _FLAGGED_CLASSIFICATIONS):
            continue
        fen_before = positions[i] if i < len(positions) else None
        if not fen_before:
            continue
        fen_after = m.get("fen") or (positions[i + 1] if i + 1 < len(positions) else fen_before)
        move_san = m.get("move_san") or m.get("san", "")
        if not move_san:
            continue
        best_move_san = m.get("best_move_san")

        theme = None
        try:
            if best_move_san:
                best_uci = chess.Board(fen_before).parse_san(best_move_san).uci()
                theme = classify_tactical_theme(fen_before, best_uci, m.get("phase", "Middlegame"))
        except Exception:
            logger.warning("opponent_mistake_event theme classification failed: game=%s ply=%s", game_id, i, exc_info=True)

        try:
            features = extract_position_features(fen_before, move_san)
        except Exception:
            logger.warning("opponent_mistake_event position_features failed: game=%s ply=%s", game_id, i, exc_info=True)
            features = {}

        await conn.execute(
            """
            INSERT INTO app.opponent_mistake_event
                (tracked_by_user_id, opponent_name, game_id, move_number, color, ply,
                 fen_before, fen_after, move_san, best_move_san, classification, cp_loss,
                 phase, tactical_theme, position_features, clock_remaining, elo_band)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17)
            """,
            tracked_by_user_id, opponent_name, game_id, m.get("move_number", 0), opponent_cap, i,
            fen_before, fen_after, move_san, best_move_san, classification, m.get("cp_loss", 0),
            m.get("phase"), theme, json.dumps(features), m.get("clock_remaining"), None,
        )


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
        async with conn.transaction():
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
            game_id = row["id"]
            new_events = await _persist_mistake_events(
                conn, user.user_id, game_id, req.player_color, req.estimated_elo,
                req.payload.get("moves_data") or [], req.payload.get("positions") or [],
            )
            opponent_name = req.black if req.player_color.capitalize() == "White" else req.white
            await _persist_opponent_mistake_events(
                conn, user.user_id, game_id, req.player_color, opponent_name,
                req.payload.get("moves_data") or [], req.payload.get("positions") or [],
            )

    if new_events:
        try:
            mistake_jobs.enqueue_classify_cognitive_errors(game_id)
        except Exception:
            logger.warning("Failed to enqueue cognitive-error job for game %s", game_id, exc_info=True)

    return {"ok": True, "id": game_id}


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
        # Own-game puzzles solved today
        own_today = await conn.fetchval(
            "SELECT COUNT(*) FROM app.puzzle_progress WHERE user_id = $1 AND solved = true AND DATE(solved_at) = CURRENT_DATE",
            user.user_id,
        )
        # Lichess puzzles solved today
        lichess_today = await conn.fetchval(
            "SELECT COUNT(*) FROM app.lichess_puzzle_progress WHERE user_id = $1 AND solved = true AND DATE(last_solved) = CURRENT_DATE",
            user.user_id,
        )
        today_solved = int(own_today) + int(lichess_today)

        # Total solved (all time)
        own_total = await conn.fetchval(
            "SELECT COUNT(*) FROM app.puzzle_progress WHERE user_id = $1 AND solved = true",
            user.user_id,
        )
        lichess_total = await conn.fetchval(
            "SELECT COUNT(*) FROM app.lichess_puzzle_progress WHERE user_id = $1 AND solved = true",
            user.user_id,
        )
        total_solved = int(own_total) + int(lichess_total)

        # Queue size = own-game due + Lichess puzzles not yet seen or next_due <= now
        own_queue = await conn.fetchval(
            """
            SELECT COUNT(*) FROM app.saved_puzzle sp
            LEFT JOIN app.puzzle_progress pp ON pp.user_id = sp.user_id AND pp.puzzle_fen = sp.fen
            WHERE sp.user_id = $1 AND COALESCE(pp.next_review_at, now()) <= now()
            """,
            user.user_id,
        )
        lichess_queue = await conn.fetchval(
            """
            SELECT COUNT(*) FROM app.lichess_puzzles lp
            WHERE NOT EXISTS (
                SELECT 1 FROM app.lichess_puzzle_progress lpp
                WHERE lpp.user_id = $1 AND lpp.puzzle_id = lp.puzzle_id
                  AND lpp.next_due > NOW()
            )
            AND lp.rating BETWEEN 600 AND 2800
            LIMIT 200
            """,
            user.user_id,
        )
        queue_size = int(own_queue) + min(int(lichess_queue), 50)

        total_saved = await conn.fetchval(
            "SELECT COUNT(*) FROM app.saved_puzzle WHERE user_id = $1", user.user_id,
        )
        # Total "ever seen" includes own-game saved + Lichess puzzles in the bank
        lichess_bank = await conn.fetchval("SELECT COUNT(*) FROM app.lichess_puzzles")
        total_saved = int(total_saved) + int(lichess_bank)

        next_due_own = await conn.fetchval(
            """
            SELECT MIN(pp.next_review_at)
            FROM app.saved_puzzle sp
            JOIN app.puzzle_progress pp ON pp.user_id = sp.user_id AND pp.puzzle_fen = sp.fen
            WHERE sp.user_id = $1 AND pp.next_review_at > now()
            """,
            user.user_id,
        )
        next_due_lichess = await conn.fetchval(
            "SELECT MIN(next_due) FROM app.lichess_puzzle_progress WHERE user_id = $1 AND next_due > now()",
            user.user_id,
        )
        # Pick the earlier of the two next-due timestamps
        if next_due_own and next_due_lichess:
            next_due_at = min(next_due_own, next_due_lichess)
        else:
            next_due_at = next_due_own or next_due_lichess

        # Streak: union both solve-date sets
        own_dates = await conn.fetch(
            "SELECT DISTINCT DATE(solved_at) AS d FROM app.puzzle_progress WHERE user_id=$1 AND solved=true",
            user.user_id,
        )
        lichess_dates = await conn.fetch(
            "SELECT DISTINCT DATE(last_solved) AS d FROM app.lichess_puzzle_progress WHERE user_id=$1 AND solved=true",
            user.user_id,
        )
        all_dates_set = {r["d"] for r in own_dates} | {r["d"] for r in lichess_dates}
        solve_dates = sorted(all_dates_set, reverse=True)

    streak = 0
    if solve_dates:
        today     = datetime.date.today()
        yesterday = today - datetime.timedelta(days=1)
        first     = solve_dates[0]
        if first in (today, yesterday):
            streak   = 1
            expected = first - datetime.timedelta(days=1)
            for d in solve_dates[1:]:
                if d == expected:
                    streak  += 1
                    expected -= datetime.timedelta(days=1)
                else:
                    break

    return {
        "daily_streak": streak,
        "today_solved": int(today_solved),
        "total_solved": int(total_solved),
        "queue_size":   int(queue_size),
        "total_saved":  int(total_saved),
        "session_goal": 5,
        "next_due_at":  next_due_at.isoformat() if next_due_at else None,
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
            SELECT tactical_theme AS theme, SUM(cp_loss) AS total_cp_loss FROM app.mistake_event
            WHERE user_id = $1 AND tactical_theme IS NOT NULL
            GROUP BY tactical_theme ORDER BY SUM(cp_loss) DESC LIMIT 1
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

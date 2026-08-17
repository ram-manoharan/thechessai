"""Background job queue for full-game analysis (Stockfish + AI report),
decoupling the actual engine/LLM work from the web request's lifetime.

Previously /api/analysis/game/stream ran the ENTIRE analysis inline on
whatever thread FastAPI's threadpool handed the request, holding an SSE
connection open for however long that took (tens of seconds, sometimes a
couple of minutes for a long "deep" game) -- one thread, one engine slot,
one HTTP connection, all tied up for the whole duration. Every request past
the pool size just queued behind whichever one got there first, and the web
tier itself couldn't be scaled independently of engine capacity because the
engine work was running ON the web tier.

This module enqueues that same work as an RQ job instead. The web tier
(routers/analysis.py's /game/enqueue + /game/status endpoints) only ever
enqueues a job or reads its status/result -- both cheap, non-blocking
operations -- while a SEPARATE worker process (worker.py) actually runs it.
Scaling the analysis pipeline is now "run more worker.py processes",
independent of how many web replicas are running.

The OLD /game and /game/stream endpoints in routers/analysis.py are left
completely untouched by this -- this whole module is purely additive.
"""
import os
import logging
from typing import Optional

import redis
from rq import Queue, get_current_job
from rq.job import Job

logger = logging.getLogger(__name__)

QUEUE_NAME = "analysis"
# How long a job may run before RQ kills it -- generous (a "deep" depth-18
# analysis of a long game is the slow case) but bounded, so a genuinely
# stuck job doesn't sit in "started" forever and silently eat a worker slot.
JOB_TIMEOUT_SECONDS = 300
# How long a finished job's result/meta stays fetchable -- no polling client
# is realistically still checking much past this.
RESULT_TTL_SECONDS = 3600

_redis_conn: Optional["redis.Redis"] = None


def _redis_connection() -> "redis.Redis":
    """A dedicated connection for RQ, deliberately NOT cache_service's
    decode_responses=True client -- RQ pickles job payloads as bytes and
    needs a raw byte-mode connection."""
    global _redis_conn
    if _redis_conn is None:
        _redis_conn = redis.from_url(os.environ["REDIS_URL"])
    return _redis_conn


def get_queue() -> Queue:
    return Queue(QUEUE_NAME, connection=_redis_connection(), default_timeout=JOB_TIMEOUT_SECONDS)


def get_job(job_id: str) -> Optional[Job]:
    try:
        return Job.fetch(job_id, connection=_redis_connection())
    except Exception:
        return None


def enqueue_game_analysis(pgn: str, player_color: str, ai_report: bool, kid_mode: bool) -> Job:
    queue = get_queue()
    return queue.enqueue(
        run_full_game_analysis,
        pgn, player_color, ai_report, kid_mode,
        job_timeout=JOB_TIMEOUT_SECONDS,
        result_ttl=RESULT_TTL_SECONDS,
        failure_ttl=RESULT_TTL_SECONDS,
    )


class AnalysisNoMovesError(Exception):
    """Mirrors /game's existing 422 -- a syntactically valid PGN with no
    actual moves to analyse (an aborted game, headers only)."""


def run_full_game_analysis(pgn: str, player_color: str, ai_report: bool, kid_mode: bool) -> dict:
    """The real work -- runs inside a worker process (worker.py), never the
    web process. Writes intermediate progress to the job's own `meta` as it
    goes, so a polling client can render the board/move list as soon as
    Stockfish is done without waiting on the (often slower) AI report too --
    the same two-stage reveal /game/stream gave for free via SSE, just
    polled instead of pushed.

    Field names/shapes deliberately match /game's existing response body
    (metadata, positions, opening, moves_data, ai_report, estimated_elo) so
    the frontend's existing parsing logic for that shape needs no rewrite --
    only the transport (poll vs. stream) changes.
    """
    # Imported here, not at module top: these only need to work in the
    # WORKER process (where worker.py has already called
    # engine_pool.init_pool()), and importing chess_analysis at module load
    # time in the WEB process would start pulling in engine_pool too, adding
    # an import-time dependency the web process doesn't otherwise need.
    from chess_analysis import StockfishService, OpeningDBService
    from ai_service import AIService
    from routers.analysis import _build_positions, _parse_metadata, _estimate_game_elo, _enrich

    job = get_current_job()

    def _set_meta(**kwargs):
        if job is None:  # e.g. called directly in a test, outside RQ
            return
        job.meta.update(kwargs)
        job.save_meta()

    positions = _build_positions(pgn)
    metadata = _parse_metadata(pgn)

    def _report_progress(current: int, total: int):
        # Best-effort -- if two engine-pool worker threads race here (only
        # possible when engine_pool's POOL_SIZE > 1), last-write-wins on the
        # meta write is fine for a progress readout; it self-corrects on the
        # very next callback a moment later.
        _set_meta(stage="analyzing", current=current, total=total)

    stockfish = StockfishService(depth=12)
    moves_data = stockfish.analyze_game_moves(
        pgn, player_color, depth=12, progress_callback=_report_progress,
    )

    if not moves_data:
        raise AnalysisNoMovesError(
            "This game has no moves to analyse. Please select a game that was actually played."
        )

    san_moves = [m.get("move_san", "") for m in moves_data]
    opening = OpeningDBService().identify_opening(san_moves[:12])
    enriched = _enrich(moves_data, positions)
    estimated_elo = _estimate_game_elo(pgn, player_color, moves_data)

    result = {
        "metadata":         metadata,
        "positions":        positions,
        "opening":          opening,
        "moves_data":       enriched,
        "estimated_elo":    estimated_elo,
        "ai_report":        None,
        "kid_commentaries": None,
    }
    _set_meta(stage="moves_ready", **result)

    ai = AIService()
    if ai_report and getattr(ai, "model_available", False):
        if kid_mode:
            result["ai_report"] = ai.analyze_game_kid_mode(pgn, moves_data, player_color)
            try:
                result["kid_commentaries"] = ai.generate_kid_move_commentaries(
                    moves_data, pgn, player_color
                )
            except Exception:
                logger.warning("Kid-mode commentary generation failed", exc_info=True)
        else:
            result["ai_report"] = ai.analyze_game(pgn, moves_data, player_color, estimated_elo=estimated_elo)

    return result

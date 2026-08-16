"""'Play it out from here' -- replay a position from an analyzed game against
a human-calibrated opponent instead of the raw engine.

Deliberately stateless: the frontend already holds the full analyzed game
(positions[], movesData[]) in its store, so there's nothing worth persisting
server-side for what is fundamentally a one-off "what if" sandbox, not a
saved artifact. Each call is handed everything it needs -- the current FEN,
the real opponent's rating, and (for the fingerprint layer) that specific
opponent's own per-phase error rate from the game just analyzed.

Phase 1 -- rating-matched Maia: human_engine_pool.play_human_move() picks
the Maia weight band nearest the opponent's actual rating and returns the
move a human at that level would most likely play.

Phase 2 -- opponent fingerprint: generic Maia-1500 plays like an average
1500. This specific opponent might have blundered far more than average in
the endgame in the very game being replayed. error_rate_by_phase (computed
client-side from the game's own per-move classifications, already available
in the store) gives a per-phase probability; when it fires, the reply is
swapped for the worst of Stockfish's top-3 candidates instead of Maia's
pick -- a real, legal, plausible-but-suboptimal move, not random noise.
"""
import logging
import random
from typing import Optional

import chess
import chess.engine
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import engine_pool
import human_engine_pool
import opponent_profile
from auth import CurrentUser, get_current_user
from chess_analysis import classify_tactical_theme

logger = logging.getLogger(__name__)
router = APIRouter()

# Cap on how often the fingerprint layer can override Maia -- even an
# opponent who blundered in every single instance of a phase in one game is
# a small sample; treating that as "always blunders here" would make the
# replay feel absurd rather than calibrated.
MAX_DEVIATION_PROB = 0.65
_DEVIATION_DEPTH = 10  # shallow/fast -- this only needs "plausible", not exact

# Both Stockfish calls below share the same engine pool as full-game
# analysis -- there's no separate Maia-only pool to fall back to yet (that's
# a real infra addition, tracked as a later scale item, not a Phase 0 one).
# What Phase 0 CAN do cheaply: both calls are already best-effort by design
# (eval_cp is a nice-to-have overlay, the deviation search falls back to
# Maia's own move on any failure) -- they just didn't act like it timing-wise,
# using the same ~25s default acquire timeout as someone waiting on a full
# game analysis. A short, dedicated timeout here means a busy analysis queue
# degrades a replay move to "fast, no eval overlay" instead of "wait behind
# whatever full-game analysis is already holding the engine."
_REPLAY_ACQUIRE_TIMEOUT_SECONDS = 3.0

# Ply-based proxy for "opponent is likely running low on real-game clock" --
# no time control is known at replay start (and simulating only the
# opponent's clock while the user's own is absent would be incoherent), so
# this ramps the deviation probability up over the back half of a typical
# game instead of tracking an actual countdown.
_TIME_PRESSURE_START_MOVE = 25
_TIME_PRESSURE_RAMP_MOVES = 20
_TIME_PRESSURE_MAX_BOOST = 0.25


class ReplayMoveRequest(BaseModel):
    fen: str
    opponent_rating: Optional[int] = None
    error_rate_by_phase: Optional[dict[str, float]] = None
    phase: Optional[str] = None
    opponent_name: Optional[str] = None


def _game_state(board: chess.Board) -> dict:
    result = board.result() if board.is_game_over() else None
    return {
        "fen":           board.fen(),
        "in_check":      board.is_check(),
        "is_checkmate":  board.is_checkmate(),
        "is_stalemate":  board.is_stalemate(),
        "is_game_over":  board.is_game_over(),
        "result":        result,
    }


def _evaluate(board: chess.Board) -> Optional[int]:
    """Shallow Stockfish eval (White-perspective centipawns) of the position
    after the opponent's reply -- lets the frontend show how this replay
    line compares to what actually happened in the game at the same point.
    Best-effort: None on checkmate/stalemate (no eval applies) or on any
    engine failure, since this is a nice-to-have overlay, never a
    dependency the move-generation response should fail over."""
    if board.is_game_over():
        return None
    try:
        with engine_pool.acquire(kind="interactive", timeout=_REPLAY_ACQUIRE_TIMEOUT_SECONDS) as sf:
            lines = engine_pool.cached_analyse(sf, board, depth=_DEVIATION_DEPTH, multi_pv=1)
        if lines:
            return lines[0]["score"].white().score(mate_score=10000)
    except Exception:
        logger.warning("Replay position eval failed", exc_info=True)
    return None


def _find_deviation(
    board: chess.Board, maia_move: chess.Move,
    theme_weights: Optional[dict[str, float]] = None, phase: Optional[str] = None,
) -> Optional[chess.Move]:
    """Best-effort: a plausible-but-suboptimal candidate for the side to
    move, excluding Maia's own pick. Returns None (falls back to Maia) on
    any failure -- the fingerprint layer is a refinement, never a
    dependency the whole endpoint should fail over.

    When theme_weights is given (this specific opponent's historical
    tactical_theme distribution), prefer whichever of Stockfish's existing
    top-3 candidates lands in a theme this opponent is actually prone to --
    stays inside the current multi_pv=3 budget rather than expanding the
    search. Falls back to the plain worst-score pick when no candidate
    matches a weighted theme, or no profile exists."""
    try:
        with engine_pool.acquire(kind="interactive", timeout=_REPLAY_ACQUIRE_TIMEOUT_SECONDS) as sf:
            lines = engine_pool.cached_analyse(sf, board, depth=_DEVIATION_DEPTH, multi_pv=3)
    except Exception:
        logger.warning("Fingerprint deviation lookup failed; falling back to Maia.", exc_info=True)
        return None

    candidates = []
    for line in lines:
        pv = line.get("pv") or []
        if not pv:
            continue
        mv = pv[0]
        if mv == maia_move or mv not in board.legal_moves:
            continue
        sc = line["score"].white().score(mate_score=10000)
        if sc is None:
            continue
        candidates.append((mv, sc))
    if not candidates:
        return None

    # Worst score from the mover's own perspective: white wants the lowest
    # white-relative score, black wants the highest (best for white = worst
    # for black).
    key = (lambda c: c[1]) if board.turn == chess.WHITE else (lambda c: -c[1])

    if theme_weights:
        fen = board.fen()
        themed = []
        for mv, sc in candidates:
            try:
                theme = classify_tactical_theme(fen, mv.uci(), phase or "Middlegame")
            except Exception:
                theme = None
            if theme and theme_weights.get(theme, 0) > 0:
                themed.append((mv, sc))
        if themed:
            return min(themed, key=key)[0]

    return min(candidates, key=key)[0]


@router.post("/move")
async def replay_move(req: ReplayMoveRequest, user: CurrentUser = Depends(get_current_user)):
    try:
        board = chess.Board(req.fen)
    except ValueError:
        raise HTTPException(400, "Invalid FEN")

    if board.is_game_over():
        raise HTTPException(400, "Position is already game over")

    if not human_engine_pool.available():
        raise HTTPException(503, "Replay engine is not available right now")

    try:
        maia_move, band = human_engine_pool.play_human_move(req.fen, req.opponent_rating)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except (chess.engine.EngineTerminatedError, chess.engine.EngineError):
        # The pooled lc0 process crashed mid-request -- human_engine_pool
        # already swapped in a fresh engine for the next call, but this
        # one still needs to fail. 503 (not 500) tells the frontend it's
        # safe to retry the same request immediately.
        logger.warning("Maia engine crashed handling a replay move.", exc_info=True)
        raise HTTPException(503, "The opponent engine hit an error. Please try again.")

    profile = None
    if req.opponent_name:
        profile = await opponent_profile.get_opponent_profile(user.user_id, req.opponent_name)

    # A real, multi-game per-opponent error rate beats the client's
    # single-game one when we have it; otherwise behavior is identical to
    # before this profile existed.
    error_rate_by_phase = req.error_rate_by_phase
    if profile and profile.get("phase_error_rate"):
        error_rate_by_phase = profile["phase_error_rate"]

    deviation_prob = 0.0
    if error_rate_by_phase and req.phase:
        p = error_rate_by_phase.get(req.phase)
        if p is not None and p > 0:
            deviation_prob = p

    if profile and profile.get("time_pressure", {}).get("elevated") and board.fullmove_number >= _TIME_PRESSURE_START_MOVE:
        ramp = min(1.0, (board.fullmove_number - _TIME_PRESSURE_START_MOVE) / _TIME_PRESSURE_RAMP_MOVES)
        deviation_prob += _TIME_PRESSURE_MAX_BOOST * ramp

    chosen_move = maia_move
    source = "maia"

    if deviation_prob > 0:
        deviation_prob = min(MAX_DEVIATION_PROB, deviation_prob)
        if random.random() < deviation_prob:
            theme_weights = profile.get("theme_distribution") if profile else None
            deviation = _find_deviation(board, maia_move, theme_weights=theme_weights, phase=req.phase)
            if deviation is not None:
                chosen_move = deviation
                source = "fingerprint_deviation"

    move_san = board.san(chosen_move)
    board.push(chosen_move)

    return {
        "move_uci": chosen_move.uci(),
        "move_san": move_san,
        "maia_band": band,
        "source": source,
        "eval_cp": _evaluate(board),
        **_game_state(board),
    }

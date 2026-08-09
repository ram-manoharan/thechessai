from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from functools import lru_cache
from typing import Optional
import json, logging, os, chess, chess.pgn
from io import StringIO

import httpx

from chess_analysis import (
    StockfishService, OpeningDBService, GameAnalysisService,
    generate_annotated_pgn, estimate_elo_from_accuracy,
)
from ai_service import AIService
from auth import CurrentUser, get_current_user_optional
from db import get_pool

logger = logging.getLogger(__name__)
router = APIRouter()


class AnalyzeRequest(BaseModel):
    pgn: str
    player_color: str = "white"
    ai_report: bool = True
    kid_mode: bool = False


class PositionRequest(BaseModel):
    fen: str
    multi_pv: int = 3


class AnnotatedPgnRequest(BaseModel):
    pgn: str
    moves_data: list


class PuzzleRequest(BaseModel):
    pgn: str
    player_color: str = "white"


@lru_cache(maxsize=1)
def _stockfish():
    return StockfishService(depth=12)

@lru_cache(maxsize=1)
def _opening_db():
    return OpeningDBService()

@lru_cache(maxsize=1)
def _ai():
    return AIService()


def _build_positions(pgn: str) -> list[str]:
    """Return list of FENs: index 0 = start, index N = after move N."""
    game = chess.pgn.read_game(StringIO(pgn))
    if not game:
        return []
    board = game.board()
    fens = [board.fen()]
    for node in game.mainline():
        board.push(node.move)
        fens.append(board.fen())
    return fens


def _parse_metadata(pgn: str) -> dict:
    game = chess.pgn.read_game(StringIO(pgn))
    if not game:
        return {}
    return dict(game.headers)


def _estimate_game_elo(pgn: str, player_color: str, moves_data: list) -> Optional[int]:
    """Prefer the player's own PGN header rating (WhiteElo/BlackElo) when
    present and parseable; otherwise fall back to a cp-loss-derived estimate
    from this game's own moves. Powers the ELO-adaptive coaching bands."""
    metadata = _parse_metadata(pgn)
    header_key = "WhiteElo" if player_color == "white" else "BlackElo"
    header_val = metadata.get(header_key)
    if header_val:
        try:
            elo = int(header_val)
            if elo > 0:
                return elo
        except (TypeError, ValueError):
            pass

    player_cap = player_color.capitalize()
    own_losses = [m["cp_loss"] for m in moves_data if m.get("color") == player_cap and m.get("cp_loss") is not None]
    if not own_losses:
        return None
    avg_loss = sum(own_losses) / len(own_losses)
    return estimate_elo_from_accuracy(avg_loss)


def _enrich(moves_data: list, positions: list) -> list:
    """Add 'fen', normalise field names so frontend gets consistent keys."""
    enriched = []
    for i, m in enumerate(moves_data):
        e = dict(m)
        # Normalise: backend uses move_san, frontend expects san
        e["san"] = m.get("move_san") or m.get("san", "")
        # FEN after this move: positions[0]=start, positions[i+1]=after move i
        e["fen"] = positions[i + 1] if i + 1 < len(positions) else ""
        enriched.append(e)
    return enriched


@router.post("/game")
def analyze_game(req: AnalyzeRequest):
    """Full game analysis: engine eval for every move + optional AI report."""
    try:
        positions = _build_positions(req.pgn)
        metadata  = _parse_metadata(req.pgn)
        moves_data = _stockfish().analyze_game_moves(req.pgn, req.player_color, depth=12)

        if not moves_data:
            raise HTTPException(422, "This game has no moves to analyse. Please select a game that was actually played.")

        san_moves  = [m.get("move_san", "") for m in moves_data]
        opening    = _opening_db().identify_opening(san_moves[:12])
        enriched   = _enrich(moves_data, positions)

        estimated_elo = _estimate_game_elo(req.pgn, req.player_color, moves_data)

        ai_report = None
        ai = _ai()
        if req.ai_report and getattr(ai, "model_available", False):
            ai_report = ai.analyze_game(req.pgn, moves_data, req.player_color, estimated_elo=estimated_elo)

        return {
            "metadata":      metadata,
            "positions":     positions,
            "opening":       opening,
            "moves_data":    enriched,
            "ai_report":     ai_report,
            "estimated_elo": estimated_elo,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/game/stream")
def analyze_game_stream(req: AnalyzeRequest):
    """SSE stream: engine data first chunk, AI report second."""
    def generate():
        try:
            positions  = _build_positions(req.pgn)
            metadata   = _parse_metadata(req.pgn)
            moves_data = _stockfish().analyze_game_moves(req.pgn, req.player_color, depth=12)

            if not moves_data:
                # Valid PGN but game has no moves (e.g. aborted game, headers only)
                yield "data: " + json.dumps({"type": "error", "message": "This game has no moves to analyse. Please select a game that was actually played."}) + "\n\n"
                return

            san_moves  = [m.get("move_san", "") for m in moves_data]
            opening    = _opening_db().identify_opening(san_moves[:12])
            enriched   = _enrich(moves_data, positions)
            estimated_elo = _estimate_game_elo(req.pgn, req.player_color, moves_data)

            yield "data: " + json.dumps({
                "type": "moves",
                "moves_data": enriched,
                "positions":  positions,
                "opening":    opening,
                "metadata":   metadata,
                "estimated_elo": estimated_elo,
            }) + "\n\n"

            ai = _ai()
            if req.ai_report and getattr(ai, "model_available", False):
                if req.kid_mode:
                    report = ai.analyze_game_kid_mode(req.pgn, moves_data, req.player_color)
                else:
                    report = ai.analyze_game(req.pgn, moves_data, req.player_color, estimated_elo=estimated_elo)
                yield "data: " + json.dumps({"type": "report", "text": report}) + "\n\n"

                # Kid mode: stream per-move Coach Spark commentaries as a separate event
                if req.kid_mode:
                    try:
                        commentaries = ai.generate_kid_move_commentaries(
                            moves_data, req.pgn, req.player_color
                        )
                        if commentaries:
                            yield "data: " + json.dumps({
                                "type": "kid_commentaries",
                                "data": commentaries,
                            }) + "\n\n"
                    except Exception:
                        pass  # commentaries are optional — never block the stream

        except Exception as e:
            yield "data: " + json.dumps({"type": "error", "message": str(e)}) + "\n\n"
        finally:
            yield "data: " + json.dumps({"type": "done"}) + "\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/position")
def analyze_position(req: PositionRequest):
    try:
        return _stockfish().analyze_position(req.fen, multi_pv=req.multi_pv)
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/game/annotated-pgn")
def get_annotated_pgn(req: AnnotatedPgnRequest):
    """Return the game PGN with engine classification comments embedded."""
    try:
        pgn = generate_annotated_pgn(req.pgn, req.moves_data)
        return {"pgn": pgn}
    except Exception as e:
        raise HTTPException(500, str(e))


async def _save_puzzles(user_id: str, puzzles: list) -> None:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            for p in puzzles:
                await conn.execute(
                    """
                    INSERT INTO app.saved_puzzle
                        (user_id, fen, best_move_san, continuation, theme, cp_loss, phase, source_white, source_black, source_date)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    ON CONFLICT (user_id, fen) DO NOTHING
                    """,
                    user_id, p["fen"], p["best_move_san"], p.get("continuation") or [],
                    p.get("theme", "Positional"), p["cp_loss"], p.get("phase"),
                    p.get("game_white"), p.get("game_black"), p.get("game_date"),
                )
    except Exception as e:
        logger.warning("Failed to save puzzles for user %s: %s", user_id, e)


@router.post("/game/puzzles")
async def get_game_puzzles(req: PuzzleRequest, user: Optional[CurrentUser] = Depends(get_current_user_optional)):
    """Generate puzzles from positions where the player made significant errors.
    For signed-in users, also persists them to app.saved_puzzle (theme-tagged)
    so they feed the cross-game spaced-repetition queue — see /api/user/puzzle-queue.

    async def + run_in_threadpool (not asyncio.run) for the blocking Stockfish
    call: the asyncpg pool below is bound to the main event loop created at
    app startup, and asyncio.run() would spin up a *different* loop in this
    thread, corrupting pooled connections ("another operation is in progress").
    Staying on the main loop and only offloading the blocking part is correct.
    """
    try:
        puzzles = await run_in_threadpool(
            _stockfish().collect_game_puzzles, req.pgn, req.player_color, depth=10, max_puzzles_per_game=8
        )
        if user and puzzles:
            await _save_puzzles(user.user_id, puzzles)
        return {"puzzles": puzzles}
    except Exception as e:
        raise HTTPException(500, str(e))


class ExplainRequest(BaseModel):
    fen: str
    played_move: str
    best_move: str
    phase: str = "Middlegame"
    position_context: str = "equal"
    cp_loss: int = 0
    player_color: str = "white"
    estimated_elo: Optional[int] = None
    clock_remaining: Optional[float] = None
    player_reasoning: Optional[str] = None


async def _persist_mistake(user_id: str, theme: str, phase: str, cp_loss: int, fen: str, move_san: str) -> None:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO app.mistake_pattern (user_id, theme, phase, cp_loss, fen, move_san)
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                user_id, theme, phase, cp_loss, fen, move_san,
            )
    except Exception as e:
        # Fingerprint tracking is a bonus signal, never worth failing the
        # user-facing explanation over.
        logger.warning("Failed to persist mistake_pattern for user %s: %s", user_id, e)


@router.post("/position/explain")
async def explain_position(req: ExplainRequest, user: Optional[CurrentUser] = Depends(get_current_user_optional)):
    """Generate a position-specific AI explanation: why the played move is bad and why the best move is good.

    async def + run_in_threadpool for the same reason as /game/puzzles above:
    keeps the blocking LLM call off the main loop without creating a second
    event loop that would corrupt the asyncpg pool.
    """
    try:
        ai = _ai()
        if not getattr(ai, "model_available", False):
            raise HTTPException(503, "AI model not available")
        result = await run_in_threadpool(
            ai.explain_position,
            fen=req.fen,
            played_move=req.played_move,
            best_move=req.best_move,
            phase=req.phase,
            position_context=req.position_context,
            cp_loss=req.cp_loss,
            player_color=req.player_color,
            estimated_elo=req.estimated_elo,
            clock_remaining=req.clock_remaining,
            player_reasoning=req.player_reasoning,
        )

        # Feed the "mistake fingerprint" (ANALYSIS_STRATEGY.md section 5) —
        # only for signed-in users, never blocks the explanation itself.
        if user and result.get("theme"):
            await _persist_mistake(
                user.user_id, result["theme"], req.phase, req.cp_loss, req.fen, req.played_move,
            )

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


class ChatMessage(BaseModel):
    role: str    # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    fen: str
    played_move: str
    best_move: str
    player_color: str = "white"
    estimated_elo: Optional[int] = None
    history: list[ChatMessage] = []


@router.post("/position/chat")
async def chat_about_position(req: ChatRequest):
    """Multi-turn conversational follow-up on a position, after the initial
    why_bad/why_good explanation — 'why', 'what if I played X instead', etc."""
    try:
        ai = _ai()
        if not getattr(ai, "model_available", False):
            raise HTTPException(503, "AI model not available")
        reply = await run_in_threadpool(
            ai.chat_about_position,
            fen=req.fen,
            played_move=req.played_move,
            best_move=req.best_move,
            history=[{"role": m.role, "content": m.content} for m in req.history],
            estimated_elo=req.estimated_elo,
            player_color=req.player_color,
        )
        return {"reply": reply}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


_LICHESS_EXPLORER_HEADERS = {"User-Agent": "chessAIlytics/1.0 (github.com/chessAIlytics)"}
# Lichess changed policy in Feb 2026 — the opening explorer now requires
# being signed in (confirmed live: unauthenticated requests get HTTP 401,
# not the open/public access it used to have). Generate a free personal
# token at https://lichess.org/account/oauth/token (no scopes needed, it's
# read-only public data) and set LICHESS_EXPLORER_TOKEN in backend/.env.
# Without it, this endpoint degrades to 503 and the frontend simply hides
# the peer-benchmark widget rather than erroring.


@router.get("/position/peers")
async def position_peers(fen: str, tier: str = "intermediate"):
    """Proxy to Lichess's opening-explorer API for peer/master move
    popularity at a given FEN — the 'players near your rating play X% here'
    benchmark widget (ANALYSIS_STRATEGY.md section 4, intermediate+ bands).
    `tier` picks which Lichess rating buckets to aggregate (loose mapping
    from our ELO bands, since Lichess's own explorer buckets differ from ours).
    """
    token = os.environ.get("LICHESS_EXPLORER_TOKEN")
    if not token:
        raise HTTPException(503, "Peer benchmark not configured — set LICHESS_EXPLORER_TOKEN.")

    rating_groups = {
        "novice":       ["1000", "1200"],
        "intermediate": ["1400", "1600"],
        "advanced":     ["1800", "2000"],
        "expert":       ["2200", "2500"],
    }.get(tier, ["1400", "1600"])

    params = {
        "variant": "standard",
        "fen": fen,
        "ratings": ",".join(rating_groups),
        "speeds": "blitz,rapid,classical",
    }
    headers = {**_LICHESS_EXPLORER_HEADERS, "Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://explorer.lichess.ovh/lichess",
                params=params,
                headers=headers,
            )
        if resp.status_code == 401:
            raise HTTPException(502, "Lichess explorer rejected our token — it may have expired.")
        if resp.status_code != 200:
            raise HTTPException(502, f"Lichess explorer API error {resp.status_code}.")
        data = resp.json()
    except httpx.TimeoutException:
        raise HTTPException(504, "Lichess explorer timed out.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, str(e))

    total = data.get("white", 0) + data.get("draws", 0) + data.get("black", 0)
    moves = []
    for m in data.get("moves", [])[:5]:
        game_count = m.get("white", 0) + m.get("draws", 0) + m.get("black", 0)
        moves.append({
            "san":     m.get("san"),
            "uci":     m.get("uci"),
            "count":   game_count,
            "pct":     round(game_count / total * 100, 1) if total else 0.0,
        })
    return {"total_games": total, "moves": moves}

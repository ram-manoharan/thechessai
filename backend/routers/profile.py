from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional
import json
import logging

from ai_service import AIService
import cache_service

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_GAMES = 100  # hard cap regardless of PGN size


class ProfileRequest(BaseModel):
    pgn: str
    player_name: str
    # Only set by the frontend when this request is a signed-in user viewing
    # their own linked chess.com/lichess profile (never for anonymous PGN
    # paste or looking up someone else's username) — enables the cache below.
    user_id: Optional[str] = None
    provider: Optional[str] = None


@lru_cache(maxsize=1)
def _ai():
    return AIService()


@router.post("/stream")
def build_profile_stream(req: ProfileRequest):
    """SSE stream: progress → stats → AI profile."""
    def generate():
        from player_profile_service import PlayerProfileService

        # Cache hit: skip the expensive parse/Stockfish-analyze/aggregate
        # pipeline entirely and go straight to stats + a fresh AI narrative.
        if req.user_id and req.provider:
            cached_stats = cache_service.get_cached_stats_sync(req.user_id, req.provider)
            if cached_stats is not None:
                yield f"data: {json.dumps({'type': 'stats', 'stats': cached_stats, 'games_parsed': cached_stats.get('total_games', 0), 'cached': True})}\n\n"
                ai = _ai()
                if getattr(ai, "model_available", False):
                    # _format_stats_for_prompt doesn't touch instance state (no
                    # Stockfish access) — skip __init__ so this fast path never
                    # pays the cost of spawning an engine subprocess just to
                    # format text.
                    formatter = object.__new__(PlayerProfileService)
                    stats_text = formatter._format_stats_for_prompt(cached_stats)
                    profile_text = ai.analyze_player_profile(stats_text, req.player_name)
                    yield f"data: {json.dumps({'type': 'profile', 'text': profile_text})}\n\n"
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                return

        svc = PlayerProfileService()
        worker_svcs: list = []
        try:
            all_games = svc.parse_games(req.pgn, req.player_name)
            if not all_games:
                yield f"data: {json.dumps({'type': 'error', 'message': 'No valid games found. Check the player name spelling.'})}\n\n"
                return

            # Cap at MAX_GAMES; take the most recent games (last in list)
            games = all_games[-MAX_GAMES:] if len(all_games) > MAX_GAMES else all_games
            total = len(games)
            skipped = len(all_games) - total

            yield f"data: {json.dumps({'type': 'start', 'total': total, 'skipped': skipped})}\n\n"

            # Scale depth with batch size for reasonable wall-clock time
            if total > 75:
                depth = 8
            elif total > 30:
                depth = 10
            else:
                depth = 12

            all_moves: list = [[] for _ in range(total)]
            completed = 0

            if svc.engine_available and total > 4:
                workers = min(3, total)

                # Create fresh services per worker to avoid stale Stockfish state between requests
                worker_svcs = [PlayerProfileService() for _ in range(workers)]
                import threading
                _worker_idx = threading.local()

                def _analyze(idx: int, game, worker_id: int):
                    return idx, worker_svcs[worker_id].analyze_game_moves(game, depth=depth)

                with ThreadPoolExecutor(max_workers=workers) as pool:
                    futures = {
                        pool.submit(_analyze, i, g, i % workers): i
                        for i, g in enumerate(games)
                    }
                    for fut in as_completed(futures):
                        try:
                            idx, moves = fut.result()
                            all_moves[idx] = moves
                        except Exception as e:
                            logger.warning("Game analysis failed for index %s: %s", futures[fut], e)
                            # Keep empty list for this game; don't abort the whole batch
                        completed += 1
                        yield f"data: {json.dumps({'type': 'progress', 'current': completed, 'total': total})}\n\n"
            else:
                for i, g in enumerate(games):
                    try:
                        moves = svc.analyze_game_moves(g, depth=depth) if svc.engine_available else []
                    except Exception as e:
                        logger.warning("Game %d analysis failed: %s", i + 1, e)
                        moves = []
                    all_moves[i] = moves
                    completed += 1
                    yield f"data: {json.dumps({'type': 'progress', 'current': completed, 'total': total})}\n\n"

            stats = svc.aggregate_stats(games, all_moves, req.player_name)
            yield f"data: {json.dumps({'type': 'stats', 'stats': stats, 'games_parsed': total})}\n\n"

            if req.user_id and req.provider:
                cache_service.set_cached_stats_sync(req.user_id, req.provider, stats)

            ai = _ai()
            if getattr(ai, "model_available", False):
                stats_text = svc._format_stats_for_prompt(stats)
                profile_text = ai.analyze_player_profile(stats_text, req.player_name)
                yield f"data: {json.dumps({'type': 'profile', 'text': profile_text})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            # Clean up all Stockfish subprocesses
            for wsvc in worker_svcs:
                try:
                    wsvc.close()
                except Exception:
                    pass
            try:
                svc.close()
            except Exception:
                pass

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )

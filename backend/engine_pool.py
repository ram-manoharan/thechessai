"""Shared Stockfish engine pool.

Every analysis path in this app used to go through its own single, lazily
started engine: chess_analysis.StockfishService kept one process-wide
singleton (fine for /game, /game/stream, /position, /game/puzzles — but it
meant the WHOLE APP could only run one analysis at a time, globally,
regardless of endpoint), while player_profile_service.PlayerProfileService
spawned a brand-new engine PER REQUEST with no cap at all — several
concurrent profile builds could each start their own Stockfish process and
reproduce the exact OOM crash loop that was fixed for the single-engine
path months ago, just triggered by concurrent requests instead of
concurrent workers inside one request.

This module fixes both problems in one place: a fixed-size pool of engines,
shared by every caller, sized once via STOCKFISH_POOL_SIZE. Total
concurrent engine usage across the entire app is capped at that number no
matter which endpoint is asking, so raising it is a single env var change
after upgrading the instance, not a per-service tuning exercise every time.

Split into two logical pools (interactive vs. batch) so a long-running
player-profile build can't starve someone's live game review of the only
available engine, loosely mirroring Lichess's fishnet user-queue/
system-queue split — at POOL_SIZE=1 there's nothing to split, so both share
the single engine exactly like the old singleton did (this is the default,
safe on the current 512MB/0.5vCPU Render plan). At POOL_SIZE>=2, half go to
each pool (batch borrows an idle interactive engine as a last resort so
long queues don't stall a batch job outright, but interactive requests
always get first claim on their reserved slot).

Uses a thread-safe queue.Queue rather than asyncio primitives because every
call site here runs inside a worker thread (FastAPI's sync `def` routes and
explicit run_in_threadpool calls), not directly on the event loop.
"""
import os
import json
import time
import queue
import shutil
import platform
import logging
import threading
import contextlib
from typing import Optional, List

import chess
import chess.engine

logger = logging.getLogger(__name__)

POOL_SIZE = max(1, int(os.environ.get("STOCKFISH_POOL_SIZE", "1")))
ENGINE_HASH_MB = int(os.environ.get("STOCKFISH_HASH_MB", "32"))

# Position-eval cache: safe to share across every caller and every user —
# the same FEN always analyses to the same result at a given depth/multipv,
# so a cache hit is indistinguishable from a fresh computation. Openings
# especially are shared across huge numbers of games/users.
_POSITION_CACHE_TTL_SECONDS = int(os.environ.get("STOCKFISH_CACHE_TTL", "21600"))  # 6h
# Belt-and-suspenders latency cap alongside the existing depth limit — bounds
# the rare pathological position (deep tactical mess) that takes far longer
# than a quiet one to reach the same depth, without changing the result for
# the overwhelming majority of positions that finish well under this.
_MAX_ANALYSE_SECONDS = float(os.environ.get("STOCKFISH_MAX_SECONDS", "2.0"))
MAX_ANALYSE_SECONDS = _MAX_ANALYSE_SECONDS  # public alias for callers that bypass cached_analyse
# How long a request coalescing behind another one for the same position
# waits before giving up and just computing it itself.
_COALESCE_WAIT_SECONDS = float(os.environ.get("STOCKFISH_COALESCE_WAIT", "6.0"))

_lock = threading.Lock()
_initialized = False
_sf_path: Optional[str] = None
_all_engines: List[chess.engine.SimpleEngine] = []
_interactive_pool: "queue.Queue[chess.engine.SimpleEngine]" = queue.Queue()
_batch_pool: "queue.Queue[chess.engine.SimpleEngine]" = queue.Queue()


def find_stockfish() -> Optional[str]:
    system_sf = shutil.which("stockfish")
    if system_sf:
        return system_sf
    bundled = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stockfish_14_x64_popcnt")
    if os.path.exists(bundled) and platform.system() == "Linux":
        return bundled
    return None


def _start_one() -> Optional[chess.engine.SimpleEngine]:
    global _sf_path
    if _sf_path is None:
        _sf_path = find_stockfish()
    if not _sf_path:
        return None
    try:
        if not os.access(_sf_path, os.X_OK):
            os.chmod(_sf_path, 0o755)
        engine = chess.engine.SimpleEngine.popen_uci(_sf_path)
        # Each pooled engine stays single-threaded -- POOL_SIZE engines
        # running concurrently is how multiple CPU cores actually get used;
        # a lone multi-threaded engine wouldn't help throughput since only
        # one caller could use it at a time regardless of its thread count.
        engine.configure({"Threads": 1, "Hash": ENGINE_HASH_MB})
        return engine
    except Exception as e:
        logger.error("Stockfish failed to start: %s", e)
        return None


def init_pool() -> int:
    """Idempotent, thread-safe. Returns the number of engines running."""
    global _initialized
    if _initialized:
        return len(_all_engines)
    with _lock:
        if _initialized:
            return len(_all_engines)
        for _ in range(POOL_SIZE):
            eng = _start_one()
            if eng:
                _all_engines.append(eng)

        # Split into interactive/batch only when there's enough to split;
        # at POOL_SIZE=1, _batch_pool is made THE SAME queue object as
        # _interactive_pool (not a second queue independently seeded with
        # the same engine) -- putting one engine into two separate queues
        # would let two threads each successfully `get()` a reference to
        # it at once, breaking the mutual exclusion the pool exists to
        # provide. Aliasing the queue itself keeps a single physical slot,
        # matching the pre-pool singleton's actual behaviour exactly.
        global _batch_pool
        if len(_all_engines) >= 2:
            batch_n = len(_all_engines) // 2
            interactive_n = len(_all_engines) - batch_n
            for eng in _all_engines[:interactive_n]:
                _interactive_pool.put(eng)
            for eng in _all_engines[interactive_n:]:
                _batch_pool.put(eng)
        else:
            _batch_pool = _interactive_pool
            for eng in _all_engines:
                _interactive_pool.put(eng)

        _initialized = True
        if _all_engines:
            logger.info(
                "Stockfish engine pool ready: %d engine(s), Hash=%dMB each",
                len(_all_engines), ENGINE_HASH_MB,
            )
        else:
            logger.warning("Stockfish engine pool: no engines started -- analysis will be unavailable.")
        return len(_all_engines)


def available() -> bool:
    if not _initialized:
        init_pool()
    return len(_all_engines) > 0


def _replace_dead_engine(dead: chess.engine.SimpleEngine, pool: "queue.Queue") -> None:
    logger.warning("Pooled Stockfish engine crashed -- replacing it.")
    try:
        _all_engines.remove(dead)
    except ValueError:
        pass
    replacement = _start_one()
    if replacement:
        _all_engines.append(replacement)
        pool.put(replacement)


@contextlib.contextmanager
def acquire(kind: str = "interactive", timeout: Optional[float] = None):
    """Block (thread-safely) until an engine is free, yield it, return it to
    its pool afterward -- even on exception. `kind` is "interactive" (single
    game/position/puzzle requests -- someone is actively waiting) or "batch"
    (player-profile builds -- tolerant of a short queue). Falls back to the
    other pool if its own is momentarily empty, so neither type of request
    ever deadlocks waiting on a split that only exists at POOL_SIZE>=2.

    Note: a caller that loses the coalescing race inside cached_analyse()
    holds its engine slot idle while it polls rather than releasing it
    back to the pool -- avoids a duplicate Stockfish search (the expensive
    part) at the cost of a pool slot sitting unused for that wait.
    Acceptable at the pool sizes this app runs; worth revisiting only if
    POOL_SIZE grows large enough for that idle-hold to meaningfully hurt
    throughput.
    """
    if not _initialized:
        init_pool()
    if not _all_engines:
        raise RuntimeError("Stockfish engine is not available. Install via: brew install stockfish")

    primary = _interactive_pool if kind == "interactive" else _batch_pool
    fallback = _batch_pool if kind == "interactive" else _interactive_pool

    engine = None
    try:
        engine = primary.get(timeout=0.05)
    except queue.Empty:
        try:
            engine = fallback.get(timeout=0.05)
        except queue.Empty:
            engine = primary.get(timeout=timeout)  # now just wait on the primary pool

    try:
        yield engine
    except chess.engine.EngineTerminatedError:
        _replace_dead_engine(engine, primary)
        raise
    else:
        primary.put(engine)


def shutdown() -> None:
    for pool in (_interactive_pool, _batch_pool):
        while not pool.empty():
            try:
                pool.get_nowait()
            except queue.Empty:
                break
    for eng in _all_engines:
        try:
            eng.quit()
        except Exception:
            pass
    _all_engines.clear()


# ─────────────────────── Cached / coalesced analysis ─────────────────────────
#
# Every call site in this app that reads a score off an engine result does
# `info["score"].white().score(mate_score=10000)` and/or `info.get("pv")` --
# nothing more exotic. _CachedScore + _reconstruct_info reproduce exactly
# that surface from a plain cached dict, so cached_analyse() is a drop-in
# replacement for `engine.analyse(board, Limit(...), multipv=N)`: callers
# don't need to know or care whether a result came from the engine or the
# cache.

class _CachedScore:
    __slots__ = ("_value",)

    def __init__(self, value: Optional[int]):
        self._value = value

    def white(self):
        return self

    def score(self, *, mate_score: int = 10000) -> Optional[int]:
        return self._value


def _reconstruct_info(line: dict) -> dict:
    pv = [chess.Move.from_uci(u) for u in line["pv_uci"]]
    return {"score": _CachedScore(line["score_cp"]), "pv": pv}


def _serialize(result: list) -> dict:
    lines = []
    for info in result:
        pv = info.get("pv") or []
        if not pv:
            continue
        sc = info.get("score")
        cp = sc.white().score(mate_score=10000) if sc else None
        lines.append({"uci": pv[0].uci(), "score_cp": cp, "pv_uci": [m.uci() for m in pv[:6]]})
    return {"lines": lines}


def cached_analyse(engine: chess.engine.SimpleEngine, board: chess.Board,
                    depth: int, multi_pv: int = 1) -> list:
    """Drop-in replacement for `engine.analyse(board, Limit(depth=depth),
    multipv=multi_pv)` that always returns a list. Checks a Redis cache
    first (keyed on fen+depth+multipv) and coalesces concurrent identical
    requests via a short-lived lock so a cache stampede on a popular
    position doesn't spend N engine slots recomputing the same thing N
    times. Any Redis failure falls straight through to a normal engine call
    -- caching is a pure speed optimisation, never a correctness dependency.
    """
    fen = board.fen()
    key = f"sfcache:{fen}:{depth}:{multi_pv}"
    client = None
    try:
        import cache_service
        client = cache_service.get_sync_client()
        cached = client.get(key)
        if cached:
            data = json.loads(cached)
            return [_reconstruct_info(line) for line in data["lines"]]
    except Exception:
        pass  # cache unavailable/miss -- fall through to a normal engine call

    got_lock = False
    lock_key = f"sflock:{key}"
    if client is not None:
        try:
            got_lock = bool(client.set(lock_key, "1", nx=True, ex=15))
        except Exception:
            got_lock = False

        if not got_lock:
            waited = 0.0
            while waited < _COALESCE_WAIT_SECONDS:
                time.sleep(0.2)
                waited += 0.2
                try:
                    cached = client.get(key)
                except Exception:
                    cached = None
                if cached:
                    data = json.loads(cached)
                    return [_reconstruct_info(line) for line in data["lines"]]
            # Whoever held the lock never finished (crashed, or genuinely
            # slow) -- fall through and compute it ourselves rather than
            # waiting forever.

    result = engine.analyse(
        board, chess.engine.Limit(depth=depth, time=_MAX_ANALYSE_SECONDS), multipv=multi_pv
    )
    if not isinstance(result, list):
        result = [result]

    if client is not None:
        try:
            client.set(key, json.dumps(_serialize(result)), ex=_POSITION_CACHE_TTL_SECONDS)
        except Exception:
            pass
        if got_lock:
            try:
                client.delete(lock_key)
            except Exception:
                pass

    return result

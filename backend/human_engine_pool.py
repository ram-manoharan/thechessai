"""Shared pool of Maia (human-move-prediction) engines, mirroring the
Stockfish pool in engine_pool.py.

Maia is a neural net trained on millions of human games to predict the move
a human at a given rating would actually play, not the objectively best
move -- it's a Leela Chess Zero (lc0) weights file, loaded via lc0 with
search disabled (`go nodes 1`, a single forward pass through the policy
net). Nine weight files ship in maia_weights/, one per 100-Elo band from
1100 to 1900; play_human_move() clamps any requested rating into that range
and picks the nearest band.

Like engine_pool.py, one small fixed-size pool is shared by every caller
rather than spinning up a process per request. Unlike Stockfish, a single
lc0 process can serve every rating band -- swapping WeightsFile via UCI
setoption only reloads the net when the requested band actually changes
(verified: repeat calls for the same band are a no-op, ~10ms), so pool size
doesn't need to scale with the number of bands.
"""
import os
import time
import heapq
import queue
import shutil
import logging
import itertools
import threading
import contextlib
from typing import Optional, List, Tuple

import chess
import chess.engine

logger = logging.getLogger(__name__)

POOL_SIZE = max(1, int(os.environ.get("MAIA_POOL_SIZE", "1")))
_DEFAULT_ACQUIRE_TIMEOUT_SECONDS = float(os.environ.get("MAIA_ACQUIRE_TIMEOUT", "20"))

WEIGHTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "maia_weights")
BANDS = [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900]
DEFAULT_BAND = 1500


def nearest_band(rating: Optional[int]) -> int:
    """Round an opponent's rating to the nearest available Maia band,
    clamped to [1100, 1900]. Missing rating falls back to the middle band
    (1500) -- a neutral default rather than guessing high or low."""
    if rating is None:
        return DEFAULT_BAND
    clamped = max(BANDS[0], min(BANDS[-1], rating))
    return min(BANDS, key=lambda b: abs(b - clamped))


def _weights_path(band: int) -> str:
    return os.path.join(WEIGHTS_DIR, f"maia-{band}.pb.gz")


class _EnginePool:
    """Simple FIFO blocking bag of engines -- no interactive/batch priority
    split needed here (unlike engine_pool.py): every replay call is
    interactive by nature."""

    def __init__(self) -> None:
        self._cond = threading.Condition(threading.Lock())
        self._available: List[chess.engine.SimpleEngine] = []

    def put(self, engine: chess.engine.SimpleEngine) -> None:
        with self._cond:
            self._available.append(engine)
            self._cond.notify_all()

    def get(self, timeout: Optional[float] = None) -> chess.engine.SimpleEngine:
        with self._cond:
            deadline = None if timeout is None else time.monotonic() + timeout
            while not self._available:
                remaining = None if deadline is None else deadline - time.monotonic()
                if remaining is not None and remaining <= 0:
                    raise queue.Empty
                if not self._cond.wait(timeout=remaining):
                    raise queue.Empty
            return self._available.pop()

    def drain(self) -> None:
        with self._cond:
            self._available.clear()


_lock = threading.Lock()
_initialized = False
_lc0_path: Optional[str] = None
_all_engines: List[chess.engine.SimpleEngine] = []
_pool = _EnginePool()


def find_lc0() -> Optional[str]:
    return shutil.which("lc0")


def _start_one() -> Optional[chess.engine.SimpleEngine]:
    global _lc0_path
    if _lc0_path is None:
        _lc0_path = find_lc0()
    if not _lc0_path:
        return None
    if not os.path.isdir(WEIGHTS_DIR) or not os.path.exists(_weights_path(DEFAULT_BAND)):
        logger.error("Maia weights not found at %s", WEIGHTS_DIR)
        return None
    try:
        engine = chess.engine.SimpleEngine.popen_uci(_lc0_path)
        # Load a default band at start so init_pool() fails fast (matching
        # engine_pool's "fail fast at deploy" behaviour) rather than
        # surprising the first replay request with a broken engine.
        engine.configure({"WeightsFile": _weights_path(DEFAULT_BAND)})
        return engine
    except Exception as e:
        logger.error("lc0 failed to start: %s", e)
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
                _pool.put(eng)
        _initialized = True
        if _all_engines:
            logger.info("Maia engine pool ready: %d engine(s)", len(_all_engines))
        else:
            logger.warning(
                "Maia engine pool: no engines started -- replay feature will be unavailable "
                "(install lc0 and ensure backend/maia_weights/ is populated)."
            )
        return len(_all_engines)


def available() -> bool:
    if not _initialized:
        init_pool()
    return len(_all_engines) > 0


def _replace_dead_engine(dead: chess.engine.SimpleEngine, pool: "_EnginePool") -> None:
    logger.warning("Pooled Maia/lc0 engine crashed -- replacing it.")
    try:
        _all_engines.remove(dead)
    except ValueError:
        pass
    try:
        dead.quit()
    except Exception:
        pass
    replacement = _start_one()
    if replacement:
        _all_engines.append(replacement)
        pool.put(replacement)


@contextlib.contextmanager
def _acquire(timeout: Optional[float] = None):
    if not _initialized:
        init_pool()
    if not _all_engines:
        raise RuntimeError(
            "Maia engine is not available. Install lc0 and populate backend/maia_weights/."
        )
    wait_timeout = _DEFAULT_ACQUIRE_TIMEOUT_SECONDS if timeout is None else timeout
    try:
        engine = _pool.get(timeout=wait_timeout)
    except queue.Empty:
        raise RuntimeError(
            f"Timed out after {wait_timeout}s waiting for a free Maia engine."
        )
    dead = False
    try:
        yield engine
    except (chess.engine.EngineTerminatedError, chess.engine.EngineError):
        dead = True
        raise
    finally:
        if dead:
            _replace_dead_engine(engine, _pool)
        else:
            _pool.put(engine)


def play_human_move(fen: str, rating: Optional[int] = None,
                     timeout: Optional[float] = None) -> Tuple[chess.Move, int]:
    """Return (move, band) -- the move a human at the nearest rating band
    to `rating` would most likely play in this position, per Maia's policy
    network. Single forward pass (nodes=1), no search: this IS Maia's
    validated mode of use, not an approximation of it -- letting lc0 search
    deeper with Maia weights would drift away from the human-move-prediction
    behaviour the model was actually trained and evaluated on.
    """
    band = nearest_band(rating)
    board = chess.Board(fen)
    with _acquire(timeout=timeout) as engine:
        engine.configure({"WeightsFile": _weights_path(band)})
        result = engine.play(board, chess.engine.Limit(nodes=1))
    if result.move is None:
        raise RuntimeError("Maia returned no move for this position.")
    return result.move, band


def shutdown() -> None:
    global _initialized
    _pool.drain()
    for eng in _all_engines:
        try:
            eng.quit()
        except Exception:
            pass
    _all_engines.clear()
    _initialized = False

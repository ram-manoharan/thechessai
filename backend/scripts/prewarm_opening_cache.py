#!/usr/bin/env python3
"""Pre-warm the Redis position-eval cache with every prefix position of every
opening line already in OPENINGS_DB (chess_analysis.py) -- ~193 named lines,
deduplicated down to their unique positions since many share early prefixes
(e.g. every "d4 d5 ..." line shares that first position).

Why: engine_pool.cached_analyse() already caches by (fen, depth, multipv), so
opening positions are naturally shared across every game/user that reaches
them -- but only AFTER the first person to hit that position pays the full
engine cost. Running this once before a traffic spike (a public launch, a
big marketing push) means that first-mover cost is already paid, so day-one
users get cache hits on their first ~5-10 moves instead of warming the cache
live during the exact traffic spike this is meant to help with.

Only warms depth=12 (STANDARD_DEPTH) -- the depth every /api/analysis/game
and /api/analysis/game/stream call actually uses (see routers/analysis.py's
_stockfish() singleton). Not run automatically on deploy/startup -- it adds
real engine time (a few minutes, not app-boot-blocking time) and is meant to
be run as a one-off maintenance task, not on every restart.

Run from the backend/ directory: python scripts/prewarm_opening_cache.py
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import chess  # noqa: E402

import engine_pool  # noqa: E402
from chess_analysis import OPENINGS_DB  # noqa: E402

STANDARD_DEPTH = 12
MULTI_PV = 3


def _collect_unique_fens() -> list[str]:
    """Every prefix position of every OPENINGS_DB line, deduplicated by FEN
    (dict insertion order = warm shared prefixes, like the start position,
    exactly once no matter how many lines branch off it)."""
    fens: dict[str, None] = {}
    for san_line in OPENINGS_DB:
        board = chess.Board()
        fens.setdefault(board.fen(), None)
        for san in san_line.split():
            try:
                board.push_san(san)
            except ValueError:
                break  # a malformed/ambiguous entry -- skip the rest of this line, not the whole run
            fens.setdefault(board.fen(), None)
    return list(fens.keys())


def main() -> None:
    n = engine_pool.init_pool()
    if n == 0:
        print("No Stockfish engine available -- nothing to warm with. Aborting.")
        sys.exit(1)

    fens = _collect_unique_fens()
    print(f"{len(OPENINGS_DB)} opening lines -> {len(fens)} unique positions to warm "
          f"(depth={STANDARD_DEPTH}, multipv={MULTI_PV}, pool size={n}).")

    t0 = time.monotonic()
    done = 0
    for fen in fens:
        board = chess.Board(fen)
        with engine_pool.acquire("batch") as engine:
            engine_pool.cached_analyse(engine, board, STANDARD_DEPTH, MULTI_PV)
        done += 1
        if done % 20 == 0 or done == len(fens):
            elapsed = time.monotonic() - t0
            print(f"  {done}/{len(fens)} positions cached ({elapsed:.1f}s elapsed)")

    ttl = os.environ.get("STOCKFISH_CACHE_TTL", "21600")  # engine_pool.py's own default
    print(f"Done in {time.monotonic() - t0:.1f}s. Cache TTL is {ttl}s -- re-run this "
          f"periodically (e.g. a few hours before a known traffic spike) rather than "
          f"assuming a single run stays warm forever.")
    engine_pool.shutdown()


if __name__ == "__main__":
    main()

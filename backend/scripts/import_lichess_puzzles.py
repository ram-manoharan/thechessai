#!/usr/bin/env python3
"""Import a filtered subset of the Lichess puzzle database.

The full Lichess DB has 6M+ CC0-licensed puzzles. This script:
  1. Reads the CSV (optionally downloading it if not present)
  2. Filters to high-quality puzzles per theme × rating band
  3. Batch-upserts into app.lichess_puzzles

Usage:
    # Download + import 200 K curated puzzles (default)
    python scripts/import_lichess_puzzles.py

    # Use a file you already downloaded
    python scripts/import_lichess_puzzles.py --file /path/to/lichess_db_puzzle.csv

    # Import from a .zst-compressed file
    python scripts/import_lichess_puzzles.py --file /path/to/lichess_db_puzzle.csv.zst

    # Smaller run for testing
    python scripts/import_lichess_puzzles.py --max-puzzles 5000

Prerequisites:
    pip install asyncpg zstandard chess
    DATABASE_URL env var pointing at your PostgreSQL (direct connection, not PgBouncer).
"""

import argparse
import asyncio
import csv
import io
import logging
import os
import re
import sys
import urllib.request
from pathlib import Path
from typing import Iterator

import asyncpg

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

LICHESS_CSV_URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"
BATCH_SIZE = 2000

# ── Quality filters ───────────────────────────────────────────────────────────
MIN_POPULARITY = 40          # discard hated/poorly-rated puzzles
MAX_RATING_DEV = 150         # only well-calibrated puzzles
MIN_NB_PLAYS   = 5           # at least a few plays (avoid completely unseen)

# ── Target distribution ───────────────────────────────────────────────────────
# Keep at most this many puzzles per (theme, rating_band) combination.
# With 75 themes × 6 bands × 500 = 225 000 max possible — we'll get fewer
# because not every (theme, band) combo has 500 high-quality examples.
MAX_PER_THEME_BAND = 500

RATING_BANDS = [
    (400,  1000),
    (1000, 1300),
    (1300, 1600),
    (1600, 1900),
    (1900, 2200),
    (2200, 3500),
]

# ── Themes we care about (Lichess tags for our 12 weakness categories) ────────
TARGET_THEMES: set[str] = {
    "fork", "pin", "skewer",
    "discoveredAttack", "discoveredCheck", "doubleCheck",
    "backRankMate", "smotheredMate", "anastasiaMate", "arabianMate",
    "bodenMate", "cornerMate", "hookMate", "morphysMate", "operaMate",
    "epauletteMate", "dovetailMate",
    "mate", "mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5",
    "advancedPawn", "promotion", "underPromotion", "enPassant",
    "endgame", "pawnEndgame", "rookEndgame", "queenEndgame",
    "bishopEndgame", "knightEndgame", "queenRookEndgame",
    "exposedKing", "kingsideAttack", "queensideAttack", "attackingF2F7",
    "xRayAttack", "interference", "deflection", "clearance",
    "capturingDefender", "trappedPiece", "attraction",
    "intermezzo", "quietMove", "zugzwang", "defensiveMove",
    "crushing", "sacrifice", "advantage", "hangingPiece",
}


def _parse_game_id(game_url: str) -> str | None:
    if not game_url:
        return None
    m = re.search(r"lichess\.org/([a-zA-Z0-9]+)", game_url)
    return m.group(1) if m else None


def _open_csv(path: Path) -> Iterator[list[str]]:
    """Yield rows from a CSV (plain or .zst-compressed)."""
    if path.suffix == ".zst":
        import zstandard as zstd
        ctx = zstd.ZstdDecompressor()
        with open(path, "rb") as fh:
            stream = ctx.stream_reader(fh)
            wrapper = io.TextIOWrapper(stream, encoding="utf-8")
            reader = csv.reader(wrapper)
            next(reader, None)  # skip header
            yield from reader
    else:
        with open(path, encoding="utf-8") as fh:
            reader = csv.reader(fh)
            next(reader, None)  # skip header
            yield from reader


def _download(dest: Path) -> None:
    log.info("Downloading %s → %s", LICHESS_CSV_URL, dest)
    dest.parent.mkdir(parents=True, exist_ok=True)

    def _reporthook(block_num, block_size, total_size):
        done = block_num * block_size
        pct  = done / total_size * 100 if total_size > 0 else 0
        sys.stdout.write(f"\r  {pct:5.1f}%  ({done // 1024 // 1024} MB)")
        sys.stdout.flush()

    urllib.request.urlretrieve(LICHESS_CSV_URL, dest, _reporthook)
    print()  # newline after progress
    log.info("Download complete: %s", dest)


async def _upsert_batch(conn: asyncpg.Connection, batch: list[tuple]) -> int:
    await conn.executemany(
        """
        INSERT INTO app.lichess_puzzles
            (puzzle_id, fen, moves, rating, rating_deviation, popularity, nb_plays,
             themes, game_url, game_id, opening_tags)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11::text[])
        ON CONFLICT (puzzle_id) DO NOTHING
        """,
        batch,
    )
    return len(batch)


async def run_import(csv_path: Path, max_puzzles: int) -> None:
    db_url = os.environ.get("DATABASE_URL") or os.environ.get("DIRECT_URL")
    if not db_url:
        sys.exit("Set DATABASE_URL or DIRECT_URL to your direct (non-pooled) connection string.")

    log.info("Connecting to database…")
    conn = await asyncpg.connect(db_url)

    existing = await conn.fetchval("SELECT COUNT(*) FROM app.lichess_puzzles")
    log.info("Currently %d puzzles in app.lichess_puzzles", existing)

    # Track how many per (first_theme, band) so we stay balanced
    counts: dict[tuple[str, int], int] = {}

    def _band_idx(rating: int) -> int:
        for i, (lo, hi) in enumerate(RATING_BANDS):
            if lo <= rating < hi:
                return i
        return len(RATING_BANDS) - 1

    total_inserted = 0
    total_skipped  = 0
    batch: list[tuple] = []

    log.info("Streaming CSV…")
    for row in _open_csv(csv_path):
        if total_inserted >= max_puzzles:
            break

        if len(row) < 9:
            continue  # malformed line

        puzzle_id, fen, moves_str, rating_s, rd_s, pop_s, plays_s, themes_s, game_url = row[:9]
        opening_tags = row[9] if len(row) > 9 else ""

        # ── Quality filters ───────────────────────────────────────────────
        try:
            rating = int(rating_s)
            rd     = int(rd_s)
            pop    = int(pop_s)
            plays  = int(plays_s)
        except ValueError:
            continue

        if pop    < MIN_POPULARITY:  total_skipped += 1; continue
        if rd     > MAX_RATING_DEV: total_skipped += 1; continue
        if plays  < MIN_NB_PLAYS:   total_skipped += 1; continue

        themes = [t for t in themes_s.split() if t]
        if not themes:
            continue

        # Must overlap at least one of our target themes
        if not any(t in TARGET_THEMES for t in themes):
            total_skipped += 1
            continue

        # ── Distribution cap ──────────────────────────────────────────────
        first_target = next((t for t in themes if t in TARGET_THEMES), themes[0])
        band = _band_idx(rating)
        key  = (first_target, band)
        if counts.get(key, 0) >= MAX_PER_THEME_BAND:
            continue
        counts[key] = counts.get(key, 0) + 1

        opening_list = [t for t in opening_tags.split() if t] if opening_tags else []
        game_id = _parse_game_id(game_url)

        batch.append((
            puzzle_id, fen, moves_str,
            rating, rd, pop, plays,
            themes, game_url or None, game_id,
            opening_list,
        ))

        if len(batch) >= BATCH_SIZE:
            inserted = await _upsert_batch(conn, batch)
            total_inserted += inserted
            batch.clear()
            log.info("  %d puzzles imported…", total_inserted)

    if batch:
        total_inserted += await _upsert_batch(conn, batch)

    await conn.close()

    after = total_inserted + existing
    log.info(
        "Done. Imported: %d new | Skipped (quality/cap): %d | "
        "Total in DB now: ~%d",
        total_inserted, total_skipped, after,
    )
    log.info(
        "Theme × band distribution: %d buckets filled, max per bucket: %d",
        len(counts), MAX_PER_THEME_BAND,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--file",         type=Path, help="Path to lichess_db_puzzle.csv or .csv.zst")
    parser.add_argument("--download",     action="store_true", help="Download from Lichess if --file not given")
    parser.add_argument("--max-puzzles",  type=int, default=200_000, help="Stop after this many imported (default: 200000)")
    args = parser.parse_args()

    if args.file:
        csv_path = args.file
        if not csv_path.exists():
            sys.exit(f"File not found: {csv_path}")
    else:
        default = Path("/tmp/lichess_db_puzzle.csv.zst")
        if default.exists():
            log.info("Found cached download at %s", default)
            csv_path = default
        elif args.download or "--download" in sys.argv:
            csv_path = default
            _download(csv_path)
        else:
            sys.exit(
                "Provide --file /path/to/lichess_db_puzzle.csv[.zst] "
                "or pass --download to fetch it automatically.\n"
                f"Download URL: {LICHESS_CSV_URL}"
            )

    asyncio.run(run_import(csv_path, args.max_puzzles))


if __name__ == "__main__":
    main()

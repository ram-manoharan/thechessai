"""lichess puzzle bank

Revision ID: b2c3d4e5f6a7
Revises: a3f9c1d2e4b7
Create Date: 2026-08-14

Adds two tables in the app schema:
  - app.lichess_puzzles   — shared puzzle bank imported from Lichess (CC0)
  - app.lichess_puzzle_progress — per-user spaced-repetition tracking for those puzzles
"""
from typing import Sequence, Union

from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a3f9c1d2e4b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS app.lichess_puzzles (
            puzzle_id         TEXT PRIMARY KEY,
            fen               TEXT NOT NULL,
            moves             TEXT NOT NULL,
            rating            SMALLINT NOT NULL,
            rating_deviation  SMALLINT NOT NULL DEFAULT 500,
            popularity        SMALLINT NOT NULL DEFAULT 0,
            nb_plays          INTEGER NOT NULL DEFAULT 0,
            themes            TEXT[] NOT NULL DEFAULT '{}',
            game_url          TEXT,
            game_id           TEXT,
            opening_tags      TEXT[] DEFAULT '{}',
            -- Lazy-loaded game metadata (fetched from Lichess API on first serve)
            game_white        TEXT,
            game_black        TEXT,
            game_white_rating SMALLINT,
            game_black_rating SMALLINT,
            game_result       TEXT,
            game_event        TEXT,
            game_date         DATE,
            game_opening_name TEXT,
            game_opening_eco  TEXT,
            game_meta_fetched BOOLEAN NOT NULL DEFAULT FALSE,
            imported_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    op.execute("CREATE INDEX IF NOT EXISTS idx_lp_rating ON app.lichess_puzzles (rating)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_lp_themes ON app.lichess_puzzles USING GIN (themes)")
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_lp_rating_dev
        ON app.lichess_puzzles (rating)
        WHERE rating_deviation < 150
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_lp_themes_rating
        ON app.lichess_puzzles USING GIN (themes)
        WHERE rating_deviation < 150
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_lp_meta ON app.lichess_puzzles (game_meta_fetched) WHERE NOT game_meta_fetched")

    op.execute("""
        CREATE TABLE IF NOT EXISTS app.lichess_puzzle_progress (
            user_id     TEXT NOT NULL,
            puzzle_id   TEXT NOT NULL REFERENCES app.lichess_puzzles(puzzle_id),
            solved      BOOLEAN NOT NULL DEFAULT FALSE,
            solve_count INTEGER NOT NULL DEFAULT 0,
            fail_count  INTEGER NOT NULL DEFAULT 0,
            last_solved TIMESTAMPTZ,
            next_due    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            stability   REAL NOT NULL DEFAULT 1.5,
            difficulty  REAL NOT NULL DEFAULT 5.0,
            PRIMARY KEY (user_id, puzzle_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_lpp_due ON app.lichess_puzzle_progress (user_id, next_due)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS app.lichess_puzzle_progress")
    op.execute("DROP TABLE IF EXISTS app.lichess_puzzles")

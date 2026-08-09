"""mistake pattern, saved puzzle, puzzle progress spaced repetition

Revision ID: 8d54b77ff65d
Revises: 67fbb79773ec
Create Date: 2026-08-09 22:45:05.249354

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8d54b77ff65d'
down_revision: Union[str, None] = '67fbb79773ec'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Every flagged mistake a signed-in user gets an explanation for (or a
    # generated puzzle from), tagged by tactical/positional theme. The
    # per-user aggregation of this table is the "mistake fingerprint" —
    # which patterns cost this player the most Elo, ranked by frequency and
    # impact — driving the spaced-repetition puzzle queue below.
    op.execute("""
        CREATE TABLE app.mistake_pattern (
            id          BIGSERIAL PRIMARY KEY,
            user_id     TEXT NOT NULL,
            theme       TEXT NOT NULL,
            phase       TEXT,
            cp_loss     INTEGER NOT NULL DEFAULT 0,
            fen         TEXT NOT NULL,
            move_san    TEXT,
            occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX idx_mistake_pattern_user_theme ON app.mistake_pattern (user_id, theme)")

    # Puzzles auto-extracted from a signed-in user's own analyzed games,
    # persisted (rather than regenerated per-PGN on demand) so they can be
    # queued for spaced-repetition practice across sessions.
    op.execute("""
        CREATE TABLE app.saved_puzzle (
            id             BIGSERIAL PRIMARY KEY,
            user_id        TEXT NOT NULL,
            fen            TEXT NOT NULL,
            best_move_san  TEXT NOT NULL,
            continuation   TEXT[] NOT NULL DEFAULT '{}',
            theme          TEXT NOT NULL,
            cp_loss        INTEGER NOT NULL DEFAULT 0,
            phase          TEXT,
            source_white   TEXT,
            source_black   TEXT,
            source_date    TEXT,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (user_id, fen)
        )
    """)
    op.execute("CREATE INDEX idx_saved_puzzle_user ON app.saved_puzzle (user_id)")

    # Spaced-repetition scheduling for puzzle_progress (built earlier this
    # session for a simple solved/unsolved flag). New rows default to due
    # immediately; solving pushes next_review_at out (1d -> 7d -> 30d),
    # missing resets it to 1d.
    op.execute("ALTER TABLE app.puzzle_progress ADD COLUMN next_review_at TIMESTAMPTZ NOT NULL DEFAULT now()")
    op.execute("ALTER TABLE app.puzzle_progress ADD COLUMN streak INTEGER NOT NULL DEFAULT 0")
    op.execute("CREATE INDEX idx_puzzle_progress_next_review ON app.puzzle_progress (user_id, next_review_at)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS app.idx_puzzle_progress_next_review")
    op.execute("ALTER TABLE app.puzzle_progress DROP COLUMN IF EXISTS streak")
    op.execute("ALTER TABLE app.puzzle_progress DROP COLUMN IF EXISTS next_review_at")
    op.execute("DROP TABLE IF EXISTS app.saved_puzzle")
    op.execute("DROP TABLE IF EXISTS app.mistake_pattern")

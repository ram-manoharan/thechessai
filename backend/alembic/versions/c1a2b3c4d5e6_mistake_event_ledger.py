"""mistake event ledger

Revision ID: c1a2b3c4d5e6
Revises: b2c3d4e5f6a7
Create Date: 2026-08-16

The "Recurrence Engine" dataset: one row per flagged move (Inaccuracy or
worse) of a signed-in user's OWN moves, written automatically at game-save
time -- not just when a user clicks "explain" (that's app.mistake_pattern,
left untouched, still fed only by /position/explain). Append-only in spirit:
occurred_at/fen_before/move_san/etc. are never rewritten after insert;
explanation_shown/user_response/cognitive_error_type/recurred_event_id are
nullable fields filled in exactly once, later, by separate code paths.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "c1a2b3c4d5e6"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE app.mistake_event (
            id                    BIGSERIAL PRIMARY KEY,
            user_id               TEXT NOT NULL,
            game_id               BIGINT NOT NULL REFERENCES app.analyzed_game(id) ON DELETE CASCADE,
            move_number           INTEGER NOT NULL,
            color                 TEXT NOT NULL CHECK (color IN ('White','Black')),
            ply                   INTEGER NOT NULL,
            fen_before            TEXT NOT NULL,
            fen_after             TEXT NOT NULL,
            move_san              TEXT NOT NULL,
            best_move_san         TEXT,
            classification        TEXT NOT NULL,
            cp_loss               INTEGER NOT NULL DEFAULT 0,
            phase                 TEXT,
            tactical_theme        TEXT,
            position_features     JSONB NOT NULL DEFAULT '{}',
            cognitive_error_type  TEXT,
            elo_band              TEXT,
            explanation_shown     BOOLEAN NOT NULL DEFAULT FALSE,
            user_response         TEXT,
            recurred_event_id     BIGINT REFERENCES app.mistake_event(id) ON DELETE SET NULL,
            occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (game_id, ply)
        )
    """)
    op.execute("CREATE INDEX idx_mistake_event_user_theme    ON app.mistake_event (user_id, tactical_theme)")
    op.execute("CREATE INDEX idx_mistake_event_user_occurred ON app.mistake_event (user_id, occurred_at DESC)")
    op.execute("CREATE INDEX idx_mistake_event_game          ON app.mistake_event (game_id)")
    op.execute("CREATE INDEX idx_mistake_event_cohort        ON app.mistake_event (elo_band, tactical_theme)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS app.mistake_event")

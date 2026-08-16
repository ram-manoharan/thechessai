"""opponent mistake event

Revision ID: e3f4a5b6c7d8
Revises: d2b3c4d5e6f7
Create Date: 2026-08-16

Same shape as app.mistake_event, but for the OPPONENT's flagged moves in a
signed-in user's saved games -- kept in a separate table (not user_id-keyed
rows in mistake_event) because every existing reader of mistake_event treats
user_id as "who made this mistake"; opponent data under the tracker's own
user_id would silently pollute their own weakness stats. Identity key is
(tracked_by_user_id, opponent_name) -- exact, trimmed string match on the PGN
header name, not a registered user. Feeds opponent_profile.py, which powers
replay's "AI clone of this specific opponent" deviation model.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "e3f4a5b6c7d8"
down_revision: Union[str, None] = "d2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE app.opponent_mistake_event (
            id                    BIGSERIAL PRIMARY KEY,
            tracked_by_user_id    TEXT NOT NULL,
            opponent_name         TEXT NOT NULL,
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
            clock_remaining       REAL,
            elo_band              TEXT,
            occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (game_id, ply)
        )
    """)
    op.execute("CREATE INDEX idx_opponent_mistake_event_lookup ON app.opponent_mistake_event (tracked_by_user_id, opponent_name)")
    op.execute("CREATE INDEX idx_opponent_mistake_event_theme  ON app.opponent_mistake_event (tracked_by_user_id, opponent_name, tactical_theme)")
    op.execute("CREATE INDEX idx_opponent_mistake_event_game   ON app.opponent_mistake_event (game_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS app.opponent_mistake_event")

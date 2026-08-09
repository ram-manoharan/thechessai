"""analyzed game + saved profile history

Revision ID: a3f9c1d2e4b7
Revises: 8d54b77ff65d
Create Date: 2026-08-10 09:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3f9c1d2e4b7'
down_revision: Union[str, None] = '8d54b77ff65d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Full, ready-to-render analysis for a signed-in user's game — the
    # frontend saves this once after /game/stream finishes (not from inside
    # the streaming endpoint itself, to keep the delicate SSE generator
    # untouched) and reads it straight back on revisit instead of re-running
    # Stockfish + the AI report. `payload` holds the exact shape the analyze
    # page's store expects (metadata, positions, opening, moves_data,
    # ai_report, estimated_elo) so loading history is a pure hydration, no
    # recomputation. Keyed on a hash of the PGN so re-analysing the same
    # game refreshes the existing row instead of piling up duplicates.
    op.execute("""
        CREATE TABLE app.analyzed_game (
            id             BIGSERIAL PRIMARY KEY,
            user_id        TEXT NOT NULL,
            pgn_hash       TEXT NOT NULL,
            pgn            TEXT NOT NULL,
            white          TEXT,
            black          TEXT,
            game_date      TEXT,
            result         TEXT,
            event          TEXT,
            player_color   TEXT NOT NULL,
            opening_name   TEXT,
            opening_eco    TEXT,
            estimated_elo  INTEGER,
            accuracy_white REAL,
            accuracy_black REAL,
            payload        JSONB NOT NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (user_id, pgn_hash)
        )
    """)
    op.execute("CREATE INDEX idx_analyzed_game_user ON app.analyzed_game (user_id, created_at DESC)")

    # Same idea for player-profile builds (the multi-game "who are you as a
    # player" report). One row per (user, provider, username) for
    # lichess/chesscom — rebuilding just refreshes it, matching the mental
    # model of "my Lichess profile" being a single evolving thing. Pasted-PGN
    # profiles have no stable username to key on, so `username` stays NULL
    # and every paste is kept as its own distinct history entry (NULL isn't
    # equal to NULL under the unique constraint, so these never collide).
    op.execute("""
        CREATE TABLE app.saved_profile (
            id           BIGSERIAL PRIMARY KEY,
            user_id      TEXT NOT NULL,
            provider     TEXT NOT NULL CHECK (provider IN ('lichess', 'chesscom', 'pgn')),
            username     TEXT,
            player_name  TEXT NOT NULL,
            games_count  INTEGER NOT NULL DEFAULT 0,
            payload      JSONB NOT NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (user_id, provider, username)
        )
    """)
    op.execute("CREATE INDEX idx_saved_profile_user ON app.saved_profile (user_id, created_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS app.saved_profile")
    op.execute("DROP TABLE IF EXISTS app.analyzed_game")

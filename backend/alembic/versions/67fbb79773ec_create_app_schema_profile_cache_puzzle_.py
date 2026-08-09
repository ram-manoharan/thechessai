"""create app schema, profile_cache, puzzle_progress

Revision ID: 67fbb79773ec
Revises: 
Create Date: 2026-08-09 12:21:53.361981

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '67fbb79773ec'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS app")

    # Cache-aside store for player_profile_service's expensive aggregation
    # (currently recomputed from scratch on every view — refetching + reanalysing
    # up to 100 games). No DB-level FK to Prisma's public.users — this table is
    # migrated by a different tool and holds only derived/cache data that
    # self-heals via upsert + TTL, never source-of-truth.
    op.execute("""
        CREATE TABLE app.profile_cache (
            user_id     TEXT NOT NULL,
            provider    TEXT NOT NULL CHECK (provider IN ('lichess', 'chesscom')),
            username    TEXT NOT NULL,
            stats_json  JSONB NOT NULL,
            computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at  TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (user_id, provider)
        )
    """)
    op.execute("CREATE INDEX idx_profile_cache_expires_at ON app.profile_cache (expires_at)")

    op.execute("""
        CREATE TABLE app.puzzle_progress (
            id         BIGSERIAL PRIMARY KEY,
            user_id    TEXT NOT NULL,
            puzzle_fen TEXT NOT NULL,
            solved     BOOLEAN NOT NULL DEFAULT false,
            solved_at  TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (user_id, puzzle_fen)
        )
    """)
    op.execute("CREATE INDEX idx_puzzle_progress_user ON app.puzzle_progress (user_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS app.puzzle_progress")
    op.execute("DROP TABLE IF EXISTS app.profile_cache")
    op.execute("DROP SCHEMA IF EXISTS app CASCADE")

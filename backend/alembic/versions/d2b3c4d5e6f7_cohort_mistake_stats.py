"""cohort mistake stats

Revision ID: d2b3c4d5e6f7
Revises: c1a2b3c4d5e6
Create Date: 2026-08-16

Anonymized, aggregate answer to "what do players at this level typically
get wrong here" -- keyed on (elo_band, tactical_theme), never on individual
users. sample_size >= 30 is a hard floor (enforced both here and in
cohort_service.py's read path) against small-sample noise and
re-identification risk. Lazily refreshed on stale read (see
cohort_service.py), mirroring app.profile_cache's existing pattern -- no
cron/scheduler.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "d2b3c4d5e6f7"
down_revision: Union[str, None] = "c1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE app.cohort_mistake_stats (
            id                          BIGSERIAL PRIMARY KEY,
            elo_band                    TEXT NOT NULL,
            tactical_theme              TEXT NOT NULL,
            sample_size                 INTEGER NOT NULL CHECK (sample_size >= 30),
            avg_cp_loss                 REAL NOT NULL,
            cognitive_error_breakdown   JSONB NOT NULL DEFAULT '{}',
            computed_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (elo_band, tactical_theme)
        )
    """)
    op.execute("CREATE INDEX idx_cohort_mistake_stats_band ON app.cohort_mistake_stats (elo_band)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS app.cohort_mistake_stats")

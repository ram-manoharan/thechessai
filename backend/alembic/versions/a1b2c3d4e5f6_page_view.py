"""page view tracking

Revision ID: a1b2c3d4e5f6
Revises: f4a5b6c7d8e9
Create Date: 2026-08-17

Powers the admin dashboard's "site visits" numbers. Logged from a
site-wide client component (frontend/components/PageViewTracker.tsx) that
fires on every route change except /admin itself -- admin's own dashboard
usage shouldn't count as traffic. Same TEXT user_id, no-FK convention as
every other app.* table (see app.feedback's migration for the rationale).
"""
from typing import Sequence, Union

from alembic import op


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "f4a5b6c7d8e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE app.page_view (
            id            BIGSERIAL PRIMARY KEY,
            path          TEXT NOT NULL,
            user_id       TEXT,
            referrer      TEXT,
            user_agent    TEXT,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX idx_page_view_created_at ON app.page_view (created_at DESC)")
    op.execute("CREATE INDEX idx_page_view_path ON app.page_view (path)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS app.page_view")

"""user feedback

Revision ID: f4a5b6c7d8e9
Revises: e3f4a5b6c7d8
Create Date: 2026-08-17

Freeform feedback submitted via the site-wide feedback widget (see
frontend/components/FeedbackWidget.tsx). Works both signed-in and
anonymous — user_id/email are populated when the submitter is signed in,
NULL otherwise. Deliberately just a TEXT user_id (no DB-level FK), same
convention as every other app.* table in this project: the users table
lives in Prisma's public schema, and mixing ORMs across a real foreign
key isn't worth it for what is, structurally, a write-mostly log table.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "f4a5b6c7d8e9"
down_revision: Union[str, None] = "e3f4a5b6c7d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE app.feedback (
            id            BIGSERIAL PRIMARY KEY,
            user_id       TEXT,
            email         TEXT,
            rating        SMALLINT,
            message       TEXT NOT NULL,
            page_path     TEXT,
            user_agent    TEXT,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT feedback_rating_range CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5))
        )
    """)
    op.execute("CREATE INDEX idx_feedback_created_at ON app.feedback (created_at DESC)")
    op.execute("CREATE INDEX idx_feedback_user_id ON app.feedback (user_id) WHERE user_id IS NOT NULL")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS app.feedback")

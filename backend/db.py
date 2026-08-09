"""asyncpg connection pool for the `app` Postgres schema.

Prisma (in the Next.js app) owns `public.*` (users, accounts, chess_profiles);
this module only ever touches `app.*` — see alembic/versions/ for that schema's
migrations. No FK to public.users at the DB level (different migration owners),
so `user_id` here is just a plain text column matching Prisma's `User.id` (a
cuid string) — referential integrity is enforced at the app layer.
"""
import os
import logging
from typing import Optional

import asyncpg

logger = logging.getLogger(__name__)

_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        dsn = os.environ["DATABASE_URL"]
        # asyncpg doesn't understand the "postgresql+driver://" style; plain
        # "postgresql://" / "postgres://" both work fine as-is.
        _pool = await asyncpg.create_pool(
            dsn=dsn,
            min_size=2,
            max_size=10,
            command_timeout=10,
        )
        logger.info("Postgres pool created (app schema)")
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None

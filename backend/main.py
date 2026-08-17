import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from routers import analysis, imports, profile, user, scoresheet, replay, stats, feedback, tracking, admin
import db as db_module
import engine_pool
import human_engine_pool


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_module.get_pool()
    # Eager start (off the event loop -- popen_uci is blocking I/O) instead
    # of the old lazy-on-first-request singleton: fails fast at deploy time
    # if Stockfish isn't found, rather than surprising the first user with
    # both the discovery cost AND a confusing mid-request error.
    await run_in_threadpool(engine_pool.init_pool)
    # Maia/lc0 is optional -- if lc0 isn't installed or maia_weights/ is
    # missing, init_pool() logs a warning and leaves the pool empty rather
    # than failing startup; the replay endpoint reports 503 per-request
    # instead of taking down the whole app over an optional feature.
    await run_in_threadpool(human_engine_pool.init_pool)
    yield
    engine_pool.shutdown()
    human_engine_pool.shutdown()
    await db_module.close_pool()


app = FastAPI(title="chessAIlytics API", version="0.1.0", lifespan=lifespan)

# The frontend calls this API directly from the browser (NEXT_PUBLIC_API_URL),
# not through a same-origin proxy, so the deployed frontend's real origin has
# to be listed here or every request gets CORS-blocked. Comma-separated so
# staging + production can both be allowed at once; defaults to local dev.
_default_origins = "http://localhost:3000,http://localhost:3001"
allowed_origins = [
    origin.strip()
    for origin in os.environ.get("CORS_ALLOWED_ORIGINS", _default_origins).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analysis.router,   prefix="/api/analysis",   tags=["analysis"])
app.include_router(imports.router,    prefix="/api/import",     tags=["import"])
app.include_router(profile.router,    prefix="/api/profile",    tags=["profile"])
app.include_router(user.router,       prefix="/api/user",       tags=["user"])
app.include_router(scoresheet.router, prefix="/api/scoresheet", tags=["scoresheet"])
app.include_router(replay.router,     prefix="/api/replay",     tags=["replay"])
app.include_router(stats.router,      prefix="/api/stats",      tags=["stats"])
app.include_router(feedback.router,   prefix="/api/feedback",   tags=["feedback"])
app.include_router(tracking.router,   prefix="/api/track",      tags=["tracking"])
app.include_router(admin.router,      prefix="/api/admin",      tags=["admin"])

@app.get("/api/health")
def health():
    return {"status": "ok"}

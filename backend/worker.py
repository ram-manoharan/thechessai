#!/usr/bin/env python3
"""RQ worker entrypoint for background game-analysis jobs (see jobs.py).

A separate process from the web server (main.py/uvicorn) -- this is what
lets the web tier stay cheap and stateless (just enqueue + poll) while the
actual Stockfish/AI compute happens here, decoupled from any single HTTP
request's lifetime. Scaling analysis capacity is "run more of these",
independent of how many web replicas exist.

Run from the backend/ directory: python worker.py
(Same environment/.env as the web process -- REDIS_URL, DATABASE_URL,
STOCKFISH_POOL_SIZE, AI provider keys, etc. all apply here too.)
"""
import logging

from dotenv import load_dotenv
load_dotenv()

from rq import SimpleWorker  # noqa: E402

import engine_pool  # noqa: E402
from jobs import QUEUE_NAME, _redis_connection  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main() -> None:
    logger.info("Starting analysis worker -- initializing engines...")
    # Same eager-start-at-boot rationale as main.py's lifespan: fail fast if
    # Stockfish isn't found, rather than surprising the first job with a
    # confusing mid-run error. Maia/lc0 is deliberately NOT started here --
    # jobs.run_full_game_analysis never touches it (replay stays on the web
    # tier, synchronous), so starting it on every worker instance would just
    # be an extra process + weight-loading cost with nothing using it. Add
    # it back if a job ever actually needs it.
    n_sf = engine_pool.init_pool()
    logger.info("Engines ready: %d Stockfish", n_sf)
    if n_sf == 0:
        logger.warning("No Stockfish engine available -- jobs will fail until this is fixed.")

    # SimpleWorker, not the default Worker: the default forks a "work-horse"
    # subprocess per job, which reliably crashes on macOS (Objective-C
    # runtime fork-safety abort -- unrelated to this app's code, a known
    # CPython-on-Darwin multiprocessing gotcha) and adds a fork per job for
    # no benefit here anyway, since engine_pool already isolates the actual
    # heavy work in its own long-lived subprocesses. Runs identically on
    # macOS dev and Linux prod -- deliberately not special-cased per platform.
    worker = SimpleWorker([QUEUE_NAME], connection=_redis_connection())
    try:
        worker.work(with_scheduler=False)
    finally:
        engine_pool.shutdown()


if __name__ == "__main__":
    main()

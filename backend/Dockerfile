FROM python:3.11-slim

# Debian's stockfish package installs to /usr/games, which isn't always on
# PATH in minimal images — chess_analysis.py finds the engine via
# shutil.which("stockfish"), so this has to be set explicitly rather than
# relying on the base image's default PATH.
ENV PATH="/usr/games:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends stockfish \
    && rm -rf /var/lib/apt/lists/* \
    && which stockfish

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Render (and most PaaS hosts) inject the port to bind via $PORT at runtime;
# 8000 is just the local-dev fallback.
#
# Deliberately single uvicorn process (no --workers) — CPU concurrency for
# Stockfish analysis comes from engine_pool.py's in-process engine pool
# (STOCKFISH_POOL_SIZE env var), not from multiple uvicorn worker processes.
# Adding --workers N here would multiply that by N (each worker process runs
# its own independent engine_pool, unaware of the others), silently using
# far more CPU/RAM than STOCKFISH_POOL_SIZE alone suggests — scale via that
# env var, not this flag.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]

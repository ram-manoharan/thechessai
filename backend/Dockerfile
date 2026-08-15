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

# lc0 (Leela Chess Zero) -- runs the Maia weight files (backend/maia_weights/,
# checked into the repo like the Stockfish binary above) that power the
# "replay against a human-calibrated opponent" feature. No prebuilt Linux
# binary is published upstream (only Windows/Android), so it's built from
# source here; CPU-only via OpenBLAS, no GPU needed since Maia disables
# search (go nodes 1 -- a single forward pass through the policy net, not a
# tree search), which is also its officially validated mode of use.
#
# The build is wrapped so a failure here can't break the whole image build:
# if compiling lc0 ever breaks (upstream branch changes, apt package
# rename), the rest of this Dockerfile -- and the existing Stockfish-backed
# features -- still ship. human_engine_pool.py already treats a missing lc0
# binary as "replay feature unavailable" rather than a startup crash, so a
# soft failure here surfaces as a 503 on /api/replay/move, not a broken
# deploy. Check the build log for "lc0 build OK" vs the warning below after
# the first deploy following any change to this block.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         git gcc g++ zlib1g zlib1g-dev ninja-build libopenblas-dev pkg-config python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --no-cache-dir meson \
    && ( git clone --depth 1 --branch release/0.32 https://github.com/LeelaChessZero/lc0.git /tmp/lc0 \
         && cd /tmp/lc0 \
         && ./build.sh \
         && cp build/release/lc0 /usr/local/bin/lc0 \
         && echo "lc0 build OK" \
         || echo "WARNING: lc0 build failed -- replay feature will be unavailable at runtime" ) \
    && rm -rf /tmp/lc0

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

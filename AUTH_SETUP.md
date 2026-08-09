# Login feature — setup

Google and Lichess are the two real "sign in with" methods (chess.com has no
OAuth API — its username is just an optional linked field, validated against
its public API). Everything in this repo is already wired up; the two things
below are the only steps that require *your* action, since I can't create
accounts or agree to third-party terms on your behalf.

## 1. Local infra (already running for you in this session)

Postgres + Redis are required. This repo ships a `docker-compose.yml` with
the production-shape topology (Postgres → PgBouncer → app, plus Redis) for
whenever Docker is available. For this session (no Docker in the sandbox)
they're running natively via Homebrew instead — same `chessai`/`chessai`
credentials either way, so no env vars need to change if you switch:

```bash
# If you have Docker:
docker compose up -d

# Equivalent without Docker (what's currently running):
brew services start postgresql@16
/usr/local/opt/redis/bin/redis-server --port 6379 --daemonize no --save "" --appendonly no &
```

Migrations (run once, or after schema changes):

```bash
cd frontend && npx prisma migrate dev   # public schema: users, accounts, chess_profiles
cd backend  && python3 -m alembic upgrade head   # app schema: profile_cache, puzzle_progress
```

## 2. OAuth credentials — you need to create these

### Google

1. [Google Cloud Console](https://console.cloud.google.com/) → create/select a project → **APIs & Services → Credentials**.
2. **Create Credentials → OAuth client ID** → Application type: **Web application**.
3. Authorized redirect URI: `http://localhost:3001/api/auth/callback/google` (add your production URL later, same path).
4. Copy the generated **Client ID** and **Client secret** into `frontend/.env.local`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

### Lichess

1. Sign in at [lichess.org](https://lichess.org) → **Preferences → API access tokens** → scroll to **OAuth apps** → **New**.
2. Redirect URI: `http://localhost:3001/api/auth/callback/lichess`.
3. Lichess issues these as **public clients — no secret**, only a Client ID. Copy it into `frontend/.env.local`:
   ```
   LICHESS_CLIENT_ID=...
   ```

Once both are set, restart the Next.js dev server and `/login` will work end to end.

## What's already generated for you (local dev only — regenerate for production)

- `AUTH_SECRET` (Auth.js session encryption)
- `INTERNAL_JWT_SECRET` (shared between frontend and backend — signs the
  short-lived token Next.js mints for calls into FastAPI)

Both live in `frontend/.env.local` and `backend/.env` already. Regenerate with:

```bash
npx auth secret                # AUTH_SECRET
openssl rand -hex 32           # INTERNAL_JWT_SECRET
```

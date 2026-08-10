from fastapi import APIRouter, HTTPException, Query
import httpx

import cache_service

router = APIRouter()

_HEADERS = {
    "Accept": "application/x-chess-pgn",
    "User-Agent": "chessAIlytics/1.0 (github.com/chessAIlytics)",
}

# Short TTL, not the default ~1h used elsewhere -- someone re-importing right
# after finishing a game should see it soon, but repeat lookups of the same
# username within this window (re-opening the import panel, re-checking a
# username someone else already looked up) skip a fresh round-trip to an
# API we don't control the rate limits on.
_IMPORT_CACHE_TTL_SECONDS = 240


@router.get("/lichess/{username}")
async def lichess_games(username: str, count: int = Query(default=10, le=100)):
    username = username.strip()

    async def _fetch():
        url = f"https://lichess.org/api/games/user/{username}"
        params = {"max": count, "format": "pgn", "clocks": "true", "evals": "false"}
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(url, params=params, headers=_HEADERS)
        except httpx.TimeoutException:
            raise HTTPException(504, "Lichess timed out — try again.")
        except Exception as e:
            raise HTTPException(502, str(e))

        if resp.status_code == 404:
            raise HTTPException(404, f"User '{username}' not found on Lichess.")
        if resp.status_code == 429:
            raise HTTPException(429, "Lichess rate limit — wait a moment and retry.")
        if resp.status_code != 200:
            raise HTTPException(502, f"Lichess API error {resp.status_code}.")
        if not resp.text.strip():
            raise HTTPException(404, f"No games found for '{username}' on Lichess.")

        return {"pgn": resp.text.strip()}

    return await cache_service.get_or_set(
        f"import:lichess:{username}:{count}", _fetch, ttl_seconds=_IMPORT_CACHE_TTL_SECONDS
    )


@router.get("/chessdotcom/{username}")
async def chessdotcom_games(username: str, count: int = Query(default=10, le=100)):
    username = username.strip()

    async def _fetch():
        headers = {"User-Agent": "chessAIlytics/1.0 (github.com/chessAIlytics)"}
        archives_url = f"https://api.chess.com/pub/player/{username}/games/archives"

        async with httpx.AsyncClient(timeout=15) as client:
            try:
                resp = await client.get(archives_url, headers=headers)
            except Exception as e:
                raise HTTPException(502, str(e))

            if resp.status_code == 404:
                raise HTTPException(404, f"User '{username}' not found on Chess.com.")
            if resp.status_code != 200:
                raise HTTPException(502, f"Chess.com API error {resp.status_code}.")

            archives = resp.json().get("archives", [])
            if not archives:
                raise HTTPException(404, f"No games found for '{username}'.")

            # Cached as one unit below -- this loop is the expensive part
            # (up to `count` sequential archive fetches against an API we
            # don't control the rate limits on), so a repeat request for
            # the same username+count skips all of it, not just the first
            # archives-list call.
            collected: list[str] = []
            for archive_url in reversed(archives):
                if len(collected) >= count:
                    break
                try:
                    r = await client.get(archive_url, headers=headers)
                    if r.status_code == 200:
                        for g in reversed(r.json().get("games", [])):
                            if len(collected) >= count:
                                break
                            if pgn := g.get("pgn", ""):
                                collected.append(pgn)
                except Exception:
                    continue

        if not collected:
            raise HTTPException(404, f"No PGN games found for '{username}'.")

        return {"pgn": "\n\n".join(collected)}

    return await cache_service.get_or_set(
        f"import:chesscom:{username}:{count}", _fetch, ttl_seconds=_IMPORT_CACHE_TTL_SECONDS
    )


@router.get("/lichess/{username}/rating-history")
async def lichess_rating_history(username: str):
    """Return Lichess rating history for all time controls."""
    username = username.strip()

    async def _fetch():
        url = f"https://lichess.org/api/user/{username}/rating-history"
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url, headers={"User-Agent": "chessAIlytics/1.0"})
        except httpx.TimeoutException:
            raise HTTPException(504, "Lichess timed out.")
        except Exception as e:
            raise HTTPException(502, str(e))
        return await _rating_history_response(resp, username)

    return await cache_service.get_or_set(
        f"import:lichess-rating:{username}", _fetch, ttl_seconds=_IMPORT_CACHE_TTL_SECONDS
    )


async def _rating_history_response(resp, username: str):
    if resp.status_code == 404:
        raise HTTPException(404, f"User '{username}' not found on Lichess.")
    if resp.status_code != 200:
        raise HTTPException(502, f"Lichess API error {resp.status_code}.")
    return resp.json()

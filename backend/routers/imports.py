from fastapi import APIRouter, HTTPException, Query
import httpx

router = APIRouter()

_HEADERS = {
    "Accept": "application/x-chess-pgn",
    "User-Agent": "chessAIlytics/1.0 (github.com/chessAIlytics)",
}


@router.get("/lichess/{username}")
async def lichess_games(username: str, count: int = Query(default=10, le=100)):
    url = f"https://lichess.org/api/games/user/{username.strip()}"
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


@router.get("/chessdotcom/{username}")
async def chessdotcom_games(username: str, count: int = Query(default=10, le=100)):
    headers = {"User-Agent": "chessAIlytics/1.0 (github.com/chessAIlytics)"}
    archives_url = f"https://api.chess.com/pub/player/{username.strip()}/games/archives"

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


@router.get("/lichess/{username}/rating-history")
async def lichess_rating_history(username: str):
    """Return Lichess rating history for all time controls."""
    url = f"https://lichess.org/api/user/{username.strip()}/rating-history"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers={"User-Agent": "chessAIlytics/1.0"})
    except httpx.TimeoutException:
        raise HTTPException(504, "Lichess timed out.")
    except Exception as e:
        raise HTTPException(502, str(e))
    if resp.status_code == 404:
        raise HTTPException(404, f"User '{username}' not found on Lichess.")
    if resp.status_code != 200:
        raise HTTPException(502, f"Lichess API error {resp.status_code}.")
    return resp.json()

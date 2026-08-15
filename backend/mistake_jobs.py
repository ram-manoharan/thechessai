"""Async backfill of app.mistake_event.cognitive_error_type -- the "why did
they miss it" layer on top of classify_tactical_theme()'s "what did they
miss." One LLM call per GAME (not per mistake), enqueued right after
save_analyzed_game persists that game's mistake_event rows.

Runs on the existing "analysis" RQ queue / worker.py fleet -- no new queue,
no new worker process. Deliberately best-effort end to end: any failure
here must never surface to the user, since the game save it follows has
already succeeded and returned.
"""
import asyncio
import json
import logging
import os

from jobs import get_queue, RESULT_TTL_SECONDS

logger = logging.getLogger(__name__)

COGNITIVE_ERROR_TYPES = [
    "candidate_blindness",
    "calculation_truncation",
    "static_misevaluation",
    "defensive_resource_miss",
    "time_pressure",
    "automatic_pattern",
]

_PROMPT_TEMPLATE = """You are a chess cognitive-error classifier. For EACH move below, pick exactly one label from this list: {labels}

- candidate_blindness: the played move likely wasn't considered at all
- calculation_truncation: the right idea was seen but calculation stopped too early
- static_misevaluation: the resulting position was foreseen but wrongly judged
- defensive_resource_miss: missed an opponent's saving/defensive resource
- time_pressure: likely a clock-driven error, not a knowledge gap
- automatic_pattern: a habitual move played without re-checking this specific position

MOVES:
{moves_block}

Return ONLY a JSON array, no markdown fences, no commentary: [{{"id": <id>, "cognitive_error_type": "<label>"}}]"""


def enqueue_classify_cognitive_errors(game_id: int):
    return get_queue().enqueue(
        classify_cognitive_errors_for_game, game_id,
        job_timeout=60, result_ttl=RESULT_TTL_SECONDS, failure_ttl=RESULT_TTL_SECONDS,
    )


def classify_cognitive_errors_for_game(game_id: int) -> dict:
    try:
        return asyncio.run(_classify(game_id))
    except Exception as e:
        logger.error("cognitive_error_type classification failed for game %s: %s", game_id, e)
        return {"classified": 0, "error": str(e)}


async def _classify(game_id: int) -> dict:
    # A short-lived connect()/close(), NOT db.get_pool()'s shared singleton --
    # that pool binds to whichever event loop first calls it, and RQ's
    # SimpleWorker runs each job through its own fresh asyncio.run() (a new
    # loop every invocation). Reusing the pool here would bind it to a loop
    # that closes the moment this job returns -- the exact cross-event-loop
    # corruption class this backend has already been bitten by once. The
    # connect/close overhead here is trivial next to the LLM call anyway.
    import asyncpg
    from ai_service import AIService

    conn = await asyncpg.connect(dsn=os.environ["DATABASE_URL"])
    try:
        rows = await conn.fetch(
            """
            SELECT id, ply, move_san, best_move_san, classification, cp_loss, phase, tactical_theme
            FROM app.mistake_event
            WHERE game_id = $1 AND cognitive_error_type IS NULL
            ORDER BY ply
            """,
            game_id,
        )
        if not rows:
            return {"classified": 0}

        ai = AIService()
        if not getattr(ai, "model_available", False):
            return {"classified": 0, "skipped": "AI unavailable"}

        moves_block = "\n".join(
            f"[{r['id']}] Move {r['ply']}: played {r['move_san']} (best was {r['best_move_san']}), "
            f"{r['classification']}, cp_loss={r['cp_loss']}, phase={r['phase']}, theme={r['tactical_theme']}"
            for r in rows
        )
        prompt = _PROMPT_TEMPLATE.format(labels=COGNITIVE_ERROR_TYPES, moves_block=moves_block)

        response = ai._create_completion(
            model=ai.model_name,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1024,
            temperature=0.0,
        )
        raw = response.choices[0].message.content.strip()
        raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        results = json.loads(raw)

        updated = 0
        for item in results:
            label = item.get("cognitive_error_type")
            if label not in COGNITIVE_ERROR_TYPES:
                continue
            result = await conn.execute(
                "UPDATE app.mistake_event SET cognitive_error_type = $1 WHERE id = $2 AND game_id = $3",
                label, item.get("id"), game_id,
            )
            if result == "UPDATE 1":
                updated += 1
        return {"classified": updated}
    finally:
        await conn.close()

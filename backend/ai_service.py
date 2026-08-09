import os
import re
import logging
from typing import Optional
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

# ── Provider configuration ────────────────────────────────────────────────────
# Set AI_PROVIDER in your .env to choose which LLM backend to use.
# Supported values: "openai" | "together" | "fireworks" | "deepseek" | "mistral" | "groq"
# Defaults to "openai" if not set.
#
# Required env vars per provider:
#   openai    → OPENAI_API_KEY
#   together  → TOGETHER_API_KEY
#   fireworks → FIREWORKS_API_KEY
#   deepseek  → DEEPSEEK_API_KEY
#   mistral   → MISTRAL_API_KEY
#   groq      → GROQ_API_KEY
#
# All providers except Groq use the openai Python package with a custom base_url.
# Install: pip install openai   (already a transitive dep via groq in most envs)

_PROVIDER_CONFIG = {
    "openai": {
        "base_url":     None,   # use default OpenAI endpoint
        "api_key":      os.getenv("OPENAI_API_KEY"),
        "model":        "gpt-4o-mini",
        "vision_model": "gpt-4o-mini",   # supports vision natively
    },
    "together": {
        "base_url":     "https://api.together.xyz/v1",
        "api_key":      os.getenv("TOGETHER_API_KEY"),
        "model":        "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        "vision_model": "Qwen/Qwen2-VL-72B-Instruct",
    },
    "fireworks": {
        "base_url":     "https://api.fireworks.ai/inference/v1",
        "api_key":      os.getenv("FIREWORKS_API_KEY"),
        "model":        "accounts/fireworks/models/llama-v3p3-70b-instruct",
        "vision_model": "accounts/fireworks/models/llama-v3p2-11b-vision-instruct",
    },
    "deepseek": {
        "base_url":     "https://api.deepseek.com/v1",
        "api_key":      os.getenv("DEEPSEEK_API_KEY"),
        "model":        "deepseek-chat",
        "vision_model": None,  # DeepSeek has no vision API yet — falls back to Groq
    },
    "mistral": {
        "base_url":     "https://api.mistral.ai/v1",
        "api_key":      os.getenv("MISTRAL_API_KEY"),
        "model":        "mistral-small-latest",
        "vision_model": "pixtral-12b-2409",
    },
    "groq": {
        "base_url":     "https://api.groq.com/openai/v1",
        "api_key":      os.getenv("GROQ_API_KEY"),
        "model":        "llama-3.3-70b-versatile",
        "vision_model": "llama-3.2-11b-vision-preview",
    },
}

_PROVIDER = os.getenv("AI_PROVIDER", "together").lower()

# ── ELO-adaptive coaching bands ─────────────────────────────────────────────
# The single most-cited flaw in every competing AI chess coach (DecodeChess
# named explicitly) is using the same explanation style for a 400 and a 1900.
# These bands don't just change a label in the prompt — they change what's
# allowed to be said at all (numbers, jargon, which themes get surfaced).
_ELO_BAND_ORDER = ["beginner", "novice", "intermediate", "advanced", "expert"]

_ELO_BAND_DIRECTIVES = {
    "beginner": (
        "AUDIENCE: an absolute beginner (under ~800 Elo, possibly weeks into learning chess).\n"
        "- NEVER use centipawn numbers or +/- evaluations. Describe advantage only in plain terms: "
        "'much better for you', 'about equal', 'risky', 'losing'.\n"
        "- Only discuss HANGING PIECES, missed FREE CAPTURES, and missed CHECKMATES. "
        "Do not discuss pawn structure, prophylaxis, or long-term positional ideas — it's noise at this level.\n"
        "- The first time you use any chess term (fork, pin, skewer, discovered attack, back rank), "
        "define it in the same sentence in plain words, e.g. 'a fork (one piece attacking two of yours at once)'.\n"
        "- Keep every explanation to 1 short sentence. No compound reasoning chains.\n"
        "- Warm, encouraging tone. Never use words like 'blunder' or '??' — say 'this move loses a piece' instead."
    ),
    "novice": (
        "AUDIENCE: a novice player (roughly 800-1200 Elo) who knows the rules and basic tactics.\n"
        "- You may mention the evaluation changed, but always translate it to plain language alongside any number.\n"
        "- Focus almost entirely on TACTICS: hanging pieces, one- and two-move combinations, basic mating patterns. "
        "Positional ideas (pawn structure, piece coordination) should only get a passing one-clause mention, never the focus.\n"
        "- Opening advice must be principle-based ('develop before you attack', 'castle early'), never memorized theory lines.\n"
        "- 1-2 sentences per explanation, plain vocabulary, define any tactical term used."
    ),
    "intermediate": (
        "AUDIENCE: an intermediate player (roughly 1200-1600 Elo) with solid tactics and developing positional sense.\n"
        "- Full detail is fine: centipawn context, multi-move plans, positional themes (weak squares, pawn structure, "
        "piece activity) alongside tactics.\n"
        "- Point out opening deviations from known theory and why the book move mattered.\n"
        "- 2-3 sentences per explanation is appropriate."
    ),
    "advanced": (
        "AUDIENCE: an advanced club player (roughly 1600-2000 Elo).\n"
        "- Explain the PLAN behind a move, not just its immediate tactical point — what does it prepare?\n"
        "- Distinguish the engine's mathematically-best move from what's practically easiest for a human to convert "
        "when they differ; note when a suggested line requires precise only-moves to work.\n"
        "- Endgame technique deserves real depth here, not just 'you're up material'.\n"
        "- Assume fluency with standard terminology — no need to define common terms."
    ),
    "expert": (
        "AUDIENCE: an expert/near-master player (2000+ Elo).\n"
        "- Minimal hand-holding. Big blunders are rare at this level — focus on the SUBTLE inaccuracies "
        "(10-30 centipawns) a strong player would otherwise miss, and precise technical detail.\n"
        "- Terse, precise, technically dense. Skip encouragement and framing — get straight to the chess content.\n"
        "- Reference concrete lines and only-moves without over-explaining."
    ),
}


def elo_band(estimated_elo: Optional[int]) -> str:
    """Map a rating to one of the 5 coaching bands. Defaults to intermediate
    when unknown, which is the least presumptuous middle ground."""
    if estimated_elo is None:
        return "intermediate"
    if estimated_elo < 800:
        return "beginner"
    if estimated_elo < 1200:
        return "novice"
    if estimated_elo < 1600:
        return "intermediate"
    if estimated_elo < 2000:
        return "advanced"
    return "expert"


def _band_directives(estimated_elo: Optional[int]) -> str:
    return _ELO_BAND_DIRECTIVES[elo_band(estimated_elo)]


class AIService:
    """LLM-only service. Provider is selected via the AI_PROVIDER env var.
    All providers use the OpenAI chat-completions interface (openai Python SDK).
    """

    def __init__(self):
        cfg = _PROVIDER_CONFIG.get(_PROVIDER)
        if not cfg:
            logger.warning("Unknown AI_PROVIDER '%s' — falling back to openai.", _PROVIDER)
            cfg = _PROVIDER_CONFIG["openai"]

        if not cfg["api_key"]:
            logger.warning(
                "No API key found for provider '%s'. "
                "Set the corresponding env var (e.g. OPENAI_API_KEY).", _PROVIDER
            )
            self.model_available = False
            self.client = None
            self.model_name = cfg["model"]
            return

        try:
            from openai import OpenAI
            client_kwargs = {"api_key": cfg["api_key"]}
            if cfg["base_url"]:
                client_kwargs["base_url"] = cfg["base_url"]
            self.client      = OpenAI(**client_kwargs)
            self.model_name  = cfg["model"]
            self.model_available = True
            logger.info("AIService: provider=%s  model=%s", _PROVIDER, self.model_name)

            # ── Vision client (for handwritten notation OCR) ──────────────
            # Priority: OpenAI (gpt-4o-mini) → Groq (free) → current provider.
            openai_key = os.getenv("OPENAI_API_KEY")
            groq_key   = os.getenv("GROQ_API_KEY")
            if openai_key:
                self.vision_client = OpenAI(api_key=openai_key)
                self.vision_model  = "gpt-4o"
                logger.info("AIService: vision via OpenAI gpt-4o")
            elif groq_key:
                self.vision_client = OpenAI(
                    api_key=groq_key,
                    base_url="https://api.groq.com/openai/v1",
                )
                self.vision_model = "llama-3.2-11b-vision-preview"
                logger.info("AIService: vision via Groq llama-3.2-11b-vision-preview")
            else:
                v_model = cfg.get("vision_model")
                if v_model:
                    self.vision_client = self.client
                    self.vision_model  = v_model
                    logger.info("AIService: vision via %s  model=%s", _PROVIDER, v_model)
                else:
                    self.vision_client = None
                    self.vision_model  = None
                    logger.info("AIService: no vision model available")

        except Exception as e:
            logger.warning("AIService init failed for provider '%s': %s", _PROVIDER, e)
            self.model_available = False
            self.client        = None
            self.model_name    = cfg["model"]
            self.vision_client = None
            self.vision_model  = None

    # ── Internal helpers ──────────────────────────────────────────────────

    def _format_engine_context(self, moves_data: list, player_color: str) -> str:
        """Summarise Stockfish findings for the LLM prompt."""
        player_cap = player_color.capitalize()
        critical = [m for m in moves_data
                    if any(k in m["classification"] for k in ("Blunder", "Mistake", "Strong"))]
        turning = sorted(moves_data, key=lambda x: abs(x["cp_loss"]), reverse=True)[:5]
        turning = sorted(turning, key=lambda x: x["move_number"])

        # Phase breakdown for improvement-plan section
        opening_errors    = [m for m in critical if m["move_number"] <= 15]
        middlegame_errors = [m for m in critical if 16 <= m["move_number"] <= 35]
        endgame_errors    = [m for m in critical if m["move_number"] > 35]

        lines = [
            "=== STOCKFISH ENGINE ANALYSIS ===",
            f"Player being coached: {player_cap}\n",
            "--- CRITICAL MOVES (by engine classification) ---",
        ]
        for m in critical:
            phase = ("Opening" if m["move_number"] <= 15
                     else "Middlegame" if m["move_number"] <= 35
                     else "Endgame")
            lines.append(
                f"Move {m['move_number']} [{phase}] ({m['color']}): {m['move_san']} "
                f"[{m['classification']}] | Best: {m['best_move_san']} | "
                f"CP loss: {m['cp_loss']} | Eval: {m['score_before']} → {m['score_after']}"
            )

        lines.append("\n--- TOP 5 TURNING POINTS ---")
        for m in turning:
            lines.append(
                f"Move {m['move_number']} ({m['color']}): {m['move_san']} | "
                f"Swing: {abs(m['cp_loss'])} cp | "
                f"Eval: {m['score_before']} → {m['score_after']}"
            )

        lines.append("\n--- ERROR PHASE SUMMARY ---")
        lines.append(f"Opening errors  (moves 1-15):  {len(opening_errors)} critical move(s)")
        lines.append(f"Middlegame errors (moves 16-35): {len(middlegame_errors)} critical move(s)")
        lines.append(f"Endgame errors  (moves 36+):   {len(endgame_errors)} critical move(s)")
        weakest = max(
            [("Opening", len(opening_errors)),
             ("Middlegame", len(middlegame_errors)),
             ("Endgame", len(endgame_errors))],
            key=lambda x: x[1]
        )[0]
        lines.append(f"Weakest phase: {weakest}")
        return "\n".join(lines)

    # ── Public API ────────────────────────────────────────────────────────

    def analyze_game(
        self,
        pgn_text: str,
        moves_data: list,
        player_color: str = "white",
        player_name: Optional[str] = None,
        estimated_elo: Optional[int] = None,
    ) -> str:
        if not self.model_available:
            return "AI model not available."
        if not moves_data:
            return "No engine data available — Stockfish analysis required for coaching report."

        try:
            engine_context = self._format_engine_context(moves_data, player_color)
            player_cap = player_color.capitalize()
            coached = f"{player_name} ({player_cap})" if player_name else player_cap
            band = elo_band(estimated_elo)
            directives = _band_directives(estimated_elo)

            prompt = f"""You are the world's best chess coach — a grandmaster who has trained world champions. A student just played this game and needs your detailed, actionable coaching report. Return ONLY a valid JSON object (no markdown fences, no text before or after).

{directives}
Apply these AUDIENCE rules to every text field below — "note", "assessment", "what_happened", "best_explanation", "principle", "detail", "why", "coach_note", etc. all need to match this player's level ({band}), not a generic advanced-player voice.

GAME PGN:
{pgn_text}

Player being coached: {coached}

ENGINE DATA (ground truth — never invent evaluations not present here):
{engine_context}

Return this exact JSON (all fields required):
{{
  "verdict": "One punchy sentence — the game's defining characteristic (max 12 words)",
  "game_type": "Tactical | Positional | Mixed",
  "phase_grades": {{
    "opening":    {{ "grade": "A|B|C|D", "note": "One sentence on opening phase quality" }},
    "middlegame": {{ "grade": "A|B|C|D", "note": "One sentence on middlegame phase quality" }},
    "endgame":    {{ "grade": "A|B|C|D|N/A", "note": "One sentence or 'Game decided before endgame'" }}
  }},
  "opening": {{
    "name": "Full opening name",
    "eco": "ECO code",
    "assessment": "2 sentences on development, centre control, and king safety",
    "deviation": {{ "move_num": 3, "san": "Bc4", "note": "One sentence on significance of deviation" }},
    "resources": [
      {{ "type": "book", "title": "Book title", "author": "Author", "chapter": "Specific chapter/module" }},
      {{ "type": "drill", "platform": "Lichess or Chessable", "topic": "Specific opening line to drill", "time": "e.g. 15 min/day" }}
    ]
  }},
  "key_moments": [
    {{
      "move_num": 8,
      "san": "Nh4",
      "side": "{player_cap}",
      "label": "Evocative title, 4-5 words",
      "classification": "Mistake",
      "cp_loss": 120,
      "best": "Ke1",
      "principle": "The chess principle violated or demonstrated — e.g. 'Knights on the rim are dim'",
      "what_happened": "1-2 sentences: the concrete problem this move created",
      "best_explanation": "1-2 sentences: why the best move was superior and what it achieves"
    }}
  ],
  "tactical_patterns": [
    {{ "name": "Pattern name e.g. 'Piece Sacrifice for Initiative'", "description": "1 sentence on how this appeared in the game" }}
  ],
  "strengths": [
    {{ "title": "Short title e.g. 'Attacking Vision'", "detail": "1-2 sentences with specific move references" }}
  ],
  "weaknesses": [
    {{ "title": "Short title e.g. 'King Safety'", "detail": "1-2 sentences with specific move references" }}
  ],
  "study_plan": {{
    "priority_phase": "Opening | Middlegame | Endgame",
    "items": [
      {{ "type": "book", "title": "Exact book title", "author": "Author name", "chapter": "Specific chapter", "why": "One sentence connecting this to errors in this game" }},
      {{ "type": "puzzles", "platform": "Lichess", "theme": "Specific puzzle theme", "daily_count": 20, "target_accuracy": "80%", "why": "One sentence connecting to errors in this game" }},
      {{ "type": "practice", "description": "Specific practice activity", "frequency": "e.g. 3 games/week", "how": "Step-by-step instruction" }}
    ],
    "daily_routine": "Concrete daily schedule in minutes: e.g. 15 min theory + 15 min puzzles + 10 min game review",
    "four_week_goal": "Concrete measurable milestone"
  }},
  "checklist": [
    "Question tailored to error pattern #1 from this game",
    "Question tailored to error pattern #2",
    "Question tailored to error pattern #3"
  ],
  "priorities": [
    {{ "rank": 1, "title": "Most impactful focus area", "action": "Specific concrete action step" }},
    {{ "rank": 2, "title": "Second priority", "action": "Specific concrete action step" }},
    {{ "rank": 3, "title": "Third priority", "action": "Specific concrete action step" }}
  ],
  "coach_note": "One genuine, specific, encouraging sentence referencing something you actually saw in this game"
}}

Requirements:
- key_moments: 3-5 items from ENGINE DATA ordered by move_num
- tactical_patterns: 2-3 patterns actually present in the game
- strengths/weaknesses: 2-3 items each with specific move references
- study_plan.items: exactly 3 items (1 book, 1 puzzles, 1 practice)
- checklist: exactly 3 questions customized to THIS player's mistake patterns
- All move references must exist in ENGINE DATA
- Return valid JSON only — no extra text"""

            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=2048,
                temperature=0.0,
                seed=42,
            )
            raw = response.choices[0].message.content.strip()
            # Strip markdown fences if model wraps it anyway
            raw = re.sub(r'^```json?\s*', '', raw)
            raw = re.sub(r'\s*```$', '', raw)
            # Validate it's real JSON before returning
            import json as _json
            _json.loads(raw)
            return raw

        except Exception as e:
            logger.error("Error in AI game analysis: %s", e)
            return f"Error generating coaching report: {e}"

    # ── Position-specific explanation ─────────────────────────────────────

    def explain_position(
        self,
        fen: str,
        played_move: str,
        best_move: str,
        phase: str = "Middlegame",
        position_context: str = "equal",
        cp_loss: int = 0,
        player_color: str = "white",
        estimated_elo: Optional[int] = None,
        clock_remaining: Optional[float] = None,
        player_reasoning: Optional[str] = None,
    ) -> dict:
        """Return position-specific explanation: why the played move is bad, why the best move is good.

        `player_reasoning`, when provided, is the player's own guess at why the
        best move works, captured BEFORE they see this explanation ("ask before
        telling") — the response then includes a `reasoning_feedback` field
        assessing it, instead of just handing over the answer cold.
        """
        if not self.model_available:
            return {
                "why_bad": "AI unavailable.",
                "why_good": "AI unavailable.",
                "theme": "Unknown",
                "elo_note": "",
                "reasoning_feedback": None,
            }

        band = elo_band(estimated_elo)
        elo_tag = f"~{estimated_elo} ELO ({band})" if estimated_elo else f"an unrated ({band}-assumed)"
        directives = _band_directives(estimated_elo)
        time_note = ""
        if clock_remaining is not None and clock_remaining < 30:
            time_note = (
                f"\nIMPORTANT CONTEXT: the player had only {clock_remaining:.0f} seconds left on the clock "
                "when they made this move. Treat this primarily as a time-pressure error, not a calculation "
                "gap — say so explicitly, and don't scold a rushed decision as harshly as a slow blunder."
            )
        prompt = f"""You are a grandmaster chess coach explaining a specific position to a {elo_tag} player.

{directives}

FEN (position BEFORE the player's move): {fen}
Player is: {player_color}
Game phase: {phase}
Position evaluation: {position_context} position
{time_note}
The player played:   {played_move}  (this was a {cp_loss}-centipawn error)
The engine suggests: {best_move}
{f'''
The player was asked to guess WHY {best_move} is strong before being told the answer. Their guess was:
"{player_reasoning}"
Assess this guess in the "reasoning_feedback" field: say plainly whether they identified the right idea, a partially right idea, or missed it, and briefly note what they got right or overlooked. Be encouraging but honest — do not just say "close enough" if the core idea was wrong.''' if player_reasoning else ''}

Return ONLY valid JSON — no markdown fences, no extra text:
{{
  "why_bad": "Follow the AUDIENCE rules above for length/vocabulary. Be SPECIFIC to this position — name the exact piece, square, or weakness. For example: 'This move allows Rxd7, winning the rook on d7.' or 'After Nf5, the knight on e4 becomes undefended.' Do NOT write generic chess advice.",
  "why_good": "Follow the AUDIENCE rules above for length/vocabulary. Be SPECIFIC about what {best_move} achieves in THIS position. Name the resulting threat, square control, or material gain. For example: 'Nd4 threatens both Nxf5 and Nxb5, winning material in either case.' Do NOT write generic chess advice.",
  "theme": "The primary chess concept — choose ONE of: Tactics: Fork, Tactics: Pin, Tactics: Skewer, Tactics: Discovered Attack, Tactics: Back Rank, Tactics: Deflection, Tactics: Overloading, King Safety, Piece Activity, Pawn Structure, Endgame: Opposition, Endgame: Promotion, Endgame: Rook Technique, Opening Development, Prophylaxis, Coordination, Calculation Error.",
  "elo_note": "One short sentence — the key lesson to remember, phrased at the AUDIENCE level above."{f''',
  "reasoning_feedback": "Assessment of the player's own guess (see above), 1-3 sentences, phrased at the AUDIENCE level."''' if player_reasoning else ''}
}}"""

        try:
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=512,
                temperature=0.1,
                seed=42,
            )
            raw = response.choices[0].message.content.strip()
            raw = re.sub(r'^```json?\s*', '', raw)
            raw = re.sub(r'\s*```$', '', raw)
            import json as _json
            parsed = _json.loads(raw)
            parsed.setdefault("reasoning_feedback", None)
            return parsed
        except Exception as e:
            logger.error("explain_position error: %s", e)
            return {
                "why_bad": f"Could not generate explanation: {e}",
                "why_good": f"Engine recommended {best_move}.",
                "theme": "Unknown",
                "elo_note": "",
                "reasoning_feedback": None,
            }

    # ── Conversational follow-up on a position ──────────────────────────────

    def chat_about_position(
        self,
        fen: str,
        played_move: str,
        best_move: str,
        history: list,
        estimated_elo: Optional[int] = None,
        player_color: str = "white",
    ) -> str:
        """Multi-turn follow-up after the initial why_bad/why_good explanation
        — lets a player ask 'why', 'what if I played X instead', etc. Grounded
        in the same position, ELO-band-adapted like explain_position.
        `history` is a list of {"role": "user"|"assistant", "content": str}.
        """
        if not self.model_available:
            return "AI unavailable."

        directives = _band_directives(estimated_elo)
        system_prompt = f"""You are a grandmaster chess coach in an ongoing conversation with a student about ONE specific chess position. Stay strictly grounded in this position — never invent moves or evaluations inconsistent with the FEN below.

{directives}

FEN: {fen}
Player to move: {player_color}
The played move was: {played_move}
The engine's recommended move was: {best_move}

Answer the student's questions about this position conversationally, in plain text (never JSON, never markdown fences). Keep answers to 2-4 sentences unless they explicitly ask for a longer line. If asked "what if I played X instead", first make sure X is a legal move from this FEN — if you're unsure a line is sound, say so plainly rather than inventing a confident-sounding wrong answer."""

        messages = [{"role": "system", "content": system_prompt}] + history[-10:]
        try:
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=messages,
                max_tokens=400,
                temperature=0.3,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error("chat_about_position error: %s", e)
            return f"Sorry, I couldn't process that: {e}"

    # ── Kid Mode analysis ─────────────────────────────────────────────────

    def analyze_game_kid_mode(
        self,
        pgn_text: str,
        moves_data: list,
        player_color: str = "white",
        player_name: Optional[str] = None,
    ) -> str:
        """
        Generate a kid-friendly (ages 7–14) coaching report.
        Same engine data as analyze_game(), completely different tone and structure.
        """
        if not self.model_available:
            return "AI model not available."
        if not moves_data:
            return "No engine data available — Stockfish analysis required."

        try:
            engine_context = self._format_engine_context(moves_data, player_color)
            player_cap = player_color.capitalize()
            name = player_name or "Chess Player"

            # Pull out simple stats for the prompt
            coached_moves = [m for m in moves_data if m["color"] == player_cap]
            blunders  = [m for m in coached_moves if "Blunder"     in m["classification"]]
            mistakes  = [m for m in coached_moves if "Mistake"     in m["classification"]]
            great     = [m for m in coached_moves if m["classification"] in ("Best", "Excellent")]
            total     = len(coached_moves)

            prompt = f"""You are an enthusiastic, encouraging chess coach talking directly to \
a young chess player aged 7–14. Your name is Coach Spark.

Your job: read the Stockfish engine data and write a fun, friendly report that:
- Uses SHORT sentences (max 15 words each)
- Uses SIMPLE words (no jargon — if you must use a chess term, immediately explain it)
- Uses LOTS of emojis to make it exciting
- Is ENCOURAGING — mistakes are learning moments, not failures
- Uses fun COMPARISONS (e.g. "Leaving your queen there is like leaving your superhero alone with no friends!")
- Speaks directly to {name} as "you"
- NEVER uses centipawns, evaluation numbers, or technical notation beyond move numbers
- References specific moves by number (e.g. "On move 5, you did something sneaky!")

GAME DATA:
Player coached: {name} playing {player_cap}
Total moves by {name}: {total}
Great moves (Best/Excellent): {len(great)}
Mistakes: {len(mistakes)}
Blunders: {len(blunders)}

ENGINE FINDINGS (use these facts, but explain them in kid-friendly language):
{engine_context}

PGN (for move reference):
{pgn_text}

---

Write the report using EXACTLY these 5 sections with these emoji headers:

## 🎮 YOUR GAME STORY
Tell the story of the game in 3-4 short sentences. Was it a battle? A quick win? \
A tough loss? Make it sound exciting. Don't use numbers — say things like \
"You started great!" or "The middle got tricky..."

## ⚡ OOPS MOMENTS — Let's Learn From Them!
For each blunder or mistake (use the ENGINE FINDINGS):
**Move [N] — [Fun nickname for this mistake, e.g. "The Sleepy Queen" or "The Forgotten Guard"]**
😬 What happened: [1 sentence, super simple — "You moved your rook but forgot your bishop was in danger!"]
🤔 Why it hurt: [1 fun analogy — "It's like passing the ball and not watching where you threw it!"]
✅ What to do instead: [1 sentence with the best move, explained simply]

If there are no blunders or mistakes, write: "WOW — no big mistakes! You played really carefully! 🏆"

## 🌟 YOUR AWESOME MOVES!
Pick 2-3 of the best moves from ENGINE FINDINGS (classification "Best" or "Excellent", \
or moves with zero cp loss). For each:
⭐ **Move [N]**: [Explain why it was great in 1-2 sentences with enthusiasm!]
If none are found, encourage {name} for trying hard and playing the whole game.

## 🏋️ PRACTICE TIME — Here's Your Homework!
Give exactly 3 simple, actionable practice tips based on the mistakes found. Each tip:
- Starts with an action verb
- Is 1-2 sentences
- Is something a kid can actually do (e.g. "Practice with puzzles", "Before every move, ask yourself...")
- Includes a fun emoji

## 🏆 COACH SPARK'S CHEER
2-3 sentences. Be genuine and specific. Find something real to praise. \
End with an exciting motivational line for their next game.
Use "I" as Coach Spark talking to {name}.

Coach Spark:"""

            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=2000,
                temperature=0.0,
                seed=42,
            )
            return response.choices[0].message.content

        except Exception as e:
            logger.error("Error in kid mode analysis: %s", e)
            return f"Error generating report: {e}"

    # ── Kid live move commentaries ────────────────────────────────────────

    def generate_kid_move_commentaries(
        self,
        moves_data: list,
        pgn_text: str,
        player_color: str,
    ) -> dict:
        """
        ONE API call that generates Coach Spark commentary for every critical move.

        Returns a dict keyed by 0-based half-move index (matching
        st.session_state.current_move_index).  Each value is a dict:
            {
              "emoji":       str,   # single big emoji
              "headline":    str,   # ≤ 8 words, punchy
              "what":        str,   # 1 short sentence — what happened
              "why":         str,   # 1-2 sentences — fun analogy (mistake) or praise (good)
              "better":      str,   # best move explained simply (mistakes only, else "")
              "followup":    str,   # what happens next — 1 sentence
              "kind":        str,   # "mistake" | "good"
            }

        Returns {} on failure (board commentary gracefully hidden).
        """
        if not self.model_available:
            return {}

        player_cap = player_color.capitalize()

        # Only comment on coached player's moves that are significant
        critical_indices = [
            i for i, m in enumerate(moves_data)
            if m["color"] == player_cap
            and any(k in m["classification"]
                    for k in ("Blunder", "Mistake", "Inaccuracy", "Excellent", "Best"))
        ]
        if not critical_indices:
            return {}

        # Build a detailed move list for the prompt — include engine numbers
        def _cp_to_piece(cp):
            cp = abs(cp)
            if cp >= 850: return "queen-level (≥8.5 pawns)"
            if cp >= 450: return "rook (≈5 pawns)"
            if cp >= 270: return "bishop/knight (≈3 pawns)"
            if cp >= 160: return "almost a knight (≈1.6 pawns)"
            if cp >= 80:  return "about a pawn"
            return "small (<1 pawn)"

        def _swing(sb, sa, is_white):
            if sb is None or sa is None: return "unknown"
            sb2 = sb if is_white else -sb
            sa2 = sa if is_white else -sa
            if sb2 > 150 and sa2 < -150: return "winning→losing"
            if sb2 > 150 and sa2 < 50:   return "winning→equal"
            if abs(sb2) < 100 and sa2 < -150: return "equal→losing"
            if abs(sb2) < 100 and sa2 < -50:  return "equal→slight disadvantage"
            if sa2 < -50: return "disadvantage got worse"
            return "slight"

        move_lines = []
        for i in critical_indices:
            m      = moves_data[i]
            cls    = m["classification"]
            kind   = "MISTAKE" if any(k in cls for k in ("Blunder", "Mistake", "Inaccuracy")) else "GOOD"
            phase  = ("Opening" if m["move_number"] <= 15
                      else "Middlegame" if m["move_number"] <= 35 else "Endgame")
            is_wh  = m["color"] == "White"
            loss_s = _cp_to_piece(m["cp_loss"])
            swing  = _swing(m.get("score_before"), m.get("score_after"), is_wh)
            top3   = ", ".join(t["san"] for t in (m.get("top_moves") or [])[:3])
            move_lines.append(
                f'index={i}  move={m["move_number"]}{"." if is_wh else "..."}{m["move_san"]}'
                f'  class={cls}  kind={kind}  phase={phase}'
                f'  played={m["move_san"]}  best={m["best_move_san"]}'
                f'  cp_loss={m["cp_loss"]} ({loss_s})'
                f'  position_swing={swing}'
                f'  top3_alternatives=[{top3}]'
            )

        prompt = f"""You are Coach Spark, a friendly and enthusiastic chess coach for kids aged 7-14.

For EACH move below, write a detailed commentary card in JSON.

WRITING RULES:
- Use simple words that a 10-year-old easily understands
- No raw chess jargon without a clear explanation (e.g. say "attacks the king" not just "gives check")
- For MISTAKE moves: explain SPECIFICALLY what went wrong using the engine data provided
  • "what": state the move and describe the position swing (e.g. "you were winning, now it's equal")
  • "why": use a vivid real-life analogy that matches the SIZE of the mistake (big mistake = big analogy, small = gentle)
  • "why" MUST also explain concretely what the opponent can now do because of this move
  • "better": explain what the best move does specifically — does it attack, defend, capture, give check? Why is it better?
  • "followup": describe the OPPONENT'S likely next move or plan in plain words (e.g. "Your opponent will grab your bishop on e5 and be up a whole piece!")
- For GOOD moves: celebrate with genuine enthusiasm and explain WHY this move is strong
- Sentences can be 15-20 words — be informative, not just one-liners

FIELD LENGTHS:
- headline: 6-10 words, punchy and specific to THIS move
- what: 1-2 sentences, include the position swing info
- why: 2-3 sentences — analogy + specific consequence for opponent
- better: 1-2 sentences for mistakes, "" for good moves
- followup: 1-2 sentences — what opponent will DO next specifically

Moves to comment on (for {player_cap}):
{chr(10).join(move_lines)}

PGN context (first 600 chars):
{pgn_text[:600]}

Respond with ONLY valid JSON — no markdown, no extra text:
{{
  "<index>": {{
    "emoji": "<one emoji matching severity>",
    "headline": "<6-10 words specific to this move>",
    "what": "<1-2 sentences: what move + position consequence>",
    "why": "<2-3 sentences: analogy + what opponent can do now>",
    "better": "<1-2 sentences explaining best move concretely, or empty string>",
    "followup": "<1-2 sentences: opponent's specific next plan>",
    "kind": "<mistake or good>"
  }},
  ...
}}"""

        try:
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=1800,
                temperature=0.0,
                seed=42,
            )
            raw = response.choices[0].message.content.strip()

            # Strip accidental markdown fences
            if raw.startswith("```"):
                raw = re.sub(r"^```[a-z]*\n?", "", raw)
                raw = re.sub(r"\n?```$", "", raw)

            import json as _json
            parsed = _json.loads(raw)
            # Convert string keys to int keys
            return {int(k): v for k, v in parsed.items()
                    if isinstance(v, dict) and "headline" in v}

        except Exception as e:
            logger.warning("Kid move commentary generation failed: %s", e)
            return {}

    # ── Handwritten Notation OCR ──────────────────────────────────────────

    @staticmethod
    def _preprocess_notation_image(image_bytes: bytes) -> tuple[bytes, str]:
        """
        Enhance image for OCR: grayscale → contrast boost → sharpen.
        Returns (processed_bytes, mime_type).  Falls back to original if Pillow
        is not installed.
        """
        try:
            from PIL import Image, ImageEnhance, ImageFilter
            import io
            img = Image.open(io.BytesIO(image_bytes)).convert("L")   # grayscale
            img = ImageEnhance.Contrast(img).enhance(2.0)             # boost contrast
            img = ImageEnhance.Sharpness(img).enhance(2.0)            # sharpen edges
            img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=92)
            return buf.getvalue(), "image/jpeg"
        except Exception:
            return image_bytes, "image/jpeg"

    def _vision_call(self, b64: str, mime: str, prompt: str,
                     max_tokens: int = 800) -> str:
        """Single vision API call — returns raw response text."""
        response = self.vision_client.chat.completions.create(
            model=self.vision_model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url",
                     "image_url": {"url": f"data:{mime};base64,{b64}"}},
                    {"type": "text", "text": prompt},
                ],
            }],
            max_tokens=max_tokens,
            temperature=0.0,
        )
        return response.choices[0].message.content.strip()

    def transcribe_notation_image(self, image_bytes: bytes,
                                  mime_type: str = "image/jpeg") -> dict:
        """
        Two-pass pipeline for handwritten chess notation OCR.

        Pass 1 — raw transcription: ask the vision model to read every
                  character row by row without interpreting.
        Pass 2 — interpretation: ask the text model to convert the raw
                  transcript into valid SAN moves + JSON.

        Returns {"pgn", "move_count", "notes", "has_errors"} or {"error"}.
        """
        import base64
        import json as _json

        if not self.vision_client or not self.vision_model:
            return {"error": "Vision model not configured. Add OPENAI_API_KEY to .env."}

        # ── Pre-process image ─────────────────────────────────────────────
        img_bytes, mime_type = self._preprocess_notation_image(image_bytes)
        if mime_type in ("image/heic", "image/heif"):
            mime_type = "image/jpeg"
        b64 = base64.b64encode(img_bytes).decode("utf-8")

        # ════════════════════════════════════════════════════════════════
        # PASS 1 — Vision model: transcribe exactly what is written
        # ════════════════════════════════════════════════════════════════
        pass1_prompt = """\
This image contains handwritten chess moves on a scoresheet or paper.

Your ONLY job right now is to READ and COPY the text exactly as written — \
do NOT interpret or convert anything yet.

A chess scoresheet has rows like this:
  1  e4       e5
  2  Nf3      Nc6
  3  Bb5      a6

Read EVERY row from top to bottom. For each row output:
  <number> | <left column text> | <right column text>

If a column is empty or the game ended, write "-" for that column.
If you see player names, date, or result written anywhere, add a final line:
  META | white=<name> | black=<name> | date=<date> | result=<result>

Output ONLY this table — no explanations, no JSON, no chess analysis."""

        try:
            raw_transcript = self._vision_call(b64, mime_type, pass1_prompt,
                                               max_tokens=800)
            logger.info("Notation OCR pass1 transcript:\n%s", raw_transcript)
        except Exception as e:
            logger.warning("transcribe_notation_image pass1 failed: %s", e)
            return {"error": f"Could not read the photo: {e}"}

        # ════════════════════════════════════════════════════════════════
        # PASS 2 — Text model: interpret transcript → SAN + JSON
        # ════════════════════════════════════════════════════════════════
        pass2_prompt = f"""\
You are a chess notation expert. Below is a raw row-by-row transcript of a \
handwritten chess scoresheet.  Convert it into valid Standard Algebraic \
Notation (SAN) moves.

RAW TRANSCRIPT:
{raw_transcript}

CONVERSION RULES:
- Each row is one full move: left column = White, right column = Black
- Piece letters: K=King  Q=Queen  R=Rook  B=Bishop  N=Knight  pawn=no letter
- "0-0" or "O-O" = kingside castle → output as "O-O"
- "0-0-0" or "O-O-O" = queenside castle → output as "O-O-O"
- "x" or "×" = capture (keep it)
- "+" = check, "#" = checkmate (keep them)
- Descriptive notation like "P-K4" → "e4", "N-KB3" → "Nf3", "B×N" → "Bxg5" etc.
- If a move is crossed out, use the corrected version
- If Black's last move is missing (game ended on White's move), that's fine
- Do NOT invent moves — only convert what is in the transcript
- If a move is truly unreadable, use "?" as a placeholder and mention it in notes

Respond with ONLY valid JSON:
{{
  "moves": ["e4", "e5", "Nf3", "Nc6"],
  "result": "*",
  "white_name": "",
  "black_name": "",
  "date": "",
  "notes": "Move 7 Black was illegible — marked as ?"
}}

"moves" must be a flat list: White move 1, Black move 1, White move 2, …
"result": "1-0" | "0-1" | "1/2-1/2" | "*"
"""

        try:
            # Use the text model for pass 2 — it's better at structured reasoning
            p2_response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": pass2_prompt}],
                max_tokens=1000,
                temperature=0.0,
            )
            raw2 = p2_response.choices[0].message.content.strip()
            if raw2.startswith("```"):
                raw2 = re.sub(r"^```[a-z]*\n?", "", raw2)
                raw2 = re.sub(r"\n?```$", "", raw2)

            parsed = _json.loads(raw2)
        except _json.JSONDecodeError:
            return {"error": "Could not parse moves. Please try a clearer photo."}
        except Exception as e:
            logger.warning("transcribe_notation_image pass2 failed: %s", e)
            return {"error": f"Move interpretation failed: {e}"}

        moves = [str(m).strip() for m in parsed.get("moves", []) if str(m).strip()]
        if not moves:
            return {"error": "No chess moves found. Try a clearer, well-lit photo."}

        # ── Validate with python-chess (tolerant — process ALL moves) ───
        import chess as _chess
        import random as _random

        def _try_fix(san, board):
            # fix 1: castling written with zeros
            fixed = san.replace("0-0-0", "O-O-O").replace("0-0", "O-O")
            try:
                m = board.parse_san(fixed)
                return fixed, m
            except Exception:
                pass
            # fix 2: strip trailing check/mate symbols
            stripped = san.rstrip("+#")
            try:
                m = board.parse_san(stripped)
                return stripped, m
            except Exception:
                pass
            return None, None

        board           = _chess.Board()
        moves_annotated = []
        bad_moves       = []

        for i, san in enumerate(moves):
            move_num = i // 2 + 1
            side     = "White" if i % 2 == 0 else "Black"

            parsed_move = None
            used_san    = san

            if san == "?":
                # Explicitly unreadable — mark bad immediately
                bad_moves.append((move_num, san, side))
                moves_annotated.append({"san": san, "valid": False,
                                        "move_num": move_num, "side": side})
            else:
                # Try direct parse first
                try:
                    parsed_move = board.parse_san(san)
                except Exception:
                    # Try quick fixes
                    fixed_san, parsed_move = _try_fix(san, board)
                    if fixed_san is not None:
                        used_san = fixed_san

                if parsed_move is not None:
                    board.push(parsed_move)
                    moves_annotated.append({"san": used_san, "valid": True,
                                            "move_num": move_num, "side": side})
                else:
                    # Mark bad, push a random legal move to keep board state plausible
                    bad_moves.append((move_num, san, side))
                    moves_annotated.append({"san": san, "valid": False,
                                            "move_num": move_num, "side": side})
                    legal = list(board.legal_moves)
                    if legal:
                        board.push(_random.choice(legal))

        valid_count = sum(1 for m in moves_annotated if m["valid"])
        ai_notes    = parsed.get("notes", "") or ""
        warn_parts  = [
            f"⚠️ Move {mn} ({side}): '{s}' — check your notation and fix it below."
            for mn, s, side in bad_moves
        ]
        notes = "  ".join(filter(None, [ai_notes] + warn_parts))

        # ── Build PGN ─────────────────────────────────────────────────────
        result     = parsed.get("result", "*") or "*"
        white_name = parsed.get("white_name", "") or "?"
        black_name = parsed.get("black_name", "") or "?"
        date_str   = parsed.get("date", "")       or "????.??.??"

        pgn_lines = [
            '[Event "Handwritten Game"]',
            '[Site "?"]',
            f'[Date "{date_str}"]',
            f'[White "{white_name}"]',
            f'[Black "{black_name}"]',
            f'[Result "{result}"]',
            "",
        ]
        tokens = []
        for i, ann in enumerate(moves_annotated):
            display_san = ann["san"] if ann["valid"] else f"???{ann['san']}???"
            if i % 2 == 0:
                tokens.append(f"{i // 2 + 1}. {display_san}")
            else:
                tokens.append(display_san)
        if not bad_moves:
            tokens.append(result)
        pgn_lines.append(" ".join(tokens))

        return {
            "pgn":             "\n".join(pgn_lines),
            "move_count":      valid_count,
            "moves_annotated": moves_annotated,
            "notes":           notes,
            "has_errors":      bool(bad_moves),
        }

    # ── Player Profile ────────────────────────────────────────────────────

    def analyze_player_profile(
        self,
        stats_text: str,
        player_name: str,
    ) -> str:
        """
        Generate a comprehensive GM-coach-level player profile from pre-formatted
        aggregate statistics text (produced by player_profile.format_stats_for_prompt).
        """
        if not self.model_available:
            return "AI model not available — check GROQ_API_KEY."
        if not stats_text:
            return "No statistics provided."

        prompt = f"""You are a grandmaster chess coach writing a player profile report.

══════════════════════════════════════════════════════════════════════
RULE 0 — HIGHEST PRIORITY, OVERRIDES EVERYTHING:
The dossier below begins with an "AUTHORITATIVE COMPUTED FACTS" block.
These values were computed deterministically by the analysis engine.
You MUST:
  • Copy ELO, tier label, phase rankings, ELO milestones VERBATIM.
  • Use ONLY the resources listed in APPROVED RESOURCES — no others.
  • Use EXACTLY the weekly schedule provided — same days, same focus areas, same durations.
  • Use ONLY the phase targets listed (Phase 1 → X, Phase 2 → Y, Phase 3 → Z).
  • Never invent numbers not present in the dossier.
  • Never contradict or recompute anything in the AUTHORITATIVE COMPUTED FACTS block.
Your job is to write clear, insightful PROSE that explains and contextualises these facts —
not to discover or recompute them.
══════════════════════════════════════════════════════════════════════

PLAYER STATISTICS DOSSIER:
{stats_text}

---

Produce the following sections. Use headers exactly as shown. All numbers, ELO values, \
phase rankings, resource names, and schedule entries MUST come from the AUTHORITATIVE \
COMPUTED FACTS block — never invent or recalculate them. Your job is to write \
explanatory prose around the pre-computed facts, not to draw conclusions yourself.

---

### 1. PLAYER FINGERPRINT

Start with this exact line (fill in from AUTHORITATIVE COMPUTED FACTS):
**Estimated ELO: [ELO] ([source]) — [tier label]**

Then write 150-200 words describing this player's chess identity. Cite specific numbers \
from the dossier (win rate, error rates, phase breakdown). Describe playing style, \
strengths, and structural limitations. State which phase is weakest and which is strongest \
using the phase rankings from the AUTHORITATIVE COMPUTED FACTS block.

---

### 2. PERFORMANCE ANALYSIS

#### 2a. Colour Imbalance
Write 3-4 sentences explaining the COLOUR VERDICT from the facts block. Name the specific \
top openings from the dossier driving results. State what the imbalance means practically.

#### 2b. Conversion & The Elo Killer
Copy and state the CONVERSION VERDICT exactly. State the squander rate and the estimated \
Elo loss figure from the facts block. Explain in 3-4 sentences what this means. Name the \
move range where precision worst collapses (from MOVE-RANGE in facts block). Prescribe \
2 specific drills using only the APPROVED RESOURCES.

#### 2c. Game-Length Profile & Move-Range Accuracy
State the worst and best move ranges from the AUTHORITATIVE COMPUTED FACTS. Write \
3-4 sentences interpreting what the CP-loss curve shape means for this player's style.

#### 2d. Where Games Are Decided
State the blunder phase distribution numbers from the dossier. Identify the worst blunder \
phase. Cross-reference with blunders from winning positions.

---

### 3. OPENING REPERTOIRE DEEP DIVE

For each of the top 3 most-played openings from the dossier, use this format:

**[ECO Code] [Opening Name]** — [N] games, [Score]%, exit eval [from dossier]
VERDICT: [KEEP if score ≥55%, DEEPEN if score 40-55%, REPLACE if score <40%]
- Theory depth: [cite avg cp loss in theory zone from dossier]
- One sentence on style fit based on player's phase strengths/weaknesses
- Key improvement: [cite specific chapter from APPROVED RESOURCES — opening resource]

Do this for White openings and Black openings separately.

#### Repertoire Coherence
2-3 sentences on whether the repertoire is coherent. Name 2 openings at the next \
Elo level (+100) that this player should prepare for.

---

### 4. TACTICAL & ENDGAME ANALYSIS

CRITICAL: This section MUST reference specific games and move numbers from the WORST ERRORS list. \
Generic statements like "work on tactics" are NOT acceptable. Every claim must cite Game N, Move M.

#### 4a. Tactical Patterns — Recurring Weaknesses
Analyze the WORST ERRORS list and identify tactical motifs in the engine's recommended best moves. \
Use the FEN (board position before the move) and best_san to determine what tactical theme was missed.

For each theme that appears in the data, output ONE bullet per theme using EXACTLY this format:
- **[Theme Name]** (e.g. Fork, Pin, Skewer, Discovered Attack, Back-Rank, Knight Outpost, Zwischenzug): \
  Game [N], Move [M] — Played [san], but [best_san] achieves [brief tactical idea]. \
  Pattern gap: [one sentence on why this keeps being missed].

Only list themes that have evidence in the worst_moves data. Do not invent themes.

#### 4b. Missed Attacking Opportunities
From WORST ERRORS, list the 4-5 most instructive cases where the user missed a winning tactic \
on their own turn. Output ONE bullet per case using EXACTLY this format:
- **Game [N], Move [M] ([Phase], cp_loss=[N])**: Played [san] — [best_san] was available: \
  [explain the tactical idea: fork targeting X, pin along diagonal, capture gaining material, etc.].

Focus on Middlegame and Endgame entries. Use the actual san and best_san from the WORST ERRORS data.

#### 4c. Defensive Failures — Opponent Threats You Missed
From WORST ERRORS where pos_context = "winning" or "equal": list 3-4 cases where the played move \
created a vulnerability for the opponent to exploit. Output ONE bullet per case using EXACTLY this format:
- **Game [N], Move [M]**: From [winning/equal] position, played [san] — this [left a piece \
  undefended / created a weak back rank / surrendered the initiative / allowed a fork or pin]. \
  [best_san] would have defended by [specific idea].

Use only moves from the WORST ERRORS data where pos_context is "winning" or "equal".

#### 4d. Endgame Weaknesses by Type
From WORST ERRORS where Phase = "Endgame": identify the endgame categories involved. \
If fewer than 2 endgame errors exist, note that and briefly assess move-range 50+ accuracy instead.

For each endgame error, output ONE bullet using EXACTLY this format:
- **[Endgame Type]** (Rook+Pawn / K+P / Minor Piece / Queen / etc.): \
  Game [N], Move [M] — Played [san] when [best_san] was correct. \
  Missing technique: [opposition / Lucena / Philidor / promotion race / coordination / etc.]. \
  Study: [exact chapter/section from APPROVED RESOURCES endgame book].

#### 4e. Psychological Profile
Identify patterns in the conversion data (squander rate, winning position errors). \
Reference the APPROVED RESOURCES mental resource.

---

### 5. LONG-TERM CAREER DEVELOPMENT PLAN

Use EXACTLY these ELO targets from the AUTHORITATIVE COMPUTED FACTS — do not invent others:
- Phase 1 target: [phase1_elo] (Months 1–6)
- Phase 2 target: [phase2_elo] (Months 7–18)
- Phase 3 target: [phase3_elo] (Months 19–36)

#### PHASE 1: Foundation (Months 1–6)
- OBJECTIVE: Fix the weakest phase ([weakest phase from facts]) and reduce squander rate from [squander_rate]% toward 25%
- TACTICS: [Use tactics resource from APPROVED RESOURCES — name it exactly]
- ENDGAME: [Use endgame resource from APPROVED RESOURCES — name it exactly]
- OPENING: [Use opening resource from APPROVED RESOURCES — name it exactly]
- RATING TARGET: [phase1_elo from facts block]
- MILESTONE: Raise conversion rate from [conv_rate]% to 65% by converting 2 extra winning positions per 10 games
- Solve 20 tactical puzzles daily from approved tactics resource
- Review all blunders from [weakest phase] with engine after each game
- Play minimum 3 slow games per week (≥15+10 time control)

#### PHASE 2: Specialisation (Months 7–18)
- OBJECTIVE: Deepen Phase 1 gains; add one new strategic dimension from strategy resource
- STUDY: [Use games resource from APPROVED RESOURCES — name it exactly; explain relevance to this player's style]
- OPENING: Expand repertoire — prepare for 2 openings likely encountered at [phase2_elo]
- RATING TARGET: [phase2_elo from facts block]
- MILESTONE: Achieve clean game rate (zero blunders) above 50% consistently
- Enter minimum 1 rated tournament per month at current level
- Study 5 master games per week from approved games resource
- Add one new opening weapon as White or Black using approved opening resource

#### PHASE 3: Mastery (Months 19–36)
- OBJECTIVE: Consolidate repertoire; target consistent performance at [phase3_elo]
- MENTAL: Address conversion under pressure using [mental resource from APPROVED RESOURCES]
- OPENING: Prepare opening novelties using engine analysis in main repertoire lines
- RATING TARGET: [phase3_elo from facts block]
- MILESTONE: Sustain precision rate above [current precision_rate + 10]% across a 20-game stretch
- Analyse own games with engine weekly; maintain error log by phase
- Enter 4+ rated tournaments per year targeting [phase3_elo] section
- Study APPROVED RESOURCES master games collection in full

---

### 6. WEEKLY STUDY SCHEDULE

Use EXACTLY the weekly schedule from the AUTHORITATIVE COMPUTED FACTS — same days, \
same focus areas, same durations. For each day, add the specific resource name from \
APPROVED RESOURCES where relevant. Format as:

- [DAY] | [Focus Area] | [Activity from facts] | [Resource from APPROVED RESOURCES] | [Duration from facts]

---

### 7. RESOURCE LIBRARY

List ONLY resources from the APPROVED RESOURCES section of the AUTHORITATIVE COMPUTED FACTS. \
For each, write one sentence citing the specific stat from the dossier that makes it relevant.

#### TACTICS
- **[tactics resource]** — [cite specific blunder count or error rate]

#### ENDGAMES
- **[endgame resource]** — [cite move range 50+ data or endgame phase error rate]

#### OPENINGS
- **[opening resource]** — [cite avg cp loss in theory zone or opening score from dossier]

#### STRATEGY
- **[strategy resource]** — [cite specific strategic weakness from phase data]

#### MASTER GAMES
- **[games resource]** — [cite why this specific collection suits the player's style/openings]

#### MENTAL GAME
- **[mental resource]** — [cite squander rate or conversion data]

---

### 8. COACH'S VERDICT

Write 100-150 words directly to the player. Lead with genuine strengths (cite specific \
numbers). Name the single biggest ceiling risk using the squander rate or weakest phase \
data. Close with one specific measurable challenge.

---

Grandmaster Coach Analysis:"""

        try:
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=8000,
                temperature=0.0,
                seed=42,
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error("Error in player profile analysis: %s", e)
            return f"Error generating player profile: {e}"

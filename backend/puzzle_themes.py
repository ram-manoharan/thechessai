"""Mapping between app weakness themes and Lichess puzzle themes.

The Lichess puzzle DB uses 75 fine-grained theme tags per puzzle. Our app's
weakness categories come from chess_analysis.classify_tactical_theme(),
which only ever returns one of 9 exact strings ("Hanging Piece",
"Tactics: Fork", "Tactics: Pin", "Tactics: Back Rank",
"Tactics: Discovered Attack", "King Safety", "Endgame: Technique",
"Opening Development", "Positional") -- these are also what's stored in
app.mistake_event.tactical_theme, which is what callers of get_lichess_themes
actually pass in. THEME_MAP must be keyed on exactly those 9 strings or the
lookup silently misses (weakness-targeted puzzle selection matching almost
nothing was a real bug fixed here, not a hypothetical one).
"""

# Our 9 tactical_theme categories (from classify_tactical_theme) → Lichess theme tags
THEME_MAP: dict[str, list[str]] = {
    "Hanging Piece":              ["hangingPiece"],
    "Tactics: Fork":              ["fork"],
    "Tactics: Pin":               ["pin"],
    "Tactics: Back Rank":         ["backRankMate"],
    "Tactics: Discovered Attack": ["discoveredAttack", "discoveredCheck", "doubleCheck"],
    "King Safety":                ["exposedKing", "kingsideAttack", "queensideAttack", "attackingF2F7"],
    "Endgame: Technique":         [
        "endgame", "rookEndgame", "queenEndgame", "bishopEndgame",
        "knightEndgame", "pawnEndgame", "queenRookEndgame",
    ],
    "Opening Development":        ["opening"],
    # Positional is classify_tactical_theme()'s catch-all -- no single sharp
    # Lichess tag corresponds to it, so this maps to the closest fuzzy match.
    "Positional":                 ["middlegame", "advantage", "crushing"],
}

# Reverse: Lichess theme → our weakness category (first match wins)
_REVERSE: dict[str, str] = {}
for _cat, _tags in THEME_MAP.items():
    for _tag in _tags:
        _REVERSE.setdefault(_tag, _cat)


def get_lichess_themes(weakness: str) -> list[str]:
    """Return Lichess theme tags for a user weakness category."""
    return THEME_MAP.get(weakness, [weakness.lower().replace(" ", "")])


def weakness_from_lichess_theme(lichess_theme: str) -> str:
    """Best-guess our weakness category for a Lichess theme tag."""
    return _REVERSE.get(lichess_theme, "Tactical")


def puzzle_rating_range(estimated_elo: int) -> tuple[int, int]:
    """Map game ELO to an appropriate Lichess puzzle rating range.

    Lichess puzzle ratings run ~200-500 points above game ELO (Glicko-2
    calibrated against the puzzle pool, not against humans).  We use a
    conservative +300 offset with a ±275 window, then apply dynamic
    tightening: sessions where the user solves >80% push the center up;
    <40% push it down.  That session-level adjustment is done in the
    calling endpoint, not here.
    """
    offset = 300
    center = estimated_elo + offset
    lo = max(600, center - 275)
    hi = center + 375
    return (lo, hi)


# General-exploration Lichess themes — the 30% non-targeted pool
EXPLORATION_THEMES: list[str] = [
    "fork", "pin", "skewer", "discoveredAttack", "deflection",
    "attraction", "clearance", "sacrifice", "hangingPiece", "trappedPiece",
    "mate", "mateIn1", "mateIn2", "backRankMate",
    "endgame", "rookEndgame",
    "crushing", "advantage",
]

# Human-readable labels for the 75 Lichess themes shown post-solve
LICHESS_THEME_LABELS: dict[str, str] = {
    "fork":              "Fork — attacking two pieces at once",
    "pin":               "Pin — piece cannot move without exposing a more valuable piece",
    "skewer":            "Skewer — forcing a valuable piece to move, exposing one behind it",
    "discoveredAttack":  "Discovered attack — moving one piece reveals an attack by another",
    "discoveredCheck":   "Discovered check — a move reveals check from a piece behind",
    "doubleCheck":       "Double check — two pieces give check simultaneously",
    "deflection":        "Deflection — forcing an overloaded defender away from its duty",
    "attraction":        "Attraction — luring an enemy piece to a square where it can be exploited",
    "interference":      "Interference — blocking a defender's line",
    "clearance":         "Clearance — sacrificing to open a line or square for another piece",
    "capturingDefender": "Removing the defender — eliminating the piece protecting a key square",
    "xRayAttack":        "X-ray attack — attacking through an intervening piece",
    "zugzwang":          "Zugzwang — any move the opponent makes worsens their position",
    "intermezzo":        "Zwischenzug (Intermezzo) — an 'in-between' move that changes the sequence",
    "quietMove":         "Quiet move — a non-capture, non-check move that is decisive",
    "defensiveMove":     "Defensive resource — a precise defensive move that holds the position",
    "hangingPiece":      "Hanging piece — an undefended piece that can be captured for free",
    "trappedPiece":      "Trapped piece — a piece with no safe squares to move to",
    "sacrifice":         "Sacrifice — giving up material for a larger positional or tactical gain",
    "exposedKing":       "Exposed king — exploiting a vulnerable king position",
    "backRankMate":      "Back-rank mate — mating the king trapped on its starting rank",
    "smotheredMate":     "Smothered mate — knight delivers mate to a king hemmed in by its own pieces",
    "anastasiaMate":     "Anastasia's mate — rook + knight mating pattern",
    "arabianMate":       "Arabian mate — rook + knight on a corner",
    "bodenMate":         "Boden's mate — two bishops deliver criss-cross checkmate",
    "cornerMate":        "Corner mate — king trapped in the corner",
    "hookMate":          "Hook mate — rook, knight, and pawn combine on the edge",
    "morphysMate":       "Morphy's mate — bishop + rook battery delivering mate",
    "operaMate":         "Opera mate — bishop + rook (typically on open file)",
    "kingsideAttack":    "Kingside attack — attacking the castled king on the g/h files",
    "queensideAttack":   "Queenside attack — exploiting weaknesses on the a/b/c files",
    "attackingF2F7":     "f2/f7 weakness — exploiting the vulnerable f-pawn near the king",
    "advancedPawn":      "Advanced pawn — a passed pawn threatening promotion",
    "promotion":         "Promotion — queening a pawn as the decisive tactic",
    "underPromotion":    "Underpromotion — promoting to a minor piece for a key reason",
    "enPassant":         "En passant — the special pawn capture",
    "endgame":           "Endgame technique — precise play in a simplified position",
    "rookEndgame":       "Rook endgame — technical accuracy with rooks on the board",
    "queenEndgame":      "Queen endgame — precision with queens in a simplified position",
    "bishopEndgame":     "Bishop endgame — exploiting bishop color advantages",
    "knightEndgame":     "Knight endgame — maneuvering with knights in the final phase",
    "pawnEndgame":       "Pawn endgame — pure king and pawn calculation",
    "queenRookEndgame":  "Queen + rook endgame — coordinating these powerful pieces",
    "mate":              "Checkmate — delivering the winning blow",
    "mateIn1":           "Mate in 1 — a forced checkmate in a single move",
    "mateIn2":           "Mate in 2 — a forced checkmate sequence",
    "mateIn3":           "Mate in 3 — deeper forced checkmate",
    "mateIn4":           "Mate in 4 — long forced mate sequence",
    "mateIn5":           "Mate in 5 — deep mate calculation",
    "crushing":          "Crushing advantage — a move that wins decisive material",
    "advantage":         "Gaining advantage — a move that improves the position significantly",
    "sacrifice":         "Sacrifice — giving up material for a stronger position",
}

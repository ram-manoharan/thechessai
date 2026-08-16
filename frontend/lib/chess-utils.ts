import type { MoveData } from "./api";

// ── Pawn promotion ──────────────────────────────────────────────────────────

export const PROMOTION_PIECES = ["q", "r", "b", "n"] as const;
export type PromotionPiece = (typeof PROMOTION_PIECES)[number];
export const PROMOTION_GLYPH: Record<"w" | "b", Record<PromotionPiece, string>> = {
  w: { q: "♕", r: "♖", b: "♗", n: "♘" },
  b: { q: "♛", r: "♜", b: "♝", n: "♞" },
};
export const PROMOTION_LABEL: Record<PromotionPiece, string> = {
  q: "Queen", r: "Rook", b: "Bishop", n: "Knight",
};

// ── Alternate-move credit (puzzles/study) ──────────────────────────────────

/** Classifies a played move against a live top-3 Stockfish read of the
 * position: the #1 candidate is "best", #2/#3 are a "good alternate" worth
 * puzzle credit, anything else is "wrong". A live top-3 read already only
 * surfaces genuinely strong tries, so no extra cp-delta threshold is needed
 * beyond "is it in the top 3". */
export function classifyAttemptedMove(
  topMoves: { SAN: string }[],
  playedSan: string,
): "best" | "alternate" | "wrong" {
  const idx = topMoves.findIndex(m => m.SAN === playedSan);
  if (idx === 0) return "best";
  if (idx === 1 || idx === 2) return "alternate";
  return "wrong";
}

// ── Move quality config ────────────────────────────────────────────────────

export const CLF_CONFIG: Record<string, { badge: string; color: string; label: string }> = {
  "Brilliant":  { badge: "!!",  color: "var(--clr-brilliant)",  label: "Brilliant" },
  "Best":       { badge: "✓",   color: "var(--clr-best)",       label: "Best" },
  "Excellent":  { badge: "!",   color: "var(--clr-excellent)",  label: "Excellent" },
  "Good":       { badge: "",    color: "var(--clr-good)",       label: "Good" },
  "Inaccuracy": { badge: "?!",  color: "var(--clr-inaccuracy)", label: "Inaccuracy" },
  "Mistake":    { badge: "?",   color: "var(--clr-mistake)",    label: "Mistake" },
  "Blunder":    { badge: "??",  color: "var(--clr-blunder)",    label: "Blunder" },
  "Miss":       { badge: "??",  color: "var(--clr-miss)",       label: "Miss" },
};

export function clfConfig(clf: string) {
  for (const [key, val] of Object.entries(CLF_CONFIG)) {
    if (clf.includes(key)) return val;
  }
  return null;
}

// ── Accuracy computation (chess.com win-probability formula) ───────────────

export function computeAccuracy(movesData: MoveData[]): { white: number; black: number } {
  const byColor = (color: "White" | "Black") => {
    const moves = movesData.filter(m => m.color === color);
    if (!moves.length) return 100;
    const scores = moves.map(m => m.accuracy_score).filter(s => s != null);
    if (scores.length === moves.length) {
      return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10;
    }
    // fallback: fraction of non-error moves
    const good = moves.filter(m => ["Best","Excellent","Good","Accurate"].some(k => m.classification.includes(k))).length;
    return Math.round(good / moves.length * 1000) / 10;
  };
  return { white: byColor("White"), black: byColor("Black") };
}

// ── Move quality counts ────────────────────────────────────────────────────

export type QualityCounts = {
  brilliant: number; best: number; excellent: number; good: number;
  inaccuracy: number; mistake: number; blunder: number;
};

export function countQuality(movesData: MoveData[], color: "White" | "Black"): QualityCounts {
  const moves = movesData.filter(m => m.color === color);
  return {
    brilliant:  moves.filter(m => m.classification.includes("Brilliant")).length,
    best:       moves.filter(m => m.classification.includes("Best")).length,
    excellent:  moves.filter(m => m.classification.includes("Excellent") || m.classification.includes("Strong")).length,
    good:       moves.filter(m => m.classification.includes("Good") || m.classification.includes("Accurate")).length,
    inaccuracy: moves.filter(m => m.classification.includes("Inaccuracy")).length,
    mistake:    moves.filter(m => m.classification.includes("Mistake") && !m.classification.includes("Inaccuracy")).length,
    blunder:    moves.filter(m => m.classification.includes("Blunder") || m.classification.includes("Miss")).length,
  };
}

// ── Replay: opponent fingerprint + phase detection ──────────────────────────
//
// "Play it out from here" replays a position against a human-calibrated
// opponent (Maia, rating-matched) instead of a raw engine. Generic Maia
// plays like an average player at that rating; the fingerprint below makes
// it play more like THIS specific opponent by feeding their own per-phase
// error rate from the game just analyzed to the replay backend, which uses
// it to occasionally swap in a plausible-but-suboptimal move instead of
// Maia's pick. Mirrors backend/chess_analysis.py's _get_phase_by_material
// closely enough for this purpose (informing which error rate applies to
// the current replay position), without needing a round-trip to the server
// just to classify a phase.

export type PhaseErrorRates = Record<string, number>;

const MIN_SAMPLE_PER_PHASE = 3;

/** Per-phase (mistakes+blunders)/total for one side's moves in an already-
 * analyzed game. Phases with too few samples are omitted rather than
 * reported as a noisy 0% or 100% rate. */
export function computeOpponentFingerprint(
  movesData: MoveData[],
  opponentColor: "White" | "Black"
): PhaseErrorRates {
  const byPhase: Record<string, { total: number; errors: number }> = {};
  for (const m of movesData) {
    if (m.color !== opponentColor) continue;
    const phase = m.phase ?? "Middlegame";
    const bucket = byPhase[phase] ?? (byPhase[phase] = { total: 0, errors: 0 });
    bucket.total += 1;
    if (m.classification.includes("Blunder") || m.classification.includes("Mistake") || m.classification.includes("Miss")) {
      bucket.errors += 1;
    }
  }
  const rates: PhaseErrorRates = {};
  for (const [phase, { total, errors }] of Object.entries(byPhase)) {
    if (total >= MIN_SAMPLE_PER_PHASE) rates[phase] = errors / total;
  }
  return rates;
}

const PHASE_PIECE_VALUES: Record<string, number> = { q: 9, r: 5, b: 3, n: 3 };

/** Material-based phase estimate from a FEN alone — mirrors the backend's
 * move-number + material heuristic closely enough to pick the right
 * error-rate bucket during a live replay, without a server round trip. */
export function estimatePhase(fen: string): "Opening" | "Middlegame" | "Endgame" {
  const parts = fen.split(" ");
  const boardPart = parts[0] ?? "";
  const moveNumber = parseInt(parts[5] ?? "1", 10) || 1;
  if (moveNumber <= 10) return "Opening";

  let total = 0;
  let queens = 0;
  for (const ch of boardPart) {
    const lower = ch.toLowerCase();
    const val = PHASE_PIECE_VALUES[lower];
    if (val) {
      total += val;
      if (lower === "q") queens += 1;
    }
  }
  if (total <= 20 || (queens === 0 && total <= 30)) return "Endgame";
  if (moveNumber <= 15 && total >= 50) return "Opening";
  if (moveNumber > 35) return "Endgame";
  return "Middlegame";
}

// ── Eval helpers ──────────────────────────────────────────────────────────

/** Centipawns → 0-100 white advantage percentage (chess.com sigmoid). */
export function cpToWhitePct(cp: number | null): number {
  if (cp == null) return 50;
  if (cp >= 9000) return 98;
  if (cp <= -9000) return 2;
  return 100 / (1 + Math.exp(-0.00368208 * cp));
}

/** One-line plain-English definitions for the tactical/positional theme
 * taxonomy shared with the backend (ai_service.py explain_position /
 * chess_analysis.py classify_tactical_theme) — shown as a tooltip on the
 * theme badge so a beginner can hover an unfamiliar term instead of it just
 * being unexplained jargon. */
export const THEME_GLOSSARY: Record<string, string> = {
  "Tactics: Fork":               "One piece attacks two (or more) of your opponent's pieces at the same time.",
  "Tactics: Pin":                 "A piece can't move without exposing a more valuable piece behind it to attack.",
  "Tactics: Skewer":              "Like a pin, but the more valuable piece is in front and forced to move, losing the piece behind it.",
  "Tactics: Discovered Attack":  "Moving one piece out of the way reveals an attack from another piece behind it.",
  "Tactics: Back Rank":           "The king is trapped on the home row by its own pawns, vulnerable to a rook or queen check.",
  "Tactics: Deflection":          "Forcing a defending piece away from the square or piece it was protecting.",
  "Tactics: Overloading":         "A piece is defending two things at once and can't do both if attacked correctly.",
  "Hanging Piece":                "A piece is left where it can simply be captured for free.",
  "King Safety":                  "The king's position is exposed or under threat, independent of any single tactic.",
  "Piece Activity":               "How much influence a piece has on the board — active pieces control more squares.",
  "Pawn Structure":               "The shape formed by the pawns, which affects piece mobility and endgame chances long-term.",
  "Endgame: Opposition":          "Kings face off with one square between them — who has to move first matters.",
  "Endgame: Promotion":           "Advancing a pawn toward the far rank to turn it into a queen (or other piece).",
  "Endgame: Rook Technique":      "Standard rook-endgame technique — cutting off the king, active rook placement.",
  "Endgame: Technique":           "General precise technique needed to convert or hold an endgame.",
  "Opening Development":          "Getting your pieces off their starting squares and into the game quickly.",
  "Prophylaxis":                  "A move made to prevent an opponent's plan before it happens, not to create a threat.",
  "Coordination":                 "How well your pieces work together toward a shared goal.",
  "Calculation Error":            "A concrete line was miscalculated — the moves themselves, not a conceptual gap.",
  "Positional":                   "A longer-term strategic factor rather than an immediate tactic.",
};

/** Mirrors backend ai_service.py's elo_band() bands — used only to *display*
 * which coaching level is active, so the ELO-adaptive explanation feature
 * (ANALYSIS_STRATEGY.md phase 1) is visible rather than only inferable from
 * subtle prose-style differences. */
export function eloBandLabel(estimatedElo: number | null): string {
  if (estimatedElo == null) return "Intermediate (default)";
  if (estimatedElo < 800) return "Beginner";
  if (estimatedElo < 1200) return "Novice";
  if (estimatedElo < 1600) return "Intermediate";
  if (estimatedElo < 2000) return "Advanced";
  return "Expert";
}

/** Beginner-band eval display (ANALYSIS_STRATEGY.md section 4): no raw
 * centipawn numbers, qualitative only, from the player's own perspective.
 * `short` fits a narrow UI slot (the eval bar caption); `full` is the same
 * read spelled out, for a tooltip or wider status line. */
export function qualitativeEvalLabel(
  cp: number | null, playerColor: "white" | "black"
): { short: string; full: string } {
  if (cp == null) return { short: "Even", full: "About equal" };
  if (Math.abs(cp) >= 9000) {
    const winning = (cp > 0) === (playerColor === "white");
    return winning
      ? { short: "Win!", full: "You're winning — there's a forced checkmate coming" }
      : { short: "Lost", full: "You're losing — your opponent has a forced checkmate coming" };
  }
  const playerCp = playerColor === "white" ? cp : -cp;
  if (playerCp >= 300) return { short: "Great!", full: "Much better for you" };
  if (playerCp >= 80)  return { short: "Good",   full: "Better for you" };
  if (playerCp >= -80) return { short: "Even",   full: "About equal" };
  if (playerCp >= -300) return { short: "Tough",  full: "Worse for you" };
  return { short: "Rough", full: "Much worse for you" };
}

export function evalLabel(move: MoveData | null): string {
  if (!move) return "0.0";
  if (move.classification?.includes("Mate") || (move.score_after != null && Math.abs(move.score_after) >= 9000)) {
    const v = move.score_after ?? 0;
    return v > 0 ? "M" : "-M";
  }
  const cp = move.score_after ?? 0;
  return cp > 0 ? `+${(cp / 100).toFixed(1)}` : (cp / 100).toFixed(1);
}

// ── Accuracy colour ───────────────────────────────────────────────────────

export function accuracyColor(acc: number): string {
  if (acc >= 90) return "var(--clr-best)";
  if (acc >= 75) return "var(--clr-good)";
  if (acc >= 60) return "var(--clr-inaccuracy)";
  return "var(--clr-mistake)";
}

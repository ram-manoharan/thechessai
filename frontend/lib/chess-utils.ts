import type { MoveData } from "./api";

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

"use client";
import { useEffect, useRef, useState } from "react";

/** Well-verified, single-fact-per-line chess trivia -- shown one at a time
 * while a game is being analysed, purely to give a genuinely dead loading
 * moment (see MoveList/MiniStatsStrip, which render nothing until moves
 * arrive) something worth reading instead of a bare spinner. */
const TRIVIA: string[] = [
  "The number of possible chess games is so large it's estimated to exceed the number of atoms in the observable universe.",
  "“Checkmate” comes from the Persian shāh māt — “the king is helpless.”",
  "The queen wasn't always chess's most powerful piece — until the late 1400s she could only move one square at a time.",
  "In 1997, Deep Blue became the first computer to beat a reigning World Champion, Garry Kasparov, in a classical match.",
  "The longest official tournament game ever played lasted 269 moves — and still ended in a draw.",
  "Bobby Fischer became a grandmaster at 15 years old, a record at the time.",
  "Judit Polgár beat 11 different World Champions over her career and reached world No. 8 overall — still the highest ranking any woman has achieved.",
  "A knight standing in a corner of the board attacks only two squares — the fewest of any piece, anywhere.",
  "Castling is the only move in chess where a player moves two pieces at once.",
  "En passant has existed since the 15th century, added after pawns gained the option to move two squares on their first move.",
  "The Sicilian Defence is the most popular reply to 1.e4 at the top level of chess.",
  "Magnus Carlsen went 125 classical games without a loss between 2018 and 2020 — one of the longest unbeaten runs by a reigning World Champion.",
  "There are 400 possible positions after just one move each — 20 choices for White, 20 for Black.",
  "Scholar's mate can checkmate an undefended king in as few as four moves — the fastest “named” checkmate in chess.",
  "The bishop was called “the elephant” in many early forms of chess — you can still hear it in the Arabic name al-fil.",
  "The Immortal Game (1851) is one of the most famous ever played — Adolf Anderssen sacrificed both rooks, a bishop, and his queen just to deliver checkmate.",
  "A pawn that reaches the far side of the board can promote to a queen, rook, bishop, or knight — even if you already have one on the board.",
  "The World Chess Championship has been contested since 1886, making it one of the oldest continuously recognized titles in sport.",
  "The knight is the only piece on the board that can jump over other pieces.",
];

const TRIVIA_INTERVAL_MS = 4500;

const prefersReducedMotion = typeof window !== "undefined"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function useRotatingTrivia() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * TRIVIA.length));
  useEffect(() => {
    const id = setInterval(() => setIndex(i => (i + 1) % TRIVIA.length), TRIVIA_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
  return TRIVIA[index];
}

/** Time-based fallback progress -- eases toward ~88% and never quite gets
 * there, so it never looks "stuck" if real per-move progress never arrives
 * (e.g. the SSE fallback path, which has no per-move signal at all). Real
 * `current`/`total` from the job queue always takes over the moment it's
 * available, since it's an actual measurement rather than a guess. */
function useEstimatedPct(hasReal: boolean) {
  const [pct, setPct] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (hasReal) return;
    if (startRef.current === null) startRef.current = Date.now();
    const id = setInterval(() => {
      const elapsedSec = (Date.now() - startRef.current!) / 1000;
      setPct(88 * (1 - Math.exp(-elapsedSec / 12)));
    }, 250);
    return () => clearInterval(id);
  }, [hasReal]);
  return pct;
}

/** Fills the dead "Stockfish is thinking" gap on the Moves tab with an
 * actual percentage (real per-move progress when the job queue reports it,
 * a smooth time-based estimate otherwise) plus rotating chess trivia, so
 * there's always something moving and something worth reading. */
export function AnalysisProgress({ current, total }: { current?: number | null; total?: number | null }) {
  const trivia = useRotatingTrivia();
  const hasReal = typeof current === "number" && typeof total === "number" && total > 0;
  const estimatedPct = useEstimatedPct(hasReal);
  const pct = hasReal ? Math.min(100, (current! / total!) * 100) : estimatedPct;

  return (
    <div style={{ padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
      <div style={{ width: "100%", maxWidth: 340 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ color: "var(--text-secondary)", fontSize: 12.5, fontWeight: 600 }}>
            {hasReal ? `Evaluating move ${current} of ${total}…` : "Stockfish is evaluating your game…"}
          </span>
          <span style={{ color: "var(--gold)", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {Math.round(pct)}%
          </span>
        </div>
        <div style={{ background: "var(--bg-elevated)", borderRadius: 6, height: 6, overflow: "hidden" }}>
          <div
            style={{
              width: `${pct}%`, height: "100%", borderRadius: 6,
              background: "linear-gradient(90deg, var(--accent-blue), var(--gold))",
              transition: "width 0.4s ease",
            }}
          />
        </div>
      </div>

      <div
        key={trivia}
        style={{
          maxWidth: 380, textAlign: "center", padding: "16px 18px",
          background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 12,
          animation: prefersReducedMotion ? "none" : "analysis-trivia-fade 0.5s ease",
        }}
      >
        <p style={{ color: "var(--gold)", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>
          {"♦ Did you know"}
        </p>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
          {trivia}
        </p>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes analysis-trivia-fade {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}} />
    </div>
  );
}

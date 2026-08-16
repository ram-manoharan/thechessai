"use client";
import { useEffect, useState } from "react";
import { MockWindow } from "./MockWindow";
import { HeroChatDemo } from "./HeroChatDemo";

// Four small, independently-looping demos shown in parallel — not a single
// tabbed rotator like the old "See it in action" section. The point is to
// let the visuals carry the pitch: each card shows the actual mechanism
// (opponent-accurate replay, AI coach Q&A, dual profiling, alt-move-credit
// puzzles) running, rather than describing it in another paragraph.

const prefersReducedMotion = typeof window !== "undefined"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const PIECE_GLYPH: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

function parseBoard(rows: string[]): string[][] {
  return rows.map(row => row.split(""));
}

/** Small letter-grid board (uppercase = White, lowercase = Black, "." =
 * empty) — decorative only, not a real position. `rings` highlights squares
 * with a colored pulsing ring. */
function MiniBoard({
  rows, rings, size = 140,
}: {
  rows: string[][];
  rings?: Record<string, string>;
  size?: number;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(8, 1fr)",
        width: size,
        aspectRatio: "1 / 1",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid var(--border-strong)",
        boxShadow: "var(--shadow-md)",
        flexShrink: 0,
        margin: "0 auto",
      }}
    >
      {rows.map((row, r) =>
        row.map((cell, c) => {
          const isLight = (r + c) % 2 === 0;
          const square = `${FILES[c]}${8 - r}`;
          const ring = rings?.[square];
          return (
            <div
              key={square}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: isLight ? "var(--board-light)" : "var(--board-dark)",
                fontSize: "clamp(10px, 2.2vw, 16px)",
                lineHeight: 1,
                color: cell === cell.toUpperCase() ? "#f5f5f0" : "#1a1a1a",
                textShadow: cell === cell.toUpperCase()
                  ? "0 1px 1px rgba(0,0,0,0.55)"
                  : "0 1px 1px rgba(255,255,255,0.25)",
              }}
            >
              {ring && (
                <span
                  style={{
                    position: "absolute", inset: 1, borderRadius: 3,
                    border: `2px solid ${ring}`,
                    boxShadow: `0 0 8px ${ring}`,
                    animation: "capshow-square-pulse 1.5s ease-in-out infinite",
                  }}
                />
              )}
              {cell !== "." && PIECE_GLYPH[cell]}
            </div>
          );
        }),
      )}
    </div>
  );
}

/** Tiny helper matching HeroChatDemo's convention: a `cycle` counter in the
 * effect's dependency array re-runs the whole timer chain fresh each loop
 * instead of letting timers accumulate. */
function useLoop(steps: Array<[number, () => void]>, totalMs: number) {
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, fn: () => void) => {
      timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms));
    };
    steps.forEach(([ms, fn]) => after(ms, fn));
    after(totalMs, () => setCycle(c => c + 1));
    return () => { cancelled = true; timers.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle]);
}

// ── Card 1: Opponent-accurate replay ────────────────────────────────────────

const OPP_BEFORE = parseBoard([
  "r..q.rk.",
  "ppp..ppp",
  "..n..n..",
  "...pN...",
  "...P....",
  "..N.....",
  "PP..BPPP",
  "R..Q.RK.",
]);
const OPP_AFTER = parseBoard([
  "r..q.rk.",
  "ppp..ppp",
  "..n.....",
  "...pN...",
  "...P..n.",
  "..N.....",
  "PP..BPPP",
  "R..Q.RK.",
]);

type OppPhase = "before" | "after" | "result";

function OpponentCloneDemo() {
  const [phase, setPhase] = useState<OppPhase>(prefersReducedMotion ? "result" : "before");
  useLoop([
    [0, () => setPhase("before")],
    [1500, () => setPhase("after")],
    [1500 + 1700, () => setPhase("result")],
  ], 1500 + 1700 + 2300);

  const board = phase === "before" ? OPP_BEFORE : OPP_AFTER;
  const rings: Record<string, string> | undefined =
    phase === "before" ? { f6: "var(--gold)" } : phase === "after" ? { g4: "var(--gold)" } : undefined;

  return (
    <MockWindow label="🧪 Rematch — vs magnus_fan92">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <MiniBoard rows={board} rings={rings} />
        <p style={{
          fontSize: 12.5, fontWeight: 700, textAlign: "center", minHeight: 34,
          color: phase === "result" ? "var(--accent-green)" : "var(--text-secondary)",
          margin: 0, lineHeight: 1.5,
        }}>
          {phase === "before" && "magnus_fan92 to move…"}
          {phase === "after" && "Matched to their real 1847 rating & style"}
          {phase === "result" && "📈 +290cp better than what actually happened"}
        </p>
      </div>
    </MockWindow>
  );
}

// ── Card 3: Profile yourself and your opponents ─────────────────────────────

const YOU_SCORES = [78, 52, 71, 66, 40, 60];
const OPP_SCORES = [88, 35, 60, 74, 30, 48];
const AXES = ["Tactics", "Endgame", "Opening", "Calc.", "Time", "Position"];

function Radar({ scores, color, fillOpacity }: { scores: number[]; color: string; fillOpacity: number }) {
  const cx = 78, cy = 78, R = 54;
  const n = scores.length;
  const angleFor = (i: number) => -90 + (360 / n) * i;
  const pointAt = (i: number, r: number) => {
    const a = (angleFor(i) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  const dataPoints = scores.map((s, i) => pointAt(i, (s / 100) * R)).map(p => `${p.x},${p.y}`).join(" ");
  return (
    <polygon
      points={dataPoints}
      fill={color}
      stroke={color}
      strokeWidth={2}
      strokeLinejoin="round"
      style={{ opacity: fillOpacity, transition: "opacity 0.5s ease" }}
    />
  );
}

function ProfileDemo() {
  const [showOpponent, setShowOpponent] = useState(false);
  useLoop([
    [0, () => setShowOpponent(false)],
    [2600, () => setShowOpponent(true)],
  ], 5200);

  const cx = 78, cy = 78, R = 54;
  const n = AXES.length;
  const angleFor = (i: number) => -90 + (360 / n) * i;
  const pointAt = (i: number, r: number) => {
    const a = (angleFor(i) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  const ringPoints = (pct: number) => AXES.map((_, i) => pointAt(i, R * pct)).map(p => `${p.x},${p.y}`).join(" ");

  return (
    <MockWindow label="◉ Profile">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: showOpponent ? "var(--gold)" : "var(--accent-blue)", margin: 0, transition: "color 0.3s ease" }}>
          {showOpponent ? "magnus_fan92's profile" : "Your profile"}
        </p>
        <svg width={156} height={156} viewBox="0 0 156 156">
          {[0.33, 0.66, 1].map(pct => (
            <polygon key={pct} points={ringPoints(pct)} fill="none" stroke="var(--border)" strokeWidth={1} />
          ))}
          {AXES.map((_, i) => {
            const p = pointAt(i, R);
            return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="var(--border)" strokeWidth={1} />;
          })}
          <Radar scores={YOU_SCORES} color="var(--accent-blue)" fillOpacity={showOpponent ? 0 : 0.35} />
          <Radar scores={OPP_SCORES} color="var(--gold)" fillOpacity={showOpponent ? 0.4 : 0} />
          {AXES.map((label, i) => {
            const p = pointAt(i, R + 13);
            return (
              <text key={label} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize={7.5} fontWeight={700} fill="var(--text-muted)">
                {label}
              </text>
            );
          })}
        </svg>
        <p style={{ fontSize: 11.5, color: "var(--text-muted)", textAlign: "center", margin: 0, minHeight: 16 }}>
          {showOpponent ? "Know their weak endgame before you replay them" : "Nine dimensions, built from every game you feed it"}
        </p>
      </div>
    </MockWindow>
  );
}

// ── Card 4: Puzzles curated from your mistakes ──────────────────────────────

const PZL_BEFORE = parseBoard([
  "....k...",
  "........",
  "........",
  "...n....",
  "........",
  "..N.....",
  "........",
  "...Q.K..",
]);
const PZL_AFTER = parseBoard([
  "....k...",
  "........",
  "........",
  "...N....",
  "........",
  "........",
  "........",
  "...Q.K..",
]);

type PzlPhase = "prompt" | "solving" | "result";

function PuzzleDemo() {
  const [phase, setPhase] = useState<PzlPhase>(prefersReducedMotion ? "result" : "prompt");
  useLoop([
    [0, () => setPhase("prompt")],
    [1600, () => setPhase("solving")],
    [1600 + 1100, () => setPhase("result")],
  ], 1600 + 1100 + 2600);

  const board = phase === "result" ? PZL_AFTER : PZL_BEFORE;
  const rings: Record<string, string> | undefined = phase === "prompt"
    ? { d5: "var(--clr-mistake)" }
    : phase === "solving"
      ? { c3: "var(--gold)", d5: "var(--gold)" }
      : undefined;

  return (
    <MockWindow label="🧩 Puzzle — from your last blunder">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <MiniBoard rows={board} rings={rings} />
        <p style={{
          fontSize: 12.5, fontWeight: 700, textAlign: "center", minHeight: 34, lineHeight: 1.5, margin: 0,
          color: phase === "result" ? "var(--gold)" : "var(--text-secondary)",
        }}>
          {phase === "prompt" && "Find the best move for White"}
          {phase === "solving" && "Nxd5 …"}
          {phase === "result" && "◈ Good alternate! Qxd5 was the sharper choice."}
        </p>
      </div>
    </MockWindow>
  );
}

// ── Grid ─────────────────────────────────────────────────────────────────

export function CapabilityShowcase() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      <OpponentCloneDemo />
      <HeroChatDemo />
      <ProfileDemo />
      <PuzzleDemo />
      <style>{`
        @keyframes capshow-square-pulse {
          0%, 100% { opacity: 0.65; }
          50%      { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

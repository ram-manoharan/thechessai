"use client";
import { useEffect, useRef, useState } from "react";
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
// The "white piece" Unicode code points (♔♕♖♗♘♙) are drawn as hollow
// outline glyphs in most fonts — no CSS color/stroke can make them solid,
// which is why white pieces kept vanishing on light squares. Using the
// solid "black piece" glyph set for both sides and coloring purely via
// CSS fixes it for real instead of cosmetically.
const PIECE_GLYPH: Record<string, string> = {
  K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

function parseBoard(rows: string[]): string[][] {
  return rows.map(row => row.split(""));
}

function squareToRC(square: string): { r: number; c: number } {
  return { c: FILES.indexOf(square[0]), r: 8 - parseInt(square[1], 10) };
}

/** Both sides render the solid glyph set (see PIECE_GLYPH), so color alone
 * now has a real filled shape to work with — a thin opposite-tone stroke
 * keeps either color legible regardless of which square it lands on. */
function pieceStyle(piece: string) {
  const isWhite = piece === piece.toUpperCase();
  return isWhite
    ? {
        color: "#fbfaf6",
        WebkitTextStroke: "0.6px #241c10",
        textShadow: "0 1px 1px rgba(0,0,0,0.35)",
      }
    : {
        color: "#1c1712",
        WebkitTextStroke: "0.5px rgba(255,255,255,0.55)",
        textShadow: "0 1px 1px rgba(0,0,0,0.2)",
      };
}

/** Small letter-grid board (uppercase = White, lowercase = Black, "." =
 * empty) — decorative only, not a real position. `rings` highlights squares
 * with a colored pulsing ring. `move` (optional) slides a piece from one
 * square to another on top of the static board — without it, a board-state
 * swap reads as a teleport rather than a move. Re-triggers fresh whenever
 * move.from/to changes. */
function MiniBoard({
  rows, rings, size = 156, move,
}: {
  rows: string[][];
  rings?: Record<string, string>;
  size?: number;
  move?: { from: string; to: string; piece: string } | null;
}) {
  // Imperative DOM mutation (not React state) so the slide is driven by a
  // plain double-rAF position swap — starting state renders inline below,
  // the effect only ever writes to the DOM, never triggers a re-render.
  const pieceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!move) return;
    const el = pieceRef.current;
    if (!el) return;
    const to = squareToRC(move.to);
    if (prefersReducedMotion) {
      el.style.transition = "none";
      el.style.left = `${to.c * 12.5}%`;
      el.style.top = `${to.r * 12.5}%`;
      return;
    }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        el.style.transition = "left 0.6s cubic-bezier(0.4,0,0.2,1), top 0.6s cubic-bezier(0.4,0,0.2,1)";
        el.style.left = `${to.c * 12.5}%`;
        el.style.top = `${to.r * 12.5}%`;
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move?.from, move?.to, move?.piece]);

  return (
    <div
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "repeat(8, 1fr)",
        gridTemplateRows: "repeat(8, 1fr)",
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
          const hidden = move?.from === square;
          return (
            <div
              key={square}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: isLight ? "var(--board-light)" : "var(--board-dark)",
                fontSize: "clamp(12px, 2.6vw, 19px)",
                lineHeight: 1,
                ...(cell !== "." ? pieceStyle(cell) : null),
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
              {cell !== "." && !hidden && PIECE_GLYPH[cell]}
            </div>
          );
        }),
      )}
      {move && (() => {
        const from = squareToRC(move.from);
        return (
          <div
            ref={pieceRef}
            style={{
              position: "absolute",
              width: "12.5%", height: "12.5%",
              left: `${from.c * 12.5}%`,
              top: `${from.r * 12.5}%`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "clamp(12px, 2.6vw, 19px)",
              lineHeight: 1,
              pointerEvents: "none",
              zIndex: 2,
              ...pieceStyle(move.piece),
            }}
          >
            {PIECE_GLYPH[move.piece]}
          </div>
        );
      })()}
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

type OppPhase = "before" | "moving" | "after" | "result";

const OPP_MOVE = { from: "f6", to: "g4", piece: "n" };

function OpponentCloneDemo() {
  const [phase, setPhase] = useState<OppPhase>(prefersReducedMotion ? "result" : "before");
  useLoop([
    [0, () => setPhase("before")],
    [1400, () => setPhase("moving")],
    [1400 + 650, () => setPhase("after")],
    [1400 + 650 + 1600, () => setPhase("result")],
  ], 1400 + 650 + 1600 + 2200);

  const board = phase === "after" || phase === "result" ? OPP_AFTER : OPP_BEFORE;
  const rings: Record<string, string> | undefined =
    phase === "before" ? { f6: "var(--gold)" } : phase === "after" ? { g4: "var(--gold)" } : undefined;
  const move = phase === "moving" ? OPP_MOVE : null;

  return (
    <MockWindow label="🧪 Rematch — AI clone of magnus_fan92">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <MiniBoard rows={board} rings={rings} move={move} />
        <p style={{
          fontSize: 12.5, fontWeight: 700, textAlign: "center", minHeight: 34,
          color: phase === "result" ? "var(--accent-green)" : "var(--text-secondary)",
          margin: 0, lineHeight: 1.5,
        }}>
          {phase === "before" && "Their clone, playing their real style…"}
          {phase === "moving" && "…Ng4"}
          {phase === "after" && "Matched to their real 1847 rating & style"}
          {phase === "result" && "📈 +290cp better than what actually happened"}
        </p>
      </div>
    </MockWindow>
  );
}

// ── Card 3: Profile yourself and your opponents ─────────────────────────────

const YOU_SCORES = [78, 52, 71, 66, 40, 60, 58, 74, 49];
const OPP_SCORES = [88, 35, 60, 74, 30, 48, 42, 81, 55];
const AXES = ["Tactics", "Endgame", "Opening", "Calc.", "Time", "Position", "Defense", "Attack", "Consistency"];

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
    <MockWindow label="◉ Deep Profile — 9 dimensions tracked">
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
  "r...k..r",
  "ppp..ppp",
  "........",
  "...n....",
  "........",
  "..N.....",
  "PPP..PPP",
  "R..Q.RK.",
]);
const PZL_AFTER = parseBoard([
  "r...k..r",
  "ppp..ppp",
  "........",
  "...N....",
  "........",
  "........",
  "PPP..PPP",
  "R..Q.RK.",
]);

type PzlPhase = "prompt" | "moving" | "result";

const PZL_MOVE = { from: "c3", to: "d5", piece: "N" };

function PuzzleDemo() {
  const [phase, setPhase] = useState<PzlPhase>(prefersReducedMotion ? "result" : "prompt");
  useLoop([
    [0, () => setPhase("prompt")],
    [1400, () => setPhase("moving")],
    [1400 + 650, () => setPhase("result")],
  ], 1400 + 650 + 2600);

  const board = phase === "result" ? PZL_AFTER : PZL_BEFORE;
  const rings: Record<string, string> | undefined =
    phase === "prompt" ? { d5: "var(--clr-mistake)" } : undefined;
  const move = phase === "moving" ? PZL_MOVE : null;

  return (
    <MockWindow label="🧩 Puzzle — built from your recurring mistakes">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <MiniBoard rows={board} rings={rings} move={move} />
        <p style={{
          fontSize: 12.5, fontWeight: 700, textAlign: "center", minHeight: 34, lineHeight: 1.5, margin: 0,
          color: phase === "result" ? "var(--gold)" : "var(--text-secondary)",
        }}>
          {phase === "prompt" && "Same tactic that beat you 3 times this month"}
          {phase === "moving" && "Nxd5 …"}
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

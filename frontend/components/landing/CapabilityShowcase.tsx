"use client";
import { useEffect, useState } from "react";
import { MockWindow } from "./MockWindow";
import { HeroChatDemo } from "./HeroChatDemo";
import { MiniBoard, parseBoard } from "./MiniBoard";

// Four small, independently-looping demos shown in parallel — not a single
// tabbed rotator like the old "See it in action" section. The point is to
// let the visuals carry the pitch: each card shows the actual mechanism
// (opponent-accurate replay, AI coach Q&A, dual profiling, alt-move-credit
// puzzles) running, rather than describing it in another paragraph.

const prefersReducedMotion = typeof window !== "undefined"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    </div>
  );
}

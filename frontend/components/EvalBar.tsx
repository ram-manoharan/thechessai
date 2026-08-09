"use client";
import { useGameStore } from "@/lib/store";
import { cpToWhitePct, qualitativeEvalLabel } from "@/lib/chess-utils";

// Below this estimated rating, raw +/- numbers are noise the player has no
// calibration for yet — ANALYSIS_STRATEGY.md section 4 ("under 800" band).
const BEGINNER_ELO_CUTOFF = 800;

export function EvalBar() {
  const movesData     = useGameStore(s => s.movesData);
  const currentIdx    = useGameStore(s => s.currentIdx);
  const move          = useGameStore(s => s.currentMove());
  const flipped       = useGameStore(s => s.flipped);
  const playerColor   = useGameStore(s => s.playerColor);
  const estimatedElo  = useGameStore(s => s.estimatedElo);

  // At start (currentIdx=-1) use score_before of first move; otherwise use score_after
  const cp = currentIdx < 0
    ? (movesData[0]?.score_before ?? null)
    : (move?.score_after ?? null);

  const whitePct = cpToWhitePct(cp);
  const isBeginner = estimatedElo != null && estimatedElo < BEGINNER_ELO_CUTOFF;

  const fmtLabel = (v: number | null) => {
    if (v == null) return "0.0";
    if (Math.abs(v) >= 9000) return v > 0 ? "M" : "-M";
    return v > 0 ? `+${(v / 100).toFixed(1)}` : (v / 100).toFixed(1);
  };
  const qualitative = isBeginner ? qualitativeEvalLabel(cp, playerColor) : null;
  const label = qualitative ? qualitative.short : fmtLabel(cp);
  const title = qualitative ? qualitative.full : undefined;

  const topPct   = flipped ? whitePct : (100 - whitePct);
  const botPct   = 100 - topPct;
  const topColor = flipped ? "#fff" : "#2a2a2a";
  const botColor = flipped ? "#2a2a2a" : "#fff";

  return (
    <div className="flex flex-col items-center gap-1 w-5 shrink-0 self-stretch">
      <div
        className="flex-1 w-full rounded-md overflow-hidden relative"
        style={{ background: "var(--bg-elevated)", minHeight: 200 }}
      >
        <div
          className="absolute top-0 left-0 w-full transition-all duration-300 ease-out"
          style={{ height: `${topPct}%`, background: topColor }}
        />
        <div
          className="absolute bottom-0 left-0 w-full transition-all duration-300 ease-out"
          style={{ height: `${botPct}%`, background: botColor }}
        />
      </div>
      <span
        className={isBeginner ? "text-[9px] leading-none text-center" : "text-[9px] font-mono leading-none"}
        style={{ color: "var(--text-muted)" }}
        title={title}
      >
        {label}
      </span>
    </div>
  );
}

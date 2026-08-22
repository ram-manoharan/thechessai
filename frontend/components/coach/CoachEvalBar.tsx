"use client";
import { cpToWhitePct } from "@/lib/chess-utils";

/** Sibling to components/EvalBar.tsx, which reads everything from
 * useGameStore — this one takes cp/flipped as plain props since /coach has
 * no game store, just a freely-loaded position. No beginner-band
 * qualitative label here (that needs an estimatedElo/playerColor binding
 * that doesn't naturally exist for an arbitrary FEN) — always numeric. */
export function CoachEvalBar({ cp, flipped = false }: { cp: number | null; flipped?: boolean }) {
  const whitePct = cpToWhitePct(cp);

  const fmtLabel = (v: number | null) => {
    if (v == null) return "0.0";
    if (Math.abs(v) >= 9000) return v > 0 ? "M" : "-M";
    return v > 0 ? `+${(v / 100).toFixed(1)}` : (v / 100).toFixed(1);
  };

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
      <span className="text-[9px] font-mono leading-none" style={{ color: "var(--text-muted)" }}>
        {fmtLabel(cp)}
      </span>
    </div>
  );
}

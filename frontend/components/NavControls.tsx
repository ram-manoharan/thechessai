"use client";
import { useEffect, useCallback } from "react";
import { useGameStore } from "@/lib/store";
import { playSound, sanToSound } from "@/lib/sounds";

const ERROR_CLASSES = ["Blunder", "Mistake", "Miss"];

export function NavControls() {
  const movesData    = useGameStore(s => s.movesData);
  const currentIdx   = useGameStore(s => s.currentIdx);
  const soundEnabled = useGameStore(s => s.soundEnabled);
  const navigateTo   = useGameStore(s => s.navigateTo);
  const toggleSound  = useGameStore(s => s.toggleSound);
  const max = movesData.length - 1;

  function go(idx: number) {
    const clamped = Math.max(-1, Math.min(max, idx));
    navigateTo(clamped);
    if (soundEnabled && clamped >= 0 && movesData[clamped]) {
      playSound(sanToSound(movesData[clamped].san));
    }
  }

  const goNextMistake = useCallback(() => {
    for (let i = currentIdx + 1; i <= max; i++) {
      if (ERROR_CLASSES.some(k => movesData[i]?.classification?.includes(k))) {
        go(i);
        return;
      }
    }
  }, [currentIdx, max, movesData]); // eslint-disable-line

  const goPrevMistake = useCallback(() => {
    for (let i = currentIdx - 1; i >= 0; i--) {
      if (ERROR_CLASSES.some(k => movesData[i]?.classification?.includes(k))) {
        go(i);
        return;
      }
    }
  }, [currentIdx, movesData]); // eslint-disable-line

  const hasPrevMistake = currentIdx > 0 && movesData.slice(0, currentIdx).some(m => ERROR_CLASSES.some(k => m.classification?.includes(k)));
  const hasNextMistake = currentIdx < max && movesData.slice(currentIdx + 1).some(m => ERROR_CLASSES.some(k => m.classification?.includes(k)));

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft")  { e.preventDefault(); go(currentIdx - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); go(currentIdx + 1); }
      if (e.key === "Home")       { e.preventDefault(); go(-1); }
      if (e.key === "End")        { e.preventDefault(); go(max); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentIdx, max, soundEnabled]); // eslint-disable-line

  if (!movesData.length) return null;

  const btnBase = "h-9 rounded-lg flex items-center justify-center transition-colors text-sm disabled:opacity-25";
  const btnStyle = {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    color: "var(--text-primary)",
  };
  const atStart = currentIdx < 0;
  const atEnd   = currentIdx >= max;

  // Current move label: "Move 34 · Black"
  let moveLabel = "Start";
  if (currentIdx >= 0) {
    const fullMove = Math.floor(currentIdx / 2) + 1;
    const side = movesData[currentIdx]?.color === "Black" ? "Black" : "White";
    moveLabel = `${fullMove} · ${side}`;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {/* Nav buttons */}
        <button style={btnStyle} className={`${btnBase} w-9`} onClick={() => go(-1)}  disabled={atStart} title="Start (Home)">⏮</button>
        <button style={btnStyle} className={`${btnBase} w-9`} onClick={() => go(currentIdx - 1)} disabled={atStart} title="Prev (←)">‹</button>

        {/* Slider */}
        <input
          type="range"
          min={-1}
          max={max}
          value={currentIdx}
          onChange={e => go(Number(e.target.value))}
          className="flex-1 accent-blue-500 h-1 cursor-pointer"
        />

        <button style={btnStyle} className={`${btnBase} w-9`} onClick={() => go(currentIdx + 1)} disabled={atEnd} title="Next (→)">›</button>
        <button style={btnStyle} className={`${btnBase} w-9`} onClick={() => go(max)} disabled={atEnd} title="End (End)">⏭</button>

        {/* Sound toggle */}
        <button
          style={{
            background: soundEnabled ? "rgba(79,142,247,0.12)" : "var(--bg-elevated)",
            border: `1px solid ${soundEnabled ? "rgba(79,142,247,0.35)" : "var(--border)"}`,
            color: soundEnabled ? "var(--accent-blue)" : "var(--text-muted)",
          }}
          className={`${btnBase} w-9`}
          onClick={toggleSound}
          title={soundEnabled ? "Mute sounds" : "Enable sounds"}
        >
          {soundEnabled ? "🔊" : "🔇"}
        </button>

        {/* Move counter */}
        <span style={{ color: "var(--text-muted)" }} className="text-xs font-mono w-[72px] text-right shrink-0">
          {moveLabel}
        </span>
      </div>

      {/* Mistake navigation row */}
      <div className="flex items-center gap-2">
        <button
          onClick={goPrevMistake}
          disabled={!hasPrevMistake}
          title="Previous mistake"
          style={{
            background: hasPrevMistake ? "rgba(224,82,82,0.10)" : "var(--bg-elevated)",
            border: `1px solid ${hasPrevMistake ? "rgba(224,82,82,0.30)" : "var(--border)"}`,
            color: hasPrevMistake ? "var(--clr-blunder)" : "var(--text-muted)",
            fontSize: 11,
            fontWeight: 500,
            padding: "4px 10px",
            borderRadius: 6,
            cursor: hasPrevMistake ? "pointer" : "not-allowed",
            opacity: hasPrevMistake ? 1 : 0.4,
          }}
        >
          ← Mistake
        </button>

        <span style={{ color: "var(--text-muted)", fontSize: 11, flex: 1, textAlign: "center" }}>
          {(() => {
            const errs = movesData.filter(m => ERROR_CLASSES.some(k => m.classification?.includes(k)));
            if (!errs.length) return "No errors";
            const blunders  = movesData.filter(m => m.classification?.includes("Blunder")).length;
            const mistakes  = movesData.filter(m => m.classification?.includes("Mistake") && !m.classification?.includes("Blunder")).length;
            const parts = [];
            if (blunders)  parts.push(`${blunders} blunder${blunders > 1 ? "s" : ""}`);
            if (mistakes)  parts.push(`${mistakes} mistake${mistakes > 1 ? "s" : ""}`);
            return parts.join(", ");
          })()}
        </span>

        <button
          onClick={goNextMistake}
          disabled={!hasNextMistake}
          title="Next mistake"
          style={{
            background: hasNextMistake ? "rgba(224,82,82,0.10)" : "var(--bg-elevated)",
            border: `1px solid ${hasNextMistake ? "rgba(224,82,82,0.30)" : "var(--border)"}`,
            color: hasNextMistake ? "var(--clr-blunder)" : "var(--text-muted)",
            fontSize: 11,
            fontWeight: 500,
            padding: "4px 10px",
            borderRadius: 6,
            cursor: hasNextMistake ? "pointer" : "not-allowed",
            opacity: hasNextMistake ? 1 : 0.4,
          }}
        >
          Mistake →
        </button>
      </div>
    </div>
  );
}

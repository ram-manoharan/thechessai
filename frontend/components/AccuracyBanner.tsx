"use client";
import { useMemo, useState, useEffect } from "react";
import { useGameStore } from "@/lib/store";
import { computeAccuracy, accuracyColor } from "@/lib/chess-utils";

function Ring({ acc, label, sub, isPlayer }: { acc: number; label: string; sub: string; isPlayer?: boolean }) {
  const R      = 34;
  const stroke = 5;
  const circ   = 2 * Math.PI * R;
  const pct    = Math.max(0, Math.min(100, acc));
  const dash   = (pct / 100) * circ + " " + circ;
  const color  = accuracyColor(acc);

  const isGreat = acc >= 90;

  // Brilliant game pulse — fires once 800ms after first render if ≥90
  const [glowing, setGlowing] = useState(false);
  useEffect(() => {
    if (!isGreat || !isPlayer) return;
    const t = setTimeout(() => {
      setGlowing(true);
      const t2 = setTimeout(() => setGlowing(false), 1800);
      return () => clearTimeout(t2);
    }, 800);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line

  const ringGlow = isGreat
    ? { filter: "drop-shadow(0 0 " + (glowing ? "12px" : "6px") + " " + color + "88)", transition: "filter 0.4s ease" }
    : {};

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative", width: 80, height: 80 }}>
        <svg
          width="80"
          height="80"
          viewBox="0 0 80 80"
          style={{ transform: "rotate(-90deg)", ...ringGlow }}
        >
          {/* Track */}
          <circle cx={40} cy={40} r={R} fill="none" stroke="var(--bg-hover)" strokeWidth={stroke} />
          {/* Progress */}
          <circle
            cx={40} cy={40} r={R}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={dash}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.7s cubic-bezier(.4,0,.2,1)" }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color, fontSize: 18, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {Math.round(acc)}
          </span>
        </div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 600, letterSpacing: "0.01em", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </div>
        {isGreat && isPlayer ? (
          <div style={{
            color: "var(--gold)", fontSize: 10, fontWeight: 700, marginTop: 3,
            animation: glowing ? "brilliant-pop 0.6s ease forwards" : undefined,
          }}>
            {"✦ Brilliant game"}
          </div>
        ) : (
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 1 }}>{sub}</div>
        )}
      </div>
      <style dangerouslySetInnerHTML={{ __html: "@keyframes brilliant-pop { 0% { opacity: 0; transform: scale(0.8); } 60% { opacity: 1; transform: scale(1.12); } 100% { opacity: 1; transform: scale(1); } }" }} />
    </div>
  );
}

export function AccuracyBanner() {
  const movesData   = useGameStore(s => s.movesData);
  const metadata    = useGameStore(s => s.metadata);
  const playerColor = useGameStore(s => s.playerColor);

  const { white, black } = useMemo(() => computeAccuracy(movesData), [movesData]);

  if (!movesData.length) return null;

  const whiteName    = metadata["White"] ?? "White";
  const blackName    = metadata["Black"] ?? "Black";
  const whiteIsPlayer = playerColor === "white";
  const diff         = white - black;

  return (
    <div
      className="card animate-fade-in"
      style={{ padding: "20px 24px" }}
    >
      <p style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 16 }}>
        Game Accuracy
      </p>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around" }}>
        <Ring
          acc={white}
          label={whiteIsPlayer ? whiteName + " (you)" : whiteName}
          sub="accuracy"
          isPlayer={whiteIsPlayer}
        />

        {/* Centre divider */}
        <div style={{ textAlign: "center", padding: "0 8px" }}>
          <div style={{ color: "var(--border-strong)", fontSize: 20, lineHeight: 1, marginBottom: 4 }}>vs</div>
          {Math.abs(diff) > 0.5 && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: diff > 0 ? "var(--clr-best)" : "var(--clr-blunder)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)}
            </div>
          )}
        </div>

        <Ring
          acc={black}
          label={!whiteIsPlayer ? blackName + " (you)" : blackName}
          sub="accuracy"
          isPlayer={!whiteIsPlayer}
        />
      </div>
    </div>
  );
}

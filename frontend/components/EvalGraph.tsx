"use client";
import { useMemo, useState, useCallback } from "react";
import { useGameStore } from "@/lib/store";
import { cpToWhitePct, clfConfig } from "@/lib/chess-utils";

const W = 500;
const H = 110;
const PAD = 4;

function dotColor(clf: string): string | null {
  if (clf.includes("Brilliant")) return "var(--clr-brilliant)";
  if (clf.includes("Blunder"))   return "var(--clr-blunder)";
  if (clf.includes("Mistake") && !clf.includes("Inaccuracy")) return "var(--clr-mistake)";
  return null;
}

export function EvalGraph() {
  const movesData  = useGameStore(s => s.movesData);
  const currentIdx = useGameStore(s => s.currentIdx);
  const navigateTo = useGameStore(s => s.navigateTo);

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const points = useMemo(() => {
    if (!movesData.length) return [];
    return movesData.map((m, i) => {
      const pct = cpToWhitePct(m.score_after);
      const x = PAD + (i / (movesData.length - 1 || 1)) * (W - PAD * 2);
      const y = PAD + (1 - pct / 100) * (H - PAD * 2);
      return { x, y, pct, idx: i, classification: m.classification ?? "" };
    });
  }, [movesData]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!points.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width * W;
    let best = 0, bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p.x - relX);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    setHoveredIdx(best);
  }, [points]);

  if (!points.length) return null;

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const mid = PAD + 0.5 * (H - PAD * 2);

  const fillWhitePath =
    `M ${PAD} ${mid} ` +
    points.map(p => `L ${p.x.toFixed(1)} ${Math.min(p.y, mid).toFixed(1)}`).join(" ") +
    ` L ${W - PAD} ${mid} Z`;
  const fillBlackPath =
    `M ${PAD} ${mid} ` +
    points.map(p => `L ${p.x.toFixed(1)} ${Math.max(p.y, mid).toFixed(1)}`).join(" ") +
    ` L ${W - PAD} ${mid} Z`;

  const cursor  = currentIdx >= 0 && currentIdx < points.length ? points[currentIdx] : null;
  const hovered = hoveredIdx !== null && hoveredIdx < points.length ? points[hoveredIdx] : null;

  const displayIdx = hoveredIdx !== null ? hoveredIdx : (currentIdx >= 0 ? currentIdx : null);
  const displayPt  = displayIdx !== null && displayIdx < points.length ? points[displayIdx] : null;

  const evalText = displayPt
    ? displayPt.pct > 50
      ? `White +${((displayPt.pct - 50) / 50 * 4).toFixed(1)}`
      : `Black +${((50 - displayPt.pct) / 50 * 4).toFixed(1)}`
    : null;

  // Tooltip content for hovered point
  const tooltipMove = displayIdx !== null ? movesData[displayIdx] : null;
  const tooltipCfg  = tooltipMove ? clfConfig(tooltipMove.classification ?? "") : null;

  // Critical move dots: blunders (red), mistakes (orange), brilliant (cyan)
  const criticalDots = points.filter(p => dotColor(p.classification) !== null);

  return (
    <div className="card animate-fade-in" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Evaluation
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "var(--clr-brilliant)", fontSize: 10 }}>!! Brilliant</span>
          <span style={{ color: "var(--clr-blunder)",  fontSize: 10 }}>?? Blunder</span>
          <span style={{ color: "var(--clr-mistake)",  fontSize: 10 }}>? Mistake</span>
          {evalText && (
            <span style={{ color: "var(--text-secondary)", fontSize: 11, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
              {evalText}
            </span>
          )}
        </div>
      </div>

      {/* Hover tooltip strip */}
      {tooltipMove && hoveredIdx !== null && (
        <div style={{
          fontSize: 11,
          color: "var(--text-secondary)",
          marginBottom: 6,
          display: "flex",
          alignItems: "center",
          gap: 8,
          minHeight: 18,
        }}>
          <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {tooltipMove.color === "White" ? "White" : "Black"} {Math.floor(hoveredIdx / 2) + 1}
          </span>
          <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{tooltipMove.san}</span>
          {tooltipCfg && (
            <span style={{ color: tooltipCfg.color, fontWeight: 700, fontSize: 10 }}>
              {tooltipCfg.badge} {tooltipCfg.label}
            </span>
          )}
          {tooltipMove.cp_loss > 0 && (
            <span style={{ color: "var(--text-muted)", fontSize: 10 }}>−{tooltipMove.cp_loss} cp</span>
          )}
        </div>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: H, display: "block", cursor: "crosshair", borderRadius: 8, overflow: "hidden" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredIdx(null)}
        onClick={e => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const relX = (e.clientX - rect.left) / rect.width * W;
          let best = 0, bestDist = Infinity;
          points.forEach((p, i) => { const d = Math.abs(p.x - relX); if (d < bestDist) { bestDist = d; best = i; } });
          navigateTo(best);
        }}
      >
        <defs>
          <linearGradient id="grad-white" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(228,223,214,0.28)" />
            <stop offset="100%" stopColor="rgba(228,223,214,0.04)" />
          </linearGradient>
          <linearGradient id="grad-black" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(0,0,0,0.08)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.32)" />
          </linearGradient>
        </defs>

        {/* Backgrounds */}
        <rect x={0} y={0} width={W} height={mid} fill="var(--tint-surface)" />
        <rect x={0} y={mid} width={W} height={H - mid} fill="rgba(0,0,0,0.18)" />

        {/* Side labels */}
        <text x={PAD + 2} y={PAD + 10} fill="var(--text-muted)" fontSize="8" fontFamily="monospace" opacity={0.5}>White</text>
        <text x={PAD + 2} y={H - PAD - 3} fill="var(--text-muted)" fontSize="8" fontFamily="monospace" opacity={0.5}>Black</text>

        {/* Gradient fills */}
        <path d={fillWhitePath} fill="url(#grad-white)" />
        <path d={fillBlackPath} fill="url(#grad-black)" />

        {/* Midline */}
        <line x1={PAD} y1={mid} x2={W - PAD} y2={mid} stroke="rgba(201,162,68,0.18)" strokeWidth={1} strokeDasharray="4 4" />

        {/* Eval line */}
        <path d={pathD} fill="none" stroke="rgba(228,223,214,0.65)" strokeWidth={1.5} strokeLinejoin="round" />

        {/* Critical move dots with AI marker labels */}
        {criticalDots.map(p => {
          const color    = dotColor(p.classification)!;
          const isCurrent = p.idx === currentIdx;
          const isBrilliant = p.classification.includes("Brilliant");
          const isBlunder   = p.classification.includes("Blunder");
          const symbol = isBrilliant ? "★" : isBlunder ? "▼" : "▲";
          // place label above dot for top half, below for bottom half
          const labelAbove = p.y > H / 2;
          const labelY     = labelAbove ? p.y - 10 : p.y + 16;
          return (
            <g key={p.idx} style={{ cursor: "pointer" }} onClick={e => { e.stopPropagation(); navigateTo(p.idx); }}>
              <circle cx={p.x} cy={p.y}
                r={isCurrent ? 5.5 : 4}
                fill={color} stroke="var(--bg-surface)" strokeWidth={1.5} opacity={0.92}
              />
              <text
                x={p.x} y={labelY}
                textAnchor="middle" fill={color}
                fontSize={isBrilliant ? "8" : "7"}
                fontFamily="monospace"
                opacity={0.85}
              >
                {symbol}
              </text>
            </g>
          );
        })}

        {/* Hover cursor line */}
        {hovered && hoveredIdx !== currentIdx && (
          <line x1={hovered.x} y1={PAD} x2={hovered.x} y2={H - PAD}
            stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="2 2" />
        )}

        {/* Active cursor */}
        {cursor && (
          <>
            <line x1={cursor.x} y1={PAD} x2={cursor.x} y2={H - PAD}
              stroke="var(--accent-blue)" strokeWidth={1.5} strokeDasharray="3 2" opacity={0.7} />
            {!dotColor(cursor.classification) && (
              <circle cx={cursor.x} cy={cursor.y} r={3.5}
                fill="var(--accent-blue)" stroke="var(--bg-surface)" strokeWidth={2} />
            )}
          </>
        )}
      </svg>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>Move 1</span>
        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>Move {movesData.length}</span>
      </div>
    </div>
  );
}

"use client";
import { useGameStore } from "@/lib/store";

const W = 500;
const H = 80;
const PAD = 4;

function fmtTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ClockChart() {
  const movesData   = useGameStore(s => s.movesData);
  const playerColor = useGameStore(s => s.playerColor);
  const currentIdx  = useGameStore(s => s.currentIdx);
  const navigateTo  = useGameStore(s => s.navigateTo);

  const playerSide = playerColor === "white" ? "White" : "Black";
  const oppSide    = playerColor === "white" ? "Black" : "White";

  const hasClocks = movesData.some(m => m.clock_remaining != null);

  const allClocks = movesData.filter(m => m.clock_remaining != null).map(m => m.clock_remaining as number);
  const maxClock  = allClocks.length > 0 ? Math.max(...allClocks, 1) : 1;

  const mkPoints = (side: string) => {
    const pts = movesData
      .map((m, i) => ({ ...m, origIdx: i }))
      .filter(m => m.color === side && m.clock_remaining != null);
    if (pts.length < 2) return [];
    return pts.map((m, i) => {
      const x = PAD + (i / (pts.length - 1 || 1)) * (W - PAD * 2);
      const y = PAD + (1 - (m.clock_remaining as number) / maxClock) * (H - PAD * 2);
      return { x, y, clock: m.clock_remaining as number, origIdx: m.origIdx };
    });
  };

  const playerPoints = mkPoints(playerSide);
  const oppPoints    = mkPoints(oppSide);

  if (!hasClocks || playerPoints.length === 0) return null;

  const toPath = (pts: typeof playerPoints) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  const toFill = (pts: typeof playerPoints) =>
    `${toPath(pts)} L ${pts[pts.length - 1].x.toFixed(1)} ${H - PAD} L ${pts[0].x.toFixed(1)} ${H - PAD} Z`;

  const cursorPlayer = currentIdx >= 0
    ? playerPoints.find(p => p.origIdx === currentIdx) ?? null
    : null;

  return (
    <div className="card animate-fade-in" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", rowGap: 6 }}>
        <span style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Time Management
        </span>
        <div style={{ display: "flex", gap: 12, fontSize: 10, flexWrap: "wrap", rowGap: 4 }}>
          <span style={{ color: "var(--gold)", whiteSpace: "nowrap" }}>─ You</span>
          <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>─ Opponent</span>
          {cursorPlayer && (
            <span style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {fmtTime(cursorPlayer.clock)}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
        {/* Y-axis labels */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", paddingBottom: 2, flexShrink: 0 }}>
          <span style={{ color: "var(--text-muted)", fontSize: 9, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
            {fmtTime(maxClock)}
          </span>
          <span style={{ color: "var(--text-muted)", fontSize: 9, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
            0:00
          </span>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ flex: 1, height: H, display: "block", cursor: "crosshair", borderRadius: 6 }}
          onClick={e => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const relX = (e.clientX - rect.left) / rect.width * W;
            let best = -1, bestDist = Infinity;
            playerPoints.forEach(p => {
              const d = Math.abs(p.x - relX);
              if (d < bestDist) { bestDist = d; best = p.origIdx; }
            });
            if (best >= 0) navigateTo(best);
          }}
        >
          <defs>
            <linearGradient id="grad-clock-player" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(201,162,68,0.3)" />
              <stop offset="100%" stopColor="rgba(201,162,68,0.02)" />
            </linearGradient>
            <linearGradient id="grad-clock-opp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(120,120,140,0.15)" />
              <stop offset="100%" stopColor="rgba(120,120,140,0.02)" />
            </linearGradient>
          </defs>

          {oppPoints.length > 1 && (
            <>
              <path d={toFill(oppPoints)} fill="url(#grad-clock-opp)" />
              <path d={toPath(oppPoints)} fill="none" stroke="rgba(140,140,160,0.45)" strokeWidth={1.5} strokeLinejoin="round" />
            </>
          )}

          <path d={toFill(playerPoints)} fill="url(#grad-clock-player)" />
          <path d={toPath(playerPoints)} fill="none" stroke="rgba(201,162,68,0.8)" strokeWidth={2} strokeLinejoin="round" />

          {cursorPlayer && (
            <circle cx={cursorPlayer.x} cy={cursorPlayer.y} r={3.5}
              fill="var(--gold)" stroke="var(--bg-surface)" strokeWidth={2} />
          )}
        </svg>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, paddingLeft: 32 }}>
        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>Move 1</span>
        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>End</span>
      </div>
    </div>
  );
}

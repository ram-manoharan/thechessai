import { MockWindow } from "./MockWindow";

const RADAR_AXES = [
  { label: "Tactics",     score: 78 },
  { label: "Endgame",     score: 52 },
  { label: "Opening",     score: 71 },
  { label: "Calculation", score: 66 },
  { label: "Time Mgmt",   score: 40 },
  { label: "Positional",  score: 60 },
];

const RATING_HISTORY = [1420, 1447, 1435, 1480, 1512, 1498, 1560, 1612];

const CALLOUTS = [
  { icon: "◈", title: "8-dimension skill radar", desc: "Tactics, endgame, time management and more — scored from your actual games, not a self-assessment." },
  { icon: "🎯", title: "ELO-adaptive coaching", desc: "Explanations calibrated to your rating band — beginner-friendly or grandmaster-terse, automatically." },
  { icon: "🧬", title: "Mistake fingerprint", desc: "The patterns that cost you the most, ranked by impact and tracked as a trend over time." },
];

function RadarChart() {
  const cx = 90, cy = 90, R = 68;
  const n = RADAR_AXES.length;
  const angleFor = (i: number) => -90 + (360 / n) * i;
  const pointAt = (i: number, r: number) => {
    const a = (angleFor(i) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  const ringPoints = (pct: number) =>
    RADAR_AXES.map((_, i) => pointAt(i, R * pct)).map(p => `${p.x},${p.y}`).join(" ");
  const dataPoints = RADAR_AXES.map((a, i) => pointAt(i, (a.score / 100) * R)).map(p => `${p.x},${p.y}`).join(" ");

  return (
    <svg width={180} height={180} viewBox="0 0 180 180">
      {[0.33, 0.66, 1].map(pct => (
        <polygon key={pct} points={ringPoints(pct)} fill="none" stroke="var(--border)" strokeWidth={1} />
      ))}
      {RADAR_AXES.map((_, i) => {
        const p = pointAt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="var(--border)" strokeWidth={1} />;
      })}
      <polygon points={dataPoints} fill="rgba(91,142,245,0.22)" stroke="var(--accent-blue)" strokeWidth={2} strokeLinejoin="round" />
      {RADAR_AXES.map((a, i) => {
        const p = pointAt(i, R + 16);
        return (
          <text
            key={a.label}
            x={p.x} y={p.y}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={8.5} fontWeight={700} fill="var(--text-muted)"
          >
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}

function RatingSparkline() {
  const w = 220, h = 70, pad = 6;
  const min = Math.min(...RATING_HISTORY);
  const max = Math.max(...RATING_HISTORY);
  const range = max - min || 1;
  const pts = RATING_HISTORY.map((v, i) => {
    const x = pad + (i / (RATING_HISTORY.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return { x, y };
  });
  const line = pts.map(p => `${p.x},${p.y}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
  const last = pts[pts.length - 1];
  const delta = RATING_HISTORY[RATING_HISTORY.length - 1] - RATING_HISTORY[0];

  return (
    <div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <defs>
          <linearGradient id="ratingFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#ratingFill)" />
        <polyline points={line} fill="none" stroke="var(--gold)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last.x} cy={last.y} r={3} fill="var(--gold)" />
      </svg>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
        <span style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
          {RATING_HISTORY[RATING_HISTORY.length - 1]}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--clr-best)" }}>
          {"+"}{delta}{" this month"}
        </span>
      </div>
    </div>
  );
}

export function ProfileSpotlight() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
      <MockWindow label="◉ Profile — respects_55">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center", marginBottom: 18 }}>
          <RadarChart />
          <RatingSparkline />
        </div>
        <div
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(91,142,245,0.1)", border: "1px solid rgba(91,142,245,0.25)",
            borderRadius: 8, padding: "6px 12px", marginBottom: 14,
          }}
        >
          <span style={{ fontSize: 14 }}>⚔</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#5b8ef5" }}>Aggressive Tactician</span>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
          Top recurring mistake
        </p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-surface)", border: "1px solid var(--border)", borderLeft: "3px solid var(--clr-mistake)", borderRadius: 8, padding: "9px 12px" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" }}>Tactics: Back Rank</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>−612 cp · 7×</span>
        </div>
      </MockWindow>

      <div>
        <p style={{ color: "var(--accent-blue)", fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 10 }}>
          The critical piece · 02
        </p>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(24px, 3vw, 34px)", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: 14, lineHeight: 1.15 }}>
          A profile that actually<br />knows your game.
        </h3>
        <p style={{ color: "var(--text-secondary)", fontSize: 14.5, lineHeight: 1.7, marginBottom: 24, maxWidth: 440 }}>
          I analyse 10 to 100 of your recent games and build a picture of how you actually
          play — not a single rating number, but where your points are really being won and lost.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {CALLOUTS.map(c => (
            <div key={c.title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ fontSize: 18, width: 26, textAlign: "center", flexShrink: 0 }}>{c.icon}</span>
              <div>
                <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{c.title}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>{c.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

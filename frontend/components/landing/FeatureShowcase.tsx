"use client";
import { useEffect, useRef, useState } from "react";
import { MockWindow } from "./MockWindow";

// One consolidated, auto-advancing showcase replaces three separate static
// spotlight sections (Study / Profile / Replay) that each repeated content
// already covered by "How it works" and the capability grid below —
// the same three stories, told once, animated instead of stacked.

const RADAR_AXES = [
  { label: "Tactics",     score: 78 },
  { label: "Endgame",     score: 52 },
  { label: "Opening",     score: 71 },
  { label: "Calculation", score: 66 },
  { label: "Time Mgmt",   score: 40 },
  { label: "Positional",  score: 60 },
];

function RadarChart() {
  const cx = 90, cy = 90, R = 62;
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
        const p = pointAt(i, R + 15);
        return (
          <text key={a.label} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize={8} fontWeight={700} fill="var(--text-muted)">
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}

const TABS = [
  {
    key: "study", icon: "◈",
    title: "An interactive Study",
    desc: "Every mistake becomes a puzzle you solve — not a paragraph you skim.",
    render: () => (
      <>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          {[
            { n: 24, label: "Best", color: "var(--clr-best)" },
            { n: 6, label: "Excellent", color: "var(--clr-excellent)" },
            { n: 3, label: "Mistake", color: "var(--clr-mistake)" },
            { n: 1, label: "Blunder", color: "var(--clr-blunder)" },
          ].map(s => (
            <span key={s.label} style={{
              fontSize: 11, fontWeight: 700, padding: "4px 9px", borderRadius: 20,
              background: `${s.color}18`, border: `1px solid ${s.color}40`, color: s.color,
            }}>
              {s.n} {s.label}
            </span>
          ))}
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
          Key positions to study
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { badge: "??", color: "var(--clr-blunder)", label: "Blunder in Endgame", move: "Move 58" },
            { badge: "?", color: "var(--clr-mistake)", label: "Missed Counterplay", move: "Move 25" },
          ].map(m => (
            <div key={m.label} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              background: "var(--bg-surface)", border: "1px solid var(--border)",
              borderLeft: `3px solid ${m.color}`, borderRadius: 8, padding: "9px 12px",
            }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" }}>
                <span style={{ color: m.color }}>{m.badge}</span> {m.label} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>· {m.move}</span>
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-blue)" }}>Study ▶</span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--gold-subtle)", border: "1px solid var(--gold-border)", borderRadius: 8, padding: "9px 12px", marginTop: 2 }}>
            <span style={{ fontSize: 15 }}>🔥</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--gold)" }}>6 puzzles due for review — Start Drill →</span>
          </div>
        </div>
      </>
    ),
  },
  {
    key: "profile", icon: "◉",
    title: "A profile that knows your game",
    desc: "10–100 games analysed into a picture of how you actually play.",
    render: () => (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <RadarChart />
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(91,142,245,0.1)", border: "1px solid rgba(91,142,245,0.25)", borderRadius: 8, padding: "6px 12px" }}>
          <span style={{ fontSize: 14 }}>⚔</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#5b8ef5" }}>Aggressive Tactician</span>
        </div>
        <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-surface)", border: "1px solid var(--border)", borderLeft: "3px solid var(--clr-mistake)", borderRadius: 8, padding: "9px 12px" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" }}>Top mistake: Back Rank</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>−612 cp · 7×</span>
        </div>
      </div>
    ),
  },
  {
    key: "replay", icon: "🧪",
    title: "A rematch, not a re-read",
    desc: "Replay your blunder against an AI built to play like the person who beat you.",
    render: () => (
      <>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(224,82,82,0.09)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" }}>
            {"9. "}<span style={{ fontFamily: "var(--font-mono)" }}>Bxg5</span>{" "}<span style={{ color: "var(--clr-blunder)" }}>??</span>
          </span>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--clr-blunder)", opacity: 0.85 }}>−367 cp</span>
        </div>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          background: "linear-gradient(135deg, #4a7ef0 0%, #3763d6 100%)",
          borderRadius: 9, padding: "10px 13px", marginBottom: 14,
          boxShadow: "0 2px 14px rgba(59,99,214,0.4)",
        }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#fff" }}>{"🧪 Face an AI version of magnus_fan92"}</span>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{"Play it out →"}</span>
        </div>
        <div style={{ background: "rgba(34,197,94,0.12)", border: "1.5px solid rgba(34,197,94,0.4)", borderRadius: 10, padding: "11px 14px" }}>
          <p style={{ fontSize: 13, fontWeight: 800, margin: 0, color: "var(--accent-green)" }}>{"📈 +290cp better than what actually happened here"}</p>
          <p style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 3 }}>Compared to the real game at this point</p>
        </div>
      </>
    ),
  },
];

const TAB_MS = 5200;

export function FeatureShowcase() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);
  const reducedMotion = typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reducedMotion) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setRunning(entry.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [reducedMotion]);

  useEffect(() => {
    if (!running || paused || reducedMotion) return;
    const id = setTimeout(() => setActive(a => (a + 1) % TABS.length), TAB_MS);
    return () => clearTimeout(id);
  }, [running, paused, active, reducedMotion]);

  return (
    <div ref={ref}>
      <div className="text-center mb-12">
        <p style={{ color: "var(--accent-blue)", fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 10 }}>
          See it in action
        </p>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(24px, 3vw, 32px)", fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
          From report to rematch, in one place.
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-10 items-center">
        {/* Tab list */}
        <div
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          style={{ display: "flex", flexDirection: "column", gap: 4 }}
        >
          {TABS.map((t, i) => (
            <button
              key={t.key}
              onClick={() => setActive(i)}
              style={{
                display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left",
                padding: "13px 14px", borderRadius: 10, cursor: "pointer",
                background: i === active ? "var(--bg-elevated)" : "transparent",
                border: `1px solid ${i === active ? "var(--border-strong)" : "transparent"}`,
              }}
            >
              <span style={{
                fontSize: 17, width: 26, flexShrink: 0, textAlign: "center", lineHeight: "22px",
                color: i === active ? "var(--accent-blue)" : "var(--text-muted)",
                opacity: i === active ? 1 : 0.6,
              }}>
                {t.icon}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: i === active ? "var(--text-primary)" : "var(--text-secondary)", fontSize: 14, fontWeight: 700, marginBottom: 3 }}>
                  {t.title}
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 12.5, lineHeight: 1.55 }}>
                  {t.desc}
                </div>
                {/* Auto-advance progress fill — only on the active tab */}
                <div style={{ height: 2, background: "var(--border)", borderRadius: 2, marginTop: 10, overflow: "hidden" }}>
                  {i === active && (
                    <div
                      key={`${active}-${running}-${paused}`}
                      style={{
                        height: "100%", background: "var(--accent-blue)", borderRadius: 2,
                        width: reducedMotion ? "100%" : "0%",
                        animation: (!reducedMotion && running && !paused) ? `showcaseFill ${TAB_MS}ms linear forwards` : "none",
                      }}
                    />
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Demo pane */}
        <MockWindow label={`${TABS[active].icon} ${TABS[active].title}`}>
          <div key={active} className="showcase-fade">
            {TABS[active].render()}
          </div>
        </MockWindow>
      </div>

      <style>{`
        @keyframes showcaseFill { from { width: 0%; } to { width: 100%; } }
        .showcase-fade { animation: showcaseFadeIn 0.35s ease both; }
        @keyframes showcaseFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) { .showcase-fade { animation: none; } }
      `}</style>
    </div>
  );
}

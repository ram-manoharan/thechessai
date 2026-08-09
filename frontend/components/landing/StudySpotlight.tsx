import { DonutChart, PhaseArc, type DonutSlice } from "@/components/AIReport";
import { MockWindow } from "./MockWindow";

// Fabricated demo data — same shape the real Study tab renders after a game
// is analyzed (see components/GameStudy.tsx StudyPanel).
const DEMO_SLICES: DonutSlice[] = [
  { label: "Brilliant",  value: 1,  color: "var(--clr-brilliant)",  badge: "!!" },
  { label: "Best",       value: 24, color: "var(--clr-best)",       badge: "✓"  },
  { label: "Excellent",  value: 6,  color: "var(--clr-excellent)",  badge: "!"  },
  { label: "Good",       value: 10, color: "var(--clr-good)",       badge: ""   },
  { label: "Inaccuracy", value: 5,  color: "var(--clr-inaccuracy)", badge: "?!" },
  { label: "Mistake",    value: 3,  color: "var(--clr-mistake)",    badge: "?"  },
  { label: "Blunder",    value: 1,  color: "var(--clr-blunder)",    badge: "??" },
];

const DEMO_MOMENTS = [
  { badge: "??", color: "var(--clr-blunder)",  label: "Blunder in Endgame",  move: "Move 58" },
  { badge: "?",  color: "var(--clr-mistake)",  label: "Missed Counterplay",  move: "Move 25" },
];

const CALLOUTS = [
  { icon: "⛓", title: "Multi-move re-solve", desc: "Puzzles don't stop at move one — solve the real continuation, opponent reply included." },
  { icon: "✍", title: "Ask before telling", desc: "Guess why the best move works first. I score your reasoning before revealing mine." },
  { icon: "🔥", title: "In-tab drill mode", desc: "Burn through your weakest positions back-to-back, with a live streak counter." },
];

export function StudySpotlight() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
      <div>
        <p style={{ color: "var(--gold)", fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 10 }}>
          The critical piece · 01
        </p>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(24px, 3vw, 34px)", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: 14, lineHeight: 1.15 }}>
          An interactive Study,<br />not just a report.
        </h3>
        <p style={{ color: "var(--text-secondary)", fontSize: 14.5, lineHeight: 1.7, marginBottom: 24, maxWidth: 440 }}>
          Every mistake in your game becomes a puzzle you solve — not a paragraph you skim.
          The engine grades every move, the AI explains the ones that mattered, and you
          play out the correction yourself.
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

      <MockWindow label="◈ Study — respects_55 vs DrNykterstein">
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", flex: "0 0 auto" }}>
            <DonutChart slices={DEMO_SLICES} />
          </div>
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 6px", display: "flex", flex: "1 1 160px", justifyContent: "space-around" }}>
            <PhaseArc label="opening" grade="B" note="Solid setup" />
            <PhaseArc label="middlegame" grade="A" note="Sharp play" />
            <PhaseArc label="endgame" grade="D" note="Lost the thread" />
          </div>
        </div>

        <p style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
          Key positions to study
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {DEMO_MOMENTS.map(m => (
            <div
              key={m.label}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "var(--bg-surface)", border: "1px solid var(--border)",
                borderLeft: `3px solid ${m.color}`, borderRadius: 8, padding: "9px 12px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" }}>
                  <span style={{ color: m.color }}>{m.badge}</span>{" "}{m.label}
                </span>
                <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{m.move}</span>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-blue)" }}>Study ▶</span>
            </div>
          ))}
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10,
              background: "var(--gold-subtle)", border: "1px solid var(--gold-border)",
              borderRadius: 8, padding: "9px 12px", marginTop: 2,
            }}
          >
            <span style={{ fontSize: 15 }}>🔥</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--gold)" }}>6 puzzles due for review — Start Drill →</span>
          </div>
        </div>
      </MockWindow>
    </div>
  );
}

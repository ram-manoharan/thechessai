"use client";

const ROWS: { generic: string; ours: string; oursDesc: string }[] = [
  {
    generic: "One-shot report, then forgotten",
    ours: "Recurrence Engine",
    oursDesc: "A mistake that repeats across games gets caught and flagged — not noted once and lost.",
  },
  {
    generic: "Spar against a generic engine",
    ours: "Opponent-accurate replay",
    oursDesc: "Rematch the exact opponent — their rating, style, and the real mistakes they made in this game.",
  },
  {
    generic: "Generic tactics trainer",
    ours: "Puzzles built from you",
    oursDesc: "Drawn from your own recurring errors, and credited when you find a genuinely strong alternate.",
  },
  {
    generic: "A single score per game",
    ours: "A profile that compounds",
    oursDesc: "Every game sharpens the picture — nine dimensions of how you actually play, not a one-off number.",
  },
];

/** Landing-page differentiation table: what conventional chess-AI tools do
 * vs. what this platform does instead. Deliberately generic on the left
 * ("most chess AI") rather than naming competitors. */
export function DifferentiationTable() {
  return (
    <div>
      {/* Column headers — desktop only, mobile stacks so they'd float alone */}
      <div
        className="hidden sm:grid gap-5 mb-3"
        style={{ gridTemplateColumns: "1fr 1.4fr" }}
      >
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
          Most chess AI
        </p>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--gold)" }}>
          thechess.ai
        </p>
      </div>

      <div className="flex flex-col">
        {ROWS.map((r, i) => (
          <div
            key={r.ours}
            className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr] gap-3 sm:gap-5 items-center"
            style={{
              padding: "16px 0",
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13.5 }}>
              <span style={{ opacity: 0.5, flexShrink: 0 }}>—</span>
              {r.generic}
            </div>
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                background: "var(--gold-subtle)",
                border: "1px solid var(--gold-border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <span style={{ color: "var(--gold)", fontSize: 13 }}>✓</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>{r.ours}</span>
              </div>
              <p style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.55, margin: 0 }}>
                {r.oursDesc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

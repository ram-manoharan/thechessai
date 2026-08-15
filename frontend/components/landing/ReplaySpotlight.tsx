import { MockWindow } from "./MockWindow";

const CALLOUTS = [
  { icon: "🎯", title: "An AI version of your opponent", desc: "Not a generic engine pretending to be weak — a model trained on millions of real human games, matched to their exact rating." },
  { icon: "🧬", title: "Even their own mistakes", desc: "Biased toward the specific blunders that opponent actually made in this game, not just their rating band on average." },
  { icon: "📈", title: "Watch the eval swing live", desc: "Every reply compared against what actually happened in the real game — so \"what if\" isn't a guess, it's a number." },
];

export function ReplaySpotlight() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
      <div>
        <p style={{ color: "var(--accent-blue)", fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 10 }}>
          The critical piece · 03
        </p>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(24px, 3vw, 34px)", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: 14, lineHeight: 1.15 }}>
          Every blunder deserves<br />a rematch.
        </h3>
        <p style={{ color: "var(--text-secondary)", fontSize: 14.5, lineHeight: 1.7, marginBottom: 24, maxWidth: 440 }}>
          Land on the move that lost you the game and a single tap replays it — against
          an AI built to play like the person who actually beat you, not Stockfish
          throttled down to pretend it&apos;s weak.
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

      <MockWindow label="🧪 What if? — Replaying from move 9">
        {/* The blunder, exactly as it reads in the real move list */}
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: "rgba(224,82,82,0.09)", border: "1px solid rgba(224,82,82,0.3)",
            borderRadius: 8, padding: "8px 12px", marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" }}>
            {"9. "}<span style={{ fontFamily: "var(--font-mono)" }}>Bxg5</span>{" "}
            <span style={{ color: "var(--clr-blunder)" }}>??</span>
          </span>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--clr-blunder)", opacity: 0.85 }}>
            −367 cp
          </span>
        </div>

        {/* The real CTA, recreated at true colour */}
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
            background: "linear-gradient(135deg, #4a7ef0 0%, #3763d6 100%)",
            borderRadius: 9, padding: "10px 13px", marginBottom: 14,
            boxShadow: "0 2px 14px rgba(59,99,214,0.4)",
          }}
        >
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#fff" }}>
            {"🧪 Face an AI version of magnus_fan92"}
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
            {"Play it out →"}
          </span>
        </div>

        <p style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
          Three moves later
        </p>

        {/* The payoff — the eval comparison card, at true colour */}
        <div
          style={{
            background: "rgba(34,197,94,0.12)", border: "1.5px solid rgba(34,197,94,0.4)",
            borderRadius: 10, padding: "11px 14px",
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 800, margin: 0, color: "var(--accent-green)" }}>
            {"📈 +290cp better than what actually happened here"}
          </p>
          <p style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 3 }}>
            Compared to the real game at this point in the moves
          </p>
        </div>
      </MockWindow>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { MockWindow } from "./MockWindow";

/** Fabricated demo position + Q&A — looks like the real product, isn't live
 * data. Board is a plain letter grid (uppercase = White, lowercase = Black,
 * "." = empty) rather than pulling in react-chessboard for a purely
 * decorative loop. */
const BOARD = [
  "r.bq.rk.",
  "ppp..ppp",
  "..n..n..",
  "...pN...",
  "...P....",
  "..N.....",
  "PP..BPPP",
  "R.BQ.RK.",
].map(row => row.split(""));

// The "white piece" Unicode code points (♔♕♖♗♘♙) are drawn as hollow
// outline glyphs in most fonts — no CSS color/stroke can make them solid,
// which is why white pieces kept vanishing on light squares. Using the
// solid "black piece" glyph set for both sides and coloring purely via
// CSS fixes it for real instead of cosmetically.
const PIECE_GLYPH: Record<string, string> = {
  K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

const PAIRS = [
  {
    highlight: "f6",
    q: "What if I play Nf6 instead of Bd3?",
    a: "Nf6 drops a pawn — 15.Nxf6 gxf6 wrecks your kingside and hands White the bishop pair. Bd3 keeps the tension and preps Qf3 next.",
  },
  {
    highlight: "e4",
    q: "Is Rxe4 safe here?",
    a: "No — after 22...Rxe4 23.Qd8+! Kh7 24.Qxc7 you're down an exchange for nothing. The rook was doing more good defending e7.",
  },
];

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

/** Matches CapabilityShowcase's MiniBoard: both sides render the solid
 * glyph set, so color alone now has a real filled shape to work with. */
function pieceStyle(piece: string) {
  const isWhite = piece === piece.toUpperCase();
  return isWhite
    ? {
        color: "#fbfaf6",
        WebkitTextStroke: "0.6px #241c10",
        textShadow: "0 1px 1px rgba(0,0,0,0.35)",
      }
    : {
        color: "#1c1712",
        WebkitTextStroke: "0.5px rgba(255,255,255,0.55)",
        textShadow: "0 1px 1px rgba(0,0,0,0.2)",
      };
}

function MiniBoard({ highlightSquare }: { highlightSquare: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(8, 1fr)",
        gridTemplateRows: "repeat(8, 1fr)",
        width: "100%",
        aspectRatio: "1 / 1",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid var(--border-strong)",
        boxShadow: "var(--shadow-md)",
        flexShrink: 0,
      }}
    >
      {BOARD.map((row, r) =>
        row.map((cell, c) => {
          const isLight = (r + c) % 2 === 0;
          const square = `${FILES[c]}${8 - r}`;
          const isHighlighted = square === highlightSquare;
          return (
            <div
              key={square}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: isLight ? "var(--board-light)" : "var(--board-dark)",
                fontSize: "clamp(11px, 2.6vw, 18px)",
                lineHeight: 1,
                ...(cell !== "." ? pieceStyle(cell) : null),
              }}
            >
              {isHighlighted && (
                <span
                  style={{
                    position: "absolute",
                    inset: 1,
                    borderRadius: 3,
                    border: "2px solid var(--gold)",
                    boxShadow: "0 0 8px var(--gold-glow)",
                    animation: "chat-demo-square-pulse 1.6s ease-in-out infinite",
                  }}
                />
              )}
              {cell !== "." && PIECE_GLYPH[cell]}
            </div>
          );
        }),
      )}
    </div>
  );
}

type Phase = "user-typing" | "user-hold" | "ai-typing-indicator" | "ai-typing" | "ai-hold" | "fade-out";

const prefersReducedMotion = typeof window !== "undefined"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function HeroChatDemo() {
  const [pairIndex, setPairIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>(prefersReducedMotion ? "ai-hold" : "user-typing");
  const [userText, setUserText] = useState(prefersReducedMotion ? PAIRS[0].q : "");
  const [aiText, setAiText] = useState(prefersReducedMotion ? PAIRS[0].a : "");

  useEffect(() => {
    if (prefersReducedMotion) return; // static final frame, no timers
    const pair = PAIRS[pairIndex];
    let cancelled = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const after = (ms: number, fn: () => void) => {
      const t = setTimeout(() => { if (!cancelled) fn(); }, ms);
      timers.push(t);
    };

    setUserText("");
    setAiText("");
    setPhase("user-typing");

    // Type the question out a few characters at a time.
    let ui = 0;
    const typeUser = () => {
      ui += 2;
      setUserText(pair.q.slice(0, ui));
      if (ui < pair.q.length) after(22, typeUser);
      else after(500, () => setPhase("ai-typing-indicator"));
    };
    after(300, typeUser);

    after(300 + pair.q.length * 12 + 900, () => setPhase("ai-typing"));

    let ai = 0;
    const typeAi = () => {
      ai += 3;
      setAiText(pair.a.slice(0, ai));
      if (ai < pair.a.length) after(16, typeAi);
      else after(2600, () => setPhase("fade-out"));
    };
    after(300 + pair.q.length * 12 + 1500, typeAi);

    after(300 + pair.q.length * 12 + 1500 + pair.a.length * 16 + 3100, () => {
      setPairIndex(i => (i + 1) % PAIRS.length);
    });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [pairIndex]);

  const pair = PAIRS[pairIndex];
  const showAiTyping = phase === "ai-typing-indicator";
  const fading = phase === "fade-out";

  return (
    <MockWindow label="✍ Ask the AI coach — after 14. Nd5">
      <div
        className="flex flex-col sm:flex-row"
        style={{ gap: 16, alignItems: "flex-start", opacity: fading ? 0 : 1, transition: "opacity 0.35s ease" }}
      >
        <div style={{ width: 148, flexShrink: 0, margin: "0 auto" }}>
          <MiniBoard highlightSquare={pair.highlight} />
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* User bubble */}
          <div style={{ alignSelf: "flex-end", maxWidth: "92%" }}>
            <div
              style={{
                background: "var(--gold-subtle)",
                border: "1px solid var(--gold-border)",
                borderRadius: "12px 12px 3px 12px",
                padding: "8px 12px",
                fontSize: 12.5,
                lineHeight: 1.5,
                color: "var(--text-primary)",
                minHeight: 18,
              }}
            >
              {userText}
              {(phase === "user-typing") && <span className="chat-demo-caret" />}
            </div>
          </div>

          {/* AI bubble / typing indicator */}
          {(showAiTyping || aiText) && (
            <div style={{ alignSelf: "flex-start", maxWidth: "92%" }}>
              <div
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "12px 12px 12px 3px",
                  padding: "8px 12px",
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  color: "var(--text-secondary)",
                }}
              >
                {showAiTyping ? (
                  <span style={{ display: "inline-flex", gap: 3 }}>
                    <span className="chat-demo-dot" style={{ animationDelay: "0s" }} />
                    <span className="chat-demo-dot" style={{ animationDelay: "0.15s" }} />
                    <span className="chat-demo-dot" style={{ animationDelay: "0.3s" }} />
                  </span>
                ) : (
                  <>
                    {aiText}
                    {phase === "ai-typing" && <span className="chat-demo-caret" />}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes chat-demo-square-pulse {
          0%, 100% { opacity: 0.65; }
          50%      { opacity: 1; }
        }
        @keyframes chat-demo-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        .chat-demo-caret {
          display: inline-block;
          width: 2px; height: 12px;
          background: var(--gold);
          margin-left: 2px;
          vertical-align: middle;
          animation: chat-demo-blink 0.9s step-end infinite;
        }
        @keyframes chat-demo-dot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30%           { transform: translateY(-3px); opacity: 1; }
        }
        .chat-demo-dot {
          display: inline-block;
          width: 5px; height: 5px;
          border-radius: 50%;
          background: var(--text-muted);
          animation: chat-demo-dot 1s ease-in-out infinite;
        }
      `}</style>
    </MockWindow>
  );
}

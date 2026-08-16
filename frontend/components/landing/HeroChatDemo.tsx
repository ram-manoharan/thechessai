"use client";
import { useEffect, useState } from "react";
import { MockWindow } from "./MockWindow";
import { MiniBoard, parseBoard } from "./MiniBoard";

/** Fabricated demo position + Q&A — looks like the real product, isn't live
 * data. */
const BOARD = parseBoard([
  "r.bq.rk.",
  "ppp..ppp",
  "..n..n..",
  "...pN...",
  "...P....",
  "..N.....",
  "PP..BPPP",
  "R.BQ.RK.",
]);

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
          <MiniBoard rows={BOARD} rings={{ [pair.highlight]: "var(--gold)" }} size={148} />
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

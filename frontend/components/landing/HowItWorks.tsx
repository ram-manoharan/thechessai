"use client";
import { useEffect, useRef, useState } from "react";

const PIPELINE = [
  {
    icon: "♞",
    step: "01",
    title: "Play your games",
    desc: "OTB, tournaments, or online — every game you play is worth learning from.",
    color: "var(--gold)",
    bg: "var(--gold-subtle)",
    border: "1px solid var(--gold-border)",
  },
  {
    icon: "🔑",
    step: "02",
    title: "Bring it to thechess.ai",
    desc: "Sign in free and feed in the game — paste a PGN, or pull it straight from Lichess or Chess.com.",
    color: "var(--text-muted)",
    bg: "var(--bg-surface)",
    border: "1px solid var(--border-strong)",
  },
  {
    icon: "◈",
    step: "03",
    title: "Engine + AI analyse it",
    desc: "Stockfish grades every move, then the AI coach explains what happened and why.",
    color: "var(--accent-blue)",
    bg: "rgba(91,142,245,0.08)",
    border: "1px solid rgba(91,142,245,0.28)",
  },
  {
    icon: "🧩",
    step: "04",
    title: "Study, solve, replay it",
    desc: "Every mistake becomes a puzzle — or a rematch against an AI built to play like the opponent who beat you.",
    color: "var(--gold)",
    bg: "var(--gold-subtle)",
    border: "1px solid var(--gold-border)",
  },
  {
    icon: "◉",
    step: "05",
    title: "Your profile grows",
    desc: "Feed in more games and a detailed picture forms — how you actually play, not a single number.",
    color: "var(--accent-blue)",
    bg: "rgba(91,142,245,0.08)",
    border: "1px solid rgba(91,142,245,0.28)",
  },
  {
    icon: "🎯",
    step: "06",
    title: "Know what to work on",
    desc: "Your top recurring mistake, weakest phase, and a focus plan — all built from your own games.",
    color: "var(--gold)",
    bg: "var(--gold-subtle)",
    border: "1px solid var(--gold-border)",
  },
];

const COLS = 3;
const STEP_MS = 2000;

export function HowItWorks() {
  const reducedMotion = typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);
  const [looped, setLooped] = useState(false);

  // Only start the auto-advance once the section is actually on screen.
  useEffect(() => {
    if (reducedMotion) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setRunning(entry.isIntersecting),
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reducedMotion]);

  useEffect(() => {
    if (!running || reducedMotion) return;
    const id = setInterval(() => {
      setActive(a => {
        const next = (a + 1) % PIPELINE.length;
        if (next === 0) {
          setLooped(true);
          setTimeout(() => setLooped(false), 900);
        }
        return next;
      });
    }, STEP_MS);
    return () => clearInterval(id);
  }, [running, reducedMotion]);

  return (
    <div ref={ref}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-12">
        {PIPELINE.map((step, i) => {
          const isActive = !reducedMotion && i === active;
          const sameRowNext = i % COLS !== COLS - 1;
          return (
            <div key={i} style={{ textAlign: "center", position: "relative" }}>
              {/* Connector line to next step in the same row (desktop only) */}
              {sameRowNext && i < PIPELINE.length - 1 && (
                <div
                  className="hidden sm:block"
                  style={{
                    position: "absolute", top: 20, left: "calc(50% + 24px)", right: "calc(-50% + 24px)",
                    height: 1, background: "var(--border)", zIndex: 0, overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: !reducedMotion && i < active ? "100%" : "0%",
                      background: "var(--gold)",
                      transition: "width 0.4s ease",
                    }}
                  />
                </div>
              )}
              {/* Icon circle */}
              <div
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 44, height: 44, borderRadius: "50%",
                  background: step.bg, border: step.border,
                  margin: "0 auto 14px", fontSize: 18, position: "relative", zIndex: 1,
                  color: step.color,
                  transform: isActive ? "scale(1.16)" : "scale(1)",
                  boxShadow: isActive ? `0 0 0 4px var(--gold-glow)` : "none",
                  transition: "transform 0.4s cubic-bezier(0.2,0.7,0.2,1), box-shadow 0.4s ease",
                }}
              >
                {step.icon}
              </div>
              <p style={{ color: step.color, fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>Step {step.step}</p>
              <p style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 14, marginBottom: 5 }}>{step.title}</p>
              <p style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6, maxWidth: 240, margin: "0 auto" }}>{step.desc}</p>
            </div>
          );
        })}
      </div>

      {/* Loop-closing banner — this is a cycle, not a one-time report */}
      <div
        style={{
          marginTop: 40,
          padding: "18px 28px",
          borderRadius: 14,
          background: "var(--gold-subtle)",
          border: "1px solid var(--gold-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          textAlign: "center",
          flexWrap: "wrap",
          boxShadow: looped && !reducedMotion ? "0 0 0 4px var(--gold-glow)" : "none",
          transition: "box-shadow 0.5s ease",
        }}
      >
        <span
          style={{
            fontSize: 20,
            color: "var(--gold)",
            display: "inline-block",
            transform: looped && !reducedMotion ? "rotate(360deg)" : "rotate(0deg)",
            transition: "transform 0.8s cubic-bezier(0.3,0.7,0.3,1)",
          }}
        >
          ↻
        </span>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 560 }}>
          <strong style={{ color: "var(--text-primary)" }}>Repeat it with your next game.</strong>{" "}
          This isn&apos;t a one-time report — it&apos;s a loop. The more games you feed it, the sharper your profile gets, and the faster you improve.
        </p>
      </div>
    </div>
  );
}

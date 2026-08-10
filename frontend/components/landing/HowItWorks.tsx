"use client";
import { useEffect, useRef, useState } from "react";

const PIPELINE = [
  {
    icon: "🔑",
    step: "Step 1",
    title: "Sign in free",
    desc: "Google in one click, or create a free username. No spam.",
    color: "var(--gold)",
    bg: "var(--gold-subtle)",
    border: "1px solid var(--gold-border)",
  },
  {
    icon: "♟",
    step: "Step 2",
    title: "Import your game",
    desc: "Paste a PGN or fetch directly from Lichess or Chess.com.",
    color: "var(--text-muted)",
    bg: "var(--bg-surface)",
    border: "1px solid var(--border-strong)",
  },
  {
    icon: "◈",
    step: "Step 3",
    title: "Stockfish + AI evaluate",
    desc: "Engine analyses every position at depth 12, then the AI writes your report.",
    color: "var(--accent-blue)",
    bg: "rgba(91,142,245,0.08)",
    border: "1px solid rgba(91,142,245,0.28)",
  },
  {
    icon: "◉",
    step: "Step 4",
    title: "Study & track your profile",
    desc: "Solve the puzzles it found you, and watch your profile evolve over time.",
    color: "var(--gold)",
    bg: "var(--gold-subtle)",
    border: "1px solid var(--gold-border)",
  },
];

const STEP_MS = 2200;

export function HowItWorks() {
  const reducedMotion = typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);

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
    const id = setInterval(() => setActive(a => (a + 1) % PIPELINE.length), STEP_MS);
    return () => clearInterval(id);
  }, [running, reducedMotion]);

  return (
    <div ref={ref} className="grid grid-cols-1 sm:grid-cols-4 gap-8">
      {PIPELINE.map((step, i) => {
        const isActive = !reducedMotion && i === active;
        return (
          <div key={i} style={{ textAlign: "center", position: "relative" }}>
            {/* Connector line on desktop */}
            {i < PIPELINE.length - 1 && (
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
            <p style={{ color: step.color, fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>{step.step}</p>
            <p style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 14, marginBottom: 5 }}>{step.title}</p>
            <p style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>{step.desc}</p>
          </div>
        );
      })}
    </div>
  );
}

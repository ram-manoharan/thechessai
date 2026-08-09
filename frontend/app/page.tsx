import { Navbar } from "@/components/Navbar";
import { NeuralCanvas } from "@/components/NeuralCanvas";
import { HeroCTA } from "@/components/landing/HeroCTA";
import { Reveal } from "@/components/landing/Reveal";
import { StudySpotlight } from "@/components/landing/StudySpotlight";
import { ProfileSpotlight } from "@/components/landing/ProfileSpotlight";

const FEATURES = [
  {
    icon: "◈",
    title: "Move-by-Move Analysis",
    desc: "Every move graded: brilliant, best, excellent, inaccuracy, mistake, blunder — with centipawn precision.",
    accent: "var(--clr-brilliant)",
    isAI: false,
  },
  {
    icon: "◎",
    title: "Accuracy Score",
    desc: "Your game accuracy calculated by the same formula chess.com uses. Know exactly how well you played.",
    accent: "var(--gold)",
    isAI: false,
  },
  {
    icon: "✦",
    title: "AI Coaching Report",
    desc: "I'll write you a personalised coaching report: phase grades, key moments, tactical patterns, and your study plan.",
    accent: "var(--gold)",
    isAI: true,
  },
  {
    icon: "✍",
    title: "Ask Before Telling",
    desc: "Guess why the best move works before I reveal it. Active recall beats passively reading an answer.",
    accent: "var(--accent-blue)",
    isAI: true,
  },
  {
    icon: "🔥",
    title: "In-Tab Drill Mode",
    desc: "Solve your queued weaknesses back-to-back, streak counter running, without ever leaving Study.",
    accent: "var(--gold)",
    isAI: false,
  },
  {
    icon: "∿",
    title: "Evaluation Graph",
    desc: "A live advantage chart across every move. Click any point to jump straight to that position.",
    accent: "var(--accent-blue)",
    isAI: false,
  },
  {
    icon: "◉",
    title: "Player Profile",
    desc: "I'll analyse 10–100 of your games to reveal patterns, opening tendencies, and hidden weaknesses.",
    accent: "var(--gold)",
    isAI: true,
  },
  {
    icon: "🧬",
    title: "Mistake Fingerprint",
    desc: "The tactical and positional patterns that cost you the most, tracked as a trend, not a one-off list.",
    accent: "var(--clr-mistake)",
    isAI: true,
  },
  {
    icon: "⚖",
    title: "Peer Benchmarking",
    desc: "See what players at your exact rating play in this position, straight from the Lichess database.",
    accent: "var(--accent-blue)",
    isAI: false,
  },
];

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

export default function Home() {
  return (
    <>
      <Navbar />

      <main style={{ background: "var(--bg-base)" }} className="min-h-screen">

        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden chess-grid">
          {/* Animated AI neural network background */}
          <NeuralCanvas />
          {/* Gradient overlay on top of chess grid */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: [
                "radial-gradient(ellipse 90% 70% at 50% -5%, rgba(201,162,68,0.07) 0%, transparent 55%)",
                "radial-gradient(ellipse 60% 50% at 15% 60%, rgba(91,142,245,0.04) 0%, transparent 50%)",
                "linear-gradient(to bottom, transparent 60%, var(--bg-base) 100%)",
              ].join(", "),
            }}
          />

          <div className="relative max-w-3xl mx-auto px-6 pt-24 pb-20 text-center">

            {/* Badge */}
            <div
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold mb-8 uppercase tracking-widest"
              style={{
                background: "var(--gold-subtle)",
                color: "var(--gold-light)",
                border: "1px solid var(--gold-border)",
              }}
            >
              <span style={{
                display: "inline-block", width: 6, height: 6,
                background: "var(--clr-best)", borderRadius: "50%",
                animation: "ai-ready-pulse 2s ease-in-out infinite",
              }} />
              {"AI Ready · Stockfish · Deep Analysis"}
            </div>

            {/* Display headline */}
            <h1
              className="mb-6"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "clamp(42px, 7vw, 76px)",
                lineHeight: 1.08,
                letterSpacing: "-0.02em",
                color: "var(--text-primary)",
                textWrap: "balance",
              }}
            >
              Every move tells<br />
              <em className="text-gold-gradient not-italic">a story.</em>
            </h1>

            <p
              className="mb-10 mx-auto"
              style={{
                color: "var(--text-secondary)",
                fontSize: "clamp(15px, 2vw, 18px)",
                lineHeight: 1.65,
                maxWidth: 520,
              }}
            >
              Sign in free, import a game from Lichess or Chess.com, and get instant
              Stockfish analysis, an interactive Study to drill your mistakes, and a
              profile that learns how you actually play.
            </p>

            <HeroCTA />

          </div>
        </section>

        {/* ── Divider ────────────────────────────────────────────────────── */}
        <div className="max-w-4xl mx-auto px-6">
          <div className="divider-gold" />
        </div>

        {/* ── Spotlight: Interactive Study ─────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-6 py-20">
          <Reveal>
            <StudySpotlight />
          </Reveal>
        </section>

        {/* ── Spotlight: Player Profiling ──────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-6 py-6 pb-20">
          <Reveal>
            <ProfileSpotlight />
          </Reveal>
        </section>

        {/* ── Divider ────────────────────────────────────────────────────── */}
        <div className="max-w-4xl mx-auto px-6">
          <div className="divider-gold" />
        </div>

        {/* ── Feature grid ─────────────────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-6 py-20">
          <Reveal>
            <div className="text-center mb-12">
              <p
                style={{
                  color: "var(--gold)",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                Capabilities
              </p>
              <h2
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "clamp(24px, 3vw, 32px)",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  letterSpacing: "-0.02em",
                }}
              >
                Everything you need to improve
              </h2>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={Math.min(i, 5) * 0.05}>
                <div
                  className="card card-hover group p-6 flex flex-col gap-3 feature-card"
                  style={{
                    position: "relative", overflow: "hidden", height: "100%",
                    "--icon-accent": f.accent,
                    borderTop: f.isAI ? "2px solid rgba(201,162,68,0.55)" : undefined,
                  } as React.CSSProperties}
                >
                  {/* Scan-line sweep on hover */}
                  <div className="feature-scan-line" />

                  {/* AI corner pill */}
                  {f.isAI && (
                    <div style={{
                      position: "absolute", top: 11, right: 11,
                      background: "var(--gold-subtle)",
                      border: "1px solid var(--gold-border)",
                      borderRadius: 5,
                      fontSize: 8, fontWeight: 800, letterSpacing: "0.1em",
                      color: "var(--gold)", padding: "2px 7px",
                    }}>{"AI"}</div>
                  )}

                  {/* Icon */}
                  <div
                    className="feature-icon"
                    style={{
                      color: f.accent,
                      fontSize: 22,
                      lineHeight: 1,
                      fontWeight: 300,
                      opacity: 0.85,
                      transition: "transform 0.25s ease, filter 0.25s ease, opacity 0.25s ease",
                      display: "inline-block",
                    }}
                  >
                    {f.icon}
                  </div>

                  <h3
                    style={{
                      color: "var(--text-primary)",
                      fontSize: 14,
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {f.title}
                  </h3>
                  <p
                    style={{
                      color: "var(--text-muted)",
                      fontSize: 13,
                      lineHeight: 1.6,
                    }}
                  >
                    {f.desc}
                  </p>

                  {/* Bottom accent line on hover */}
                  <div
                    style={{
                      marginTop: "auto",
                      height: 1,
                      background: "linear-gradient(90deg, " + f.accent + "55, transparent)",
                      opacity: 0,
                      transition: "opacity 0.25s ease",
                    }}
                    className="group-hover:opacity-100"
                  />
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <section className="max-w-4xl mx-auto px-6 py-14">
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 36 }}>
              <p style={{ color: "var(--accent-blue)", fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 8 }}>
                How it works
              </p>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(20px, 2.5vw, 26px)", fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
                From sign-in to insight, four steps.
              </h2>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-8">
            {PIPELINE.map((step, i) => (
              <div key={i} style={{ textAlign: "center", position: "relative" }}>
                {/* Connector line on desktop */}
                {i < PIPELINE.length - 1 && (
                  <div className="hidden sm:block" style={{ position: "absolute", top: 20, left: "calc(50% + 24px)", right: "calc(-50% + 24px)", height: 1, background: "var(--border)", zIndex: 0 }} />
                )}
                {/* Icon circle */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 44, height: 44, borderRadius: "50%",
                  background: step.bg, border: step.border,
                  margin: "0 auto 14px", fontSize: 18, position: "relative", zIndex: 1,
                  color: step.color,
                }}>
                  {step.icon}
                </div>
                <p style={{ color: step.color, fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>{step.step}</p>
                <p style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 14, marginBottom: 5 }}>{step.title}</p>
                <p style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Final CTA band ───────────────────────────────────────────── */}
        <section className="max-w-3xl mx-auto px-6 py-16 text-center">
          <Reveal>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(22px, 3vw, 30px)", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: 12 }}>
              Ready to see your chess clearly?
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.65, marginBottom: 26, maxWidth: 420, marginInline: "auto" }}>
              Free to use. No credit card. Your first analysed game is a minute away.
            </p>
            <HeroCTA />
          </Reveal>
        </section>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <footer
          style={{
            borderTop: "1px solid var(--border)",
            padding: "28px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 1, fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>
            <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 13 }}>the</span>
            <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>chess</span>
            <span style={{ fontStyle: "italic", color: "var(--gold)" }}>.ai</span>
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.04em" }}>
            {"Powered by Stockfish · AI coaching · Built for chess learners"}
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.02em", marginTop: 4 }}>
            {"Created by Ram SM · "}
            <a href="mailto:ramengineer2006@gmail.com" style={{ color: "var(--gold)", textDecoration: "none" }} className="hover:opacity-80">
              ramengineer2006@gmail.com
            </a>
          </p>
        </footer>
      </main>

      <style>{`
        @keyframes ai-ready-pulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50%       { opacity: 1;   transform: scale(1.35); }
        }
        .feature-card:hover .feature-icon {
          opacity: 1;
          transform: scale(1.18);
          filter: drop-shadow(0 0 7px var(--icon-accent));
        }
        .feature-scan-line {
          position: absolute;
          top: 0; left: -50%; width: 45%; height: 100%;
          background: linear-gradient(90deg, transparent, var(--tint-surface), transparent);
          pointer-events: none;
          opacity: 0;
          transition: opacity 0s;
        }
        .feature-card:hover .feature-scan-line {
          animation: feature-scan 0.55s ease-out forwards;
        }
        @keyframes feature-scan {
          0%   { left: -50%; opacity: 0; }
          8%   { opacity: 1; }
          90%  { opacity: 1; }
          100% { left: 110%; opacity: 0; }
        }
        .feature-card:hover {
          border-color: color-mix(in srgb, var(--icon-accent) 35%, var(--border));
        }
      `}</style>
    </>
  );
}

import { Navbar } from "@/components/Navbar";
import { NeuralCanvas } from "@/components/NeuralCanvas";
import { HeroCTA } from "@/components/landing/HeroCTA";
import { Reveal } from "@/components/landing/Reveal";
import { StudySpotlight } from "@/components/landing/StudySpotlight";
import { ProfileSpotlight } from "@/components/landing/ProfileSpotlight";
import { HeroChatDemo } from "@/components/landing/HeroChatDemo";
import { HowItWorks } from "@/components/landing/HowItWorks";

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
  {
    icon: "⬇",
    title: "AI-Annotated PGN Export",
    desc: "Download your analysed game as a fully annotated PGN — NAG symbols, engine evals, and AI coaching notes embedded. Open it in Chessbase, Lichess, or any chess software for offline study.",
    accent: "var(--gold)",
    isAI: true,
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

            <div className="mt-14 mx-auto text-left" style={{ maxWidth: 480 }}>
              <Reveal delay={0.15}>
                <HeroChatDemo />
              </Reveal>
            </div>

          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-6 pt-4 pb-14">
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 36 }}>
              <p style={{ color: "var(--accent-blue)", fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 8 }}>
                How it works
              </p>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(20px, 2.5vw, 26px)", fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
                From your next game to real improvement.
              </h2>
            </div>
          </Reveal>

          <HowItWorks />
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
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 20, marginTop: 6, flexWrap: "wrap",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <p style={{ color: "var(--gold)", fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 4 }}>
                Creator
              </p>
              <p style={{ color: "var(--text-secondary)", fontSize: 12, fontWeight: 600, marginBottom: 2 }}>
                Ram SM
              </p>
              <a href="mailto:ramengineer2006@gmail.com" style={{ color: "var(--text-muted)", fontSize: 11, textDecoration: "none" }} className="hover:opacity-80">
                ramengineer2006@gmail.com
              </a>
            </div>

            <span style={{ color: "var(--gold)", fontSize: 22, lineHeight: 1 }} aria-hidden="true">♛</span>

            <div style={{ textAlign: "center" }}>
              <p style={{ color: "var(--gold)", fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 4 }}>
                Chess Advisor
              </p>
              <p style={{ color: "var(--text-secondary)", fontSize: 12, fontWeight: 600, marginBottom: 2 }}>
                Savetha CH
              </p>
              <p style={{ color: "var(--text-muted)", fontSize: 11 }}>
                WCM · FIDE: 5042224
              </p>
            </div>
          </div>
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

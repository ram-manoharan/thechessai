"use client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { Chess } from "chess.js";
import type { PieceDropHandlerArgs } from "react-chessboard";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { useGameStore } from "@/lib/store";
import {
  fetchPuzzles, getPuzzleQueue, getMistakeFingerprint, recordPuzzleProgress,
  getPuzzleStats,
  type PuzzleData, type MistakeTheme, type PuzzleStats,
} from "@/lib/api";
import { THEME_GLOSSARY } from "@/lib/chess-utils";

/** Adapts a queued puzzle (cross-game, theme-tagged) into the same shape the
 * existing single-game puzzle solver already renders — reuses all of the
 * solving UI below without a parallel implementation. */
function queuedToPuzzleData(q: { fen: string; best_move_san: string; continuation: string[]; theme: string; cp_loss: number; phase: string; game_white: string; game_black: string; game_date: string }): PuzzleData {
  const sideToMove = q.fen.split(" ")[1] === "b" ? "Black" : "White";
  return {
    fen: q.fen,
    move_number: 0,
    color: sideToMove,
    played_san: "",
    best_move_san: q.best_move_san,
    continuation: q.continuation,
    classification: q.theme,
    cp_loss: q.cp_loss,
    phase: q.phase,
    theme: q.theme,
    game_white: q.game_white,
    game_black: q.game_black,
    game_date: q.game_date,
  };
}

const Chessboard = dynamic(
  () => import("react-chessboard").then(m => m.Chessboard),
  { ssr: false, loading: () => <div style={{ aspectRatio: "1/1", background: "var(--bg-elevated)" }} className="rounded-lg animate-pulse" /> }
);

const CLF_COLORS: Record<string, string> = {
  "Blunder":    "var(--clr-blunder)",
  "Mistake":    "var(--clr-mistake)",
  "Inaccuracy": "var(--clr-inaccuracy)",
};

/** Tiny inline cp_loss trend line for a mistake-fingerprint theme — makes the
 * fingerprint a visible trend (getting worse/better at this pattern over the
 * last few occurrences) rather than a static ranked list. Needs at least 2
 * points to draw a meaningful line; renders nothing below that. */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const w = 64, h = 20, pad = 2;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });
  const last = points[points.length - 1].split(",");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", flexShrink: 0 }}>
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.75} />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}

type SolveState = "idle" | "correct" | "wrong" | "shown";

type PuzzleSource = "game" | "queue";

export default function PuzzlesPage() {
  const pgn         = useGameStore(s => s.pgn);
  const playerColor = useGameStore(s => s.playerColor);
  const { status: sessionStatus } = useSession();
  const signedIn = sessionStatus === "authenticated";

  const [source,         setSource]         = useState<PuzzleSource>("game");
  const [puzzles,        setPuzzles]        = useState<PuzzleData[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState("");
  const [puzzleIdx,      setPuzzleIdx]      = useState(0);
  const [solveState,     setSolveState]     = useState<SolveState>("idle");
  const [fen,            setFen]            = useState("");
  const [message,        setMessage]        = useState("");
  const [hintLevel,      setHintLevel]      = useState(0);
  const [themes,         setThemes]         = useState<MistakeTheme[]>([]);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionDone,    setSessionDone]    = useState(false);
  const [stats,          setStats]          = useState<PuzzleStats | null>(null);

  const chessRef    = useRef<Chess | null>(null);
  const autoAdvRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const puzzle = puzzles[puzzleIdx] ?? null;

  const initPuzzle = useCallback((p: PuzzleData) => {
    chessRef.current = new Chess(p.fen);
    setFen(p.fen);
    setSolveState("idle");
    setHintLevel(0);
    setMessage(`Find the best move for ${p.color}.`);
  }, []);

  const SESSION_GOAL = 5;

  useEffect(() => {
    if (source === "queue") {
      if (!signedIn) return;
      setLoading(true);
      setError("");
      setSessionCorrect(0);
      setSessionDone(false);
      Promise.all([getPuzzleQueue(SESSION_GOAL), getMistakeFingerprint(3), getPuzzleStats()])
        .then(([q, fp, st]) => {
          const mapped = q.puzzles.map(queuedToPuzzleData);
          setPuzzles(mapped);
          setThemes(fp.themes);
          setStats(st);
          setLoading(false);
          if (mapped.length > 0) initPuzzle(mapped[0]);
        })
        .catch(e => { setError((e as Error).message); setLoading(false); });
      return;
    }

    if (!pgn) return;
    setLoading(true);
    setError("");
    fetchPuzzles(pgn, playerColor)
      .then(r => {
        setPuzzles(r.puzzles);
        setLoading(false);
        if (r.puzzles.length > 0) {
          initPuzzle(r.puzzles[0]);
        }
      })
      .catch(e => {
        setError((e as Error).message);
        setLoading(false);
      });
  }, [pgn, playerColor, source, signedIn, initPuzzle]);

  const goToPuzzle = useCallback((idx: number) => {
    if (!puzzles[idx]) return;
    setPuzzleIdx(idx);
    initPuzzle(puzzles[idx]);
  }, [puzzles, initPuzzle]);

  const onPieceDrop = useCallback(
    ({ sourceSquare: from, targetSquare: toOrNull }: PieceDropHandlerArgs) => {
    if (!chessRef.current || !puzzle || !toOrNull) return false;
    const to = toOrNull;
    if (solveState !== "idle") return false;

    try {
      const move = chessRef.current.move({ from, to, promotion: "q" });
      if (!move) return false;
    } catch (_e) {
      return false;
    }

    const played = chessRef.current.history({ verbose: true }).slice(-1)[0];
    const playedSan = played?.san ?? "";

    setFen(chessRef.current.fen());

    const isCorrect = playedSan === puzzle.best_move_san
      || `${from}${to}` === puzzle.best_move_san.toLowerCase().replace(/[^a-h1-8]/g, "");

    if (isCorrect) {
      setSolveState("correct");
      setMessage(`Correct! Best move was ${puzzle.best_move_san}`);
      if (source === "queue") {
        recordPuzzleProgress(puzzle.fen, true).catch(() => {});
        setSessionCorrect(n => n + 1);
        // auto-advance after brief celebration
        if (autoAdvRef.current) clearTimeout(autoAdvRef.current);
        autoAdvRef.current = setTimeout(() => {
          if (puzzleIdx + 1 < puzzles.length) {
            goToPuzzle(puzzleIdx + 1);
          } else {
            setSessionDone(true);
            setStats(prev => prev ? { ...prev, today_solved: prev.today_solved + 1 } : prev);
          }
        }, 1600);
      }
    } else {
      setSolveState("wrong");
      setMessage(`Not quite. You played ${playedSan}; best was ${puzzle.best_move_san}.`);
      if (source === "queue") {
        recordPuzzleProgress(puzzle.fen, false).catch(() => {});
      }
    }
    return true;
  }, [puzzle, solveState, source, puzzleIdx, puzzles, goToPuzzle]); // eslint-disable-line

  const showSolution = useCallback(() => {
    if (!puzzle || !chessRef.current) return;
    try {
      chessRef.current = new Chess(puzzle.fen);
      chessRef.current.move(puzzle.best_move_san);
      setFen(chessRef.current.fen());
    } catch (_e) {
      // best_move_san might be in uci format
    }
    setSolveState("shown");
    setMessage(`Best move: ${puzzle.best_move_san} — continuing: ${puzzle.continuation.slice(0, 3).join(", ")}`);
    if (source === "queue") {
      recordPuzzleProgress(puzzle.fen, false).catch(() => {});
    }
  }, [puzzle, source]);

  // Compute hint square highlights using chess.js to parse from/to
  const hintSquares = useMemo<Record<string, { backgroundColor: string }>>(() => {
    if (hintLevel === 0 || !puzzle) return {};
    try {
      const chess = new Chess(puzzle.fen);
      const result = chess.move(puzzle.best_move_san);
      if (!result) return {};
      const squares: Record<string, { backgroundColor: string }> = {};
      if (hintLevel >= 1) squares[result.from] = { backgroundColor: "rgba(201,162,68,0.72)" };
      if (hintLevel >= 2) squares[result.to]   = { backgroundColor: "rgba(201,162,68,0.88)" };
      return squares;
    } catch (_e) { return {}; }
  }, [hintLevel, puzzle]);

  const isPlayerTurn = puzzle
    ? (puzzle.color === "White") === (playerColor === "white")
    : true;
  void isPlayerTurn;

  return (
    <>
      <Navbar />
      <main style={{ background: "var(--bg-base)", minHeight: "100vh" }} className="px-4 py-8 max-w-5xl mx-auto">
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Link
              href="/analyze"
              style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" }}
              className="hover:text-[var(--gold)] transition-colors"
            >
              {"← Analysis"}
            </Link>
            <span style={{ color: "var(--border)" }}>|</span>
            <span style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>Your Puzzles</span>
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "clamp(22px, 3vw, 32px)", color: "var(--text-primary)" }}>
            Learn from your <em className="text-gold-gradient not-italic">mistakes.</em>
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>
            {source === "queue"
              ? "Spaced-repetition practice from your own recurring mistakes, across every game you've analyzed."
              : "Puzzles generated from positions where you made significant errors."}
          </p>
        </div>

        {signedIn && (
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {([["game", "This Game"], ["queue", "◆ Daily Practice"]] as [PuzzleSource, string][]).map(([s, label]) => (
              <button
                key={s}
                onClick={() => { setSource(s); setPuzzleIdx(0); }}
                style={{
                  padding: "7px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                  fontWeight: source === s ? 700 : 400,
                  background: source === s ? "var(--gold-subtle)" : "var(--bg-elevated)",
                  color: source === s ? "var(--gold)" : "var(--text-muted)",
                  border: source === s ? "1px solid var(--gold-border)" : "1px solid var(--border)",
                  transition: "all 0.15s",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* ── Daily Practice stats header ─────────────────────────────────── */}
        {source === "queue" && stats && !sessionDone && (
          <div className="card" style={{ padding: "14px 18px", marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
              {/* Streak */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 20, lineHeight: 1 }}>🔥</span>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                    {stats.daily_streak}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.05em" }}>
                    {stats.daily_streak === 1 ? "day streak" : "day streak"}
                  </div>
                </div>
              </div>
              {/* Divider */}
              <div style={{ width: 1, height: 32, background: "var(--border)", flexShrink: 0 }} />
              {/* Today's progress */}
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Today</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
                    {Math.min(stats.today_solved + sessionCorrect, stats.session_goal)}/{stats.session_goal}
                  </span>
                </div>
                <div style={{ height: 6, background: "var(--bg-elevated)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.min(100, ((stats.today_solved + sessionCorrect) / stats.session_goal) * 100)}%`,
                    background: "linear-gradient(90deg, var(--accent-blue), var(--gold))",
                    borderRadius: 3,
                    transition: "width 0.4s ease",
                  }} />
                </div>
              </div>
              {/* Divider */}
              <div style={{ width: 1, height: 32, background: "var(--border)", flexShrink: 0 }} />
              {/* Total */}
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                  {stats.total_solved}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.05em" }}>total solved</div>
              </div>
            </div>
          </div>
        )}

        {source === "queue" && themes.length > 0 && !sessionDone && (
          <div className="card" style={{ padding: "14px 18px", marginBottom: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--gold)" }}>
              Your top patterns
            </span>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {themes.map(t => (
                <span
                  key={t.theme}
                  title={THEME_GLOSSARY[t.theme] ?? undefined}
                  style={{
                    fontSize: 12, color: "#5b8ef5", background: "rgba(91,142,245,0.1)",
                    border: "1px solid rgba(91,142,245,0.25)", borderRadius: 8,
                    padding: "5px 10px", display: "flex", alignItems: "center", gap: 8,
                    cursor: THEME_GLOSSARY[t.theme] ? "help" : "default",
                  }}
                >
                  <strong>{t.theme}</strong>
                  <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                    {"−"}{t.total_cp_loss}{" cp · "}{t.occurrences}{"×"}
                  </span>
                  {t.sparkline && <Sparkline data={t.sparkline} color="#5b8ef5" />}
                  {!!t.recent_occurrences && (
                    <span
                      style={{
                        fontSize: 10, fontWeight: 800, color: "var(--gold)",
                        background: "var(--gold-subtle)", border: "1px solid var(--gold-border)",
                        borderRadius: 5, padding: "2px 6px", letterSpacing: "0.02em",
                      }}
                    >
                      {t.recent_occurrences}{"× this month"}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {source === "queue" && !loading && puzzles.length === 0 && !error && (
          <div className="card" style={{ padding: "28px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>♟</div>
            <p style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
              No puzzles ready yet
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.65, marginBottom: 20 }}>
              Puzzles are built from your own mistakes. Analyze a game on the Analyze page — puzzles will be
              automatically extracted and queued here for today's practice.
            </p>
            <Link href="/analyze" className="btn-gold" style={{ padding: "10px 22px", borderRadius: 10, fontSize: 13, display: "inline-block", textDecoration: "none" }}>
              Analyze a game
            </Link>
          </div>
        )}

        {/* ── Session complete screen ──────────────────────────────────────── */}
        {source === "queue" && sessionDone && (
          <div className="card" style={{ padding: "40px 28px", textAlign: "center", animation: "session-in 0.5s cubic-bezier(0.34,1.56,0.64,1) both" }}>
            <div style={{ fontSize: 52, lineHeight: 1, marginBottom: 16 }}>
              {sessionCorrect >= puzzles.length ? "🏆" : sessionCorrect >= Math.ceil(puzzles.length / 2) ? "🎯" : "💪"}
            </div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 800, color: "var(--text-primary)", marginBottom: 8 }}>
              Session complete!
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 15, marginBottom: 24 }}>
              {sessionCorrect}/{puzzles.length} correct
              {sessionCorrect === puzzles.length ? " — perfect session!" : sessionCorrect >= Math.ceil(puzzles.length / 2) ? " — solid work." : " — keep practicing."}
            </p>

            {/* Streak callout */}
            {stats && (
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 10,
                background: "var(--gold-subtle)", border: "1px solid var(--gold-border)",
                borderRadius: 12, padding: "12px 20px", marginBottom: 28,
              }}>
                <span style={{ fontSize: 24 }}>🔥</span>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "var(--gold)", lineHeight: 1 }}>
                    {stats.daily_streak + (stats.today_solved === 0 ? 1 : 0)}-day streak
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {stats.queue_size > 0 ? `${stats.queue_size} more puzzles available` : "Come back tomorrow for more"}
                  </div>
                </div>
              </div>
            )}

            {/* Session dots recap */}
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 28 }}>
              {puzzles.map((_, i) => (
                <div key={i} style={{
                  width: 12, height: 12, borderRadius: "50%",
                  background: i < sessionCorrect ? "var(--accent-green)" : "rgba(224,82,82,0.6)",
                  boxShadow: i < sessionCorrect ? "0 0 6px rgba(34,197,94,0.4)" : "none",
                }} />
              ))}
            </div>

            {themes[0] && (
              <p style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 24 }}>
                Top weakness practiced: <strong style={{ color: "var(--accent-blue)" }}>{themes[0].theme}</strong>
              </p>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              {stats && stats.queue_size > 0 && (
                <button
                  onClick={() => { setSessionDone(false); setSource("queue"); }}
                  className="btn-gold"
                  style={{ padding: "10px 22px", borderRadius: 10, fontSize: 13, cursor: "pointer" }}
                >
                  Practice more ({stats.queue_size} left)
                </button>
              )}
              <Link
                href="/analyze"
                style={{
                  padding: "10px 22px", borderRadius: 10, fontSize: 13,
                  background: "var(--bg-elevated)", border: "1px solid var(--border)",
                  color: "var(--text-secondary)", textDecoration: "none",
                }}
              >
                Analyze another game
              </Link>
            </div>
          </div>
        )}

        {source === "game" && !pgn && (() => {
          const SQ = 28;
          const BD = 8 * SQ;
          const dots: { row: number; col: number; fill: string }[] = [
            { row: 1, col: 5, fill: "rgba(224,82,82,0.35)" },
            { row: 4, col: 2, fill: "rgba(201,162,68,0.35)" },
            { row: 6, col: 6, fill: "rgba(224,82,82,0.28)" },
          ];
          return (
            <div className="card" style={{ padding: "28px 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 32, alignItems: "center" }}>
              {/* Ghost board */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, opacity: 0.68 }}>
                <svg width={BD} height={BD} viewBox={"0 0 " + BD + " " + BD}
                  style={{ display: "block", borderRadius: 6, boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
                  {Array.from({ length: 8 }, (_, r) =>
                    Array.from({ length: 8 }, (_, c) => (
                      <rect key={r + "-" + c} x={c * SQ} y={r * SQ} width={SQ} height={SQ}
                        fill={(r + c) % 2 === 0 ? "rgba(228,215,185,0.11)" : "rgba(91,142,245,0.07)"} />
                    ))
                  )}
                  {dots.map((d, i) => (
                    <g key={i}>
                      <rect x={d.col * SQ} y={d.row * SQ} width={SQ} height={SQ} fill={d.fill} />
                      <circle cx={d.col * SQ + SQ / 2} cy={d.row * SQ + SQ / 2} r={7}
                        fill={d.fill.replace(/0\.\d+\)/, "0.8)")} stroke="rgba(0,0,0,0.2)" strokeWidth={1} />
                      <text x={d.col * SQ + SQ / 2} y={d.row * SQ + SQ / 2 + 4} textAnchor="middle"
                        fontSize="8" fontWeight="bold"
                        fill={d.fill.includes("224,82") ? "rgba(224,82,82,0.95)" : "rgba(201,162,68,0.95)"}>
                        {"??"}
                      </text>
                    </g>
                  ))}
                </svg>
                {/* Greyed AI-Extracted badge */}
                <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 10px", opacity: 0.5 }}>
                  <span style={{ color: "var(--text-muted)", fontSize: 8, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" }}>{"✦ AI-Extracted Puzzles"}</span>
                </div>
              </div>
              {/* CTA */}
              <div>
                <p style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 17, marginBottom: 8, lineHeight: 1.3 }}>
                  Puzzles are pulled<br />from your own blunders.
                </p>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.65, marginBottom: 20 }}>
                  Analyze a game first. AI extracts the positions where you made significant mistakes and turns them into targeted training puzzles.
                </p>
                <Link href="/analyze" className="btn-gold" style={{ padding: "10px 22px", borderRadius: 10, fontSize: 13, display: "inline-block", textDecoration: "none" }}>
                  {"← Import a game"}
                </Link>
              </div>
            </div>
          );
        })()}

        {loading && (
          <div className="card" style={{ padding: 28, textAlign: "center" }}>
            {/* Dual-ring AI spinner */}
            <div style={{ position: "relative", width: 32, height: 32, margin: "0 auto 16px" }}>
              <div style={{ width: 32, height: 32, border: "2.5px solid rgba(91,142,245,0.2)", borderTopColor: "var(--accent-blue)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <div style={{ position: "absolute", inset: 6, border: "2px solid rgba(201,162,68,0.2)", borderBottomColor: "var(--gold)", borderRadius: "50%", animation: "spin 1.4s linear infinite reverse" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", marginBottom: 6 }}>
              <span style={{ background: "rgba(91,142,245,0.1)", border: "1px solid rgba(91,142,245,0.25)", borderRadius: 5, padding: "2px 8px", fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", color: "var(--accent-blue)", textTransform: "uppercase" }}>
                {"AI"}
              </span>
              <p style={{ color: "var(--text-secondary)", fontSize: 13, fontWeight: 500 }}>{"Extracting training positions…"}</p>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: 11 }}>{"Stockfish is identifying your critical mistakes"}</p>
          </div>
        )}

        {error && (
          <div style={{ background: "rgba(224,82,82,0.12)", border: "1px solid rgba(224,82,82,0.35)", color: "var(--clr-blunder)", padding: "12px 16px", borderRadius: 10, marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        {source === "game" && !loading && puzzles.length === 0 && pgn && !error && (
          <div className="card" style={{ padding: 24, textAlign: "center" }}>
            <p style={{ color: "var(--text-muted)" }}>{"No significant errors found — impressive! Try analyzing more games."}</p>
          </div>
        )}

        {puzzle && !sessionDone && (
          <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 items-start">
            {/* Board */}
            <div style={{ width: "100%", maxWidth: 420 }}>
              <Chessboard
                options={{
                  position: fen,
                  boardOrientation: puzzle.color === "White" ? "white" : "black",
                  canDragPiece: () => solveState === "idle",
                  onPieceDrop,
                  squareStyles: hintSquares,
                  boardStyle: {
                    borderRadius: "var(--board-radius)",
                    boxShadow: "var(--shadow-lg)",
                  },
                }}
              />
            </div>

            {/* Puzzle info */}
            <div className="flex flex-col gap-4">
              {/* Puzzle header — AI framed */}
              <div className="card" style={{ padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  {/* AI-Extracted badge */}
                  <div style={{ display: "flex", alignItems: "center", gap: 5,
                    background: "rgba(91,142,245,0.08)", border: "1px solid rgba(91,142,245,0.25)",
                    borderRadius: 6, padding: "3px 9px",
                  }}>
                    <span style={{ width: 5, height: 5, background: "var(--accent-blue)", borderRadius: "50%", display: "inline-block", animation: "puzz-pulse 1.5s ease-in-out infinite" }} />
                    <span style={{ color: "var(--accent-blue)", fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>{"AI-Extracted"}</span>
                  </div>
                  <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    {"Puzzle "}{puzzleIdx + 1}{" / "}{puzzles.length}
                  </span>
                  <span style={{
                    background: (CLF_COLORS[Object.keys(CLF_COLORS).find(k => puzzle.classification.includes(k)) ?? ""] ?? "") + "22",
                    color: CLF_COLORS[Object.keys(CLF_COLORS).find(k => puzzle.classification.includes(k)) ?? ""] ?? "var(--text-secondary)",
                    padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                  }}>
                    {puzzle.classification}
                  </span>
                </div>

                <p style={{ color: "var(--text-primary)", fontWeight: 700, marginBottom: 4, fontSize: 14 }}>
                  {puzzle.color}{" to move."}
                </p>
                <p style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.5, marginBottom: 8 }}>
                  {"This is where you lost a "}{puzzle.classification.includes("Blunder") ? "winning " : ""}{"position. Find the best response."}
                </p>
                <p style={{ color: "var(--text-muted)", fontSize: 11 }}>
                  {"Move "}{puzzle.move_number}{" · "}{puzzle.phase}{" · −"}{puzzle.cp_loss}{" cp"}
                  {" · "}{puzzle.game_white}{" vs "}{puzzle.game_black}
                </p>
              </div>

              {/* Solve feedback with celebration/commiseration animation */}
              {message && (
                <div
                  key={solveState}
                  style={{
                    background: solveState === "correct" ? "rgba(34,197,94,0.1)" : solveState === "wrong" ? "rgba(220,53,69,0.1)" : "rgba(201,162,68,0.1)",
                    border: "1px solid " + (solveState === "correct" ? "rgba(34,197,94,0.35)" : solveState === "wrong" ? "rgba(220,53,69,0.35)" : "rgba(201,162,68,0.35)"),
                    color: solveState === "correct" ? "var(--accent-green)" : solveState === "wrong" ? "var(--clr-blunder)" : "var(--gold-light)",
                    padding: "14px 16px",
                    borderRadius: 12,
                    fontSize: 13,
                    animation: solveState === "correct"
                      ? "solve-correct 0.5s cubic-bezier(0.34,1.56,0.64,1) both"
                      : solveState === "wrong"
                      ? "solve-wrong 0.4s ease both"
                      : "solve-fade 0.3s ease both",
                    boxShadow: solveState === "correct"
                      ? "0 0 20px rgba(34,197,94,0.2)"
                      : solveState === "wrong"
                      ? "0 0 16px rgba(224,82,82,0.15)"
                      : "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>
                      {solveState === "correct" ? "✓" : solveState === "wrong" ? "✗" : "◈"}
                    </span>
                    <span style={{ lineHeight: 1.5 }}>{message}</span>
                  </div>
                </div>
              )}

              {/* Played move context */}
              <div className="card" style={{ padding: 16 }}>
                <p style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                  What was played
                </p>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 16, color: "var(--clr-blunder)" }}>
                    {puzzle.played_san}
                  </span>
                  <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{"→ lost "}{puzzle.cp_loss}{" cp"}</span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 flex-wrap">
                {solveState === "idle" && (
                  <>
                    <button
                      onClick={() => setHintLevel(l => Math.min(l + 1, 2))}
                      disabled={hintLevel >= 2}
                      title={hintLevel === 0 ? "Show the piece to move" : hintLevel === 1 ? "Show the target square" : "No more hints"}
                      style={{
                        background: hintLevel > 0 ? "rgba(201,162,68,0.12)" : "var(--bg-elevated)",
                        border: "1px solid " + (hintLevel > 0 ? "rgba(201,162,68,0.4)" : "var(--border)"),
                        color: hintLevel > 0 ? "var(--gold-light)" : "var(--text-secondary)",
                        padding: "8px 16px",
                        borderRadius: 8,
                        fontSize: 13,
                        cursor: hintLevel >= 2 ? "default" : "pointer",
                        opacity: hintLevel >= 2 ? 0.55 : 1,
                      }}
                      className="hover:opacity-80"
                    >
                      {hintLevel === 0 ? "💡 Hint" : hintLevel === 1 ? "💡 More hint" : "💡 Max hint"}
                    </button>
                    <button
                      onClick={showSolution}
                      style={{
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                        color: "var(--text-secondary)",
                        padding: "8px 16px",
                        borderRadius: 8,
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                      className="hover:opacity-80"
                    >
                      Show solution
                    </button>
                  </>
                )}
                {puzzleIdx > 0 && (
                  <button
                    onClick={() => goToPuzzle(puzzleIdx - 1)}
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                      color: "var(--text-secondary)",
                      padding: "8px 16px",
                      borderRadius: 8,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                    className="hover:opacity-80"
                  >
                    {"← Previous"}
                  </button>
                )}
                {solveState !== "idle" && (
                  puzzleIdx < puzzles.length - 1 ? (
                    <button
                      onClick={() => { if (autoAdvRef.current) clearTimeout(autoAdvRef.current); goToPuzzle(puzzleIdx + 1); }}
                      className="btn-gold"
                      style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer" }}
                    >
                      {"Next →"}
                    </button>
                  ) : source === "queue" ? (
                    <button
                      onClick={() => { if (autoAdvRef.current) clearTimeout(autoAdvRef.current); setSessionDone(true); }}
                      className="btn-gold"
                      style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer" }}
                    >
                      {"Finish session →"}
                    </button>
                  ) : null
                )}
                {solveState !== "idle" && (
                  <button
                    onClick={() => initPuzzle(puzzle)}
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                      color: "var(--text-secondary)",
                      padding: "8px 16px",
                      borderRadius: 8,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                    className="hover:opacity-80"
                  >
                    {"↺ Retry"}
                  </button>
                )}
              </div>

              {/* Session progress dots (queue) / puzzle list (game) */}
              {source === "queue" ? (
                <div className="card" style={{ padding: 16 }}>
                  <p style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
                    Session progress
                  </p>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {puzzles.map((_, i) => (
                      <div
                        key={i}
                        style={{
                          width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                          background: i < puzzleIdx
                            ? "var(--accent-green)"
                            : i === puzzleIdx
                            ? "var(--gold)"
                            : "var(--bg-elevated)",
                          border: i === puzzleIdx ? "2px solid var(--gold)" : "2px solid var(--border)",
                          boxShadow: i === puzzleIdx ? "0 0 8px rgba(201,162,68,0.5)" : "none",
                          transition: "all 0.3s ease",
                        }}
                      />
                    ))}
                    <span style={{ color: "var(--text-muted)", fontSize: 11, marginLeft: 4 }}>
                      {puzzleIdx + 1}/{puzzles.length}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="card" style={{ padding: 16 }}>
                  <p style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                    All Puzzles
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {puzzles.map((p, i) => {
                      const clfKey = Object.keys(CLF_COLORS).find(k => p.classification.includes(k));
                      const color  = clfKey ? CLF_COLORS[clfKey] : "var(--text-muted)";
                      return (
                        <button
                          key={i}
                          onClick={() => goToPuzzle(i)}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "8px 10px", borderRadius: 8,
                            background: i === puzzleIdx ? "var(--gold-subtle)" : "var(--bg-elevated)",
                            border: "1px solid " + (i === puzzleIdx ? "var(--gold-border)" : "transparent"),
                            cursor: "pointer", textAlign: "left",
                          }}
                          className="hover:opacity-80"
                        >
                          <span style={{ color, fontWeight: 700, width: 18, fontSize: 12, textAlign: "center" }}>
                            {clfKey === "Blunder" ? "??" : clfKey === "Mistake" ? "?" : "?!"}
                          </span>
                          <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                            {"Move "}{p.move_number}{" · "}{p.phase}
                          </span>
                          <span style={{ color: "var(--text-muted)", fontSize: 11, marginLeft: "auto" }}>
                            {"−"}{p.cp_loss}{" cp"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes puzz-pulse {
          0%,100% { opacity: 0.5; transform: scale(1); }
          50%     { opacity: 1;   transform: scale(1.3); }
        }
        @keyframes solve-correct {
          0%   { opacity: 0; transform: scale(0.88) translateY(6px); }
          70%  { transform: scale(1.03) translateY(-1px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes solve-wrong {
          0%,100% { transform: translateX(0); opacity: 1; }
          20%     { transform: translateX(-5px); }
          40%     { transform: translateX(5px); }
          60%     { transform: translateX(-3px); }
          80%     { transform: translateX(3px); }
        }
        @keyframes solve-fade {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes session-in {
          0%   { opacity: 0; transform: scale(0.92) translateY(16px); }
          70%  { transform: scale(1.02) translateY(-2px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </>
  );
}

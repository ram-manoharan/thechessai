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
  fetchPuzzles, getPuzzleQueue, getMistakeFingerprint, recordPuzzleProgress, getPuzzleStats,
  type PuzzleData, type MistakeTheme, type PuzzleStats,
} from "@/lib/api";
import { THEME_GLOSSARY } from "@/lib/chess-utils";

const Chessboard = dynamic(
  () => import("react-chessboard").then(m => m.Chessboard),
  { ssr: false, loading: () => <div style={{ aspectRatio: "1/1", background: "var(--bg-elevated)", borderRadius: 12 }} className="animate-pulse" /> }
);

type SolveState = "idle" | "correct" | "wrong" | "shown";
type PuzzleResult = "correct" | "wrong" | null;
type PuzzleSource = "queue" | "game";

function queuedToPuzzleData(q: {
  fen: string; best_move_san: string; continuation: string[];
  theme: string; cp_loss: number; phase: string;
  game_white: string; game_black: string; game_date: string;
}): PuzzleData {
  const sideToMove = q.fen.split(" ")[1] === "b" ? "Black" : "White";
  return {
    fen: q.fen, move_number: 0, color: sideToMove,
    played_san: "", best_move_san: q.best_move_san,
    continuation: q.continuation, classification: q.theme,
    cp_loss: q.cp_loss, phase: q.phase, theme: q.theme,
    game_white: q.game_white, game_black: q.game_black, game_date: q.game_date,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTimeUntil(isoString: string): string {
  const diff = new Date(isoString).getTime() - Date.now();
  if (diff <= 0) return "now";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const PHASE_ICON: Record<string, string> = { Opening: "♙", Middlegame: "♛", Endgame: "♔" };
const CLF_COLORS: Record<string, string> = {
  Blunder: "var(--clr-blunder)", Mistake: "var(--clr-mistake)", Inaccuracy: "var(--clr-inaccuracy)",
};

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const w = 56, h = 18, pad = 2;
  const max = Math.max(...data, 1), min = Math.min(...data, 0), range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });
  const [lx, ly] = pts[pts.length - 1].split(",");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", flexShrink: 0 }}>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
      <circle cx={lx} cy={ly} r={2.5} fill={color} />
    </svg>
  );
}

// ── StatsBar ──────────────────────────────────────────────────────────────────

function StatsBar({ stats, sessionCorrect }: { stats: PuzzleStats; sessionCorrect: number }) {
  const todayTotal = Math.min(stats.today_solved + sessionCorrect, stats.session_goal);
  const pct = Math.min(100, (todayTotal / stats.session_goal) * 100);
  return (
    <div style={{
      display: "flex", gap: 0, alignItems: "stretch",
      background: "var(--bg-surface)", border: "1px solid var(--border)",
      borderRadius: 14, overflow: "hidden", marginBottom: 20,
    }}>
      {/* Streak */}
      <div style={{ padding: "12px 20px", display: "flex", alignItems: "center", gap: 10, borderRight: "1px solid var(--border)" }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>🔥</span>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: stats.daily_streak > 0 ? "var(--gold)" : "var(--text-muted)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {stats.daily_streak}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em", marginTop: 1 }}>
            {stats.daily_streak === 1 ? "day streak" : "day streak"}
          </div>
        </div>
      </div>

      {/* Today progress */}
      <div style={{ flex: 1, padding: "12px 20px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 5 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Today's session</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
            {todayTotal} / {stats.session_goal}
          </span>
        </div>
        <div style={{ height: 5, background: "var(--bg-elevated)", borderRadius: 3, overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${pct}%`,
            background: pct >= 100 ? "var(--accent-green)" : "linear-gradient(90deg, var(--accent-blue) 0%, var(--gold) 100%)",
            borderRadius: 3, transition: "width 0.5s ease",
          }} />
        </div>
      </div>

      {/* Total */}
      <div style={{ padding: "12px 20px", display: "flex", alignItems: "center", gap: 10, borderLeft: "1px solid var(--border)" }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {stats.total_solved}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em", marginTop: 1 }}>total solved</div>
        </div>
        <span style={{ fontSize: 18, lineHeight: 1 }}>✓</span>
      </div>
    </div>
  );
}

// ── SessionDots ───────────────────────────────────────────────────────────────

function SessionDots({ results, current, total }: { results: PuzzleResult[]; current: number; total: number }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
      {Array.from({ length: total }, (_, i) => {
        const r = results[i];
        const isCurrent = i === current;
        const bg = r === "correct" ? "var(--accent-green)" : r === "wrong" ? "var(--clr-blunder)" : isCurrent ? "var(--gold)" : "var(--bg-elevated)";
        const border = isCurrent ? "2px solid var(--gold)" : r ? "2px solid transparent" : "2px solid var(--border)";
        const shadow = isCurrent ? "0 0 0 3px rgba(201,162,68,0.2)" : r === "correct" ? "0 0 6px rgba(34,197,94,0.3)" : "none";
        return (
          <div key={i} style={{
            width: 13, height: 13, borderRadius: "50%", flexShrink: 0,
            background: bg, border, boxShadow: shadow,
            transition: "all 0.3s ease",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {r === "correct" && <span style={{ fontSize: 7, color: "#fff", fontWeight: 900 }}>✓</span>}
            {r === "wrong"   && <span style={{ fontSize: 7, color: "#fff", fontWeight: 900 }}>✗</span>}
          </div>
        );
      })}
      <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4, fontVariantNumeric: "tabular-nums" }}>
        {current + 1}/{total}
      </span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PuzzlesPage() {
  const pgn         = useGameStore(s => s.pgn);
  const playerColor = useGameStore(s => s.playerColor);
  const { status: sessionStatus } = useSession();
  const signedIn = sessionStatus === "authenticated";

  const [source,         setSource]         = useState<PuzzleSource>("queue");
  const [puzzles,        setPuzzles]        = useState<PuzzleData[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState("");
  const [puzzleIdx,      setPuzzleIdx]      = useState(0);
  const [solveState,     setSolveState]     = useState<SolveState>("idle");
  const [fen,            setFen]            = useState("");
  const [hintLevel,      setHintLevel]      = useState(0);
  const [themes,         setThemes]         = useState<MistakeTheme[]>([]);
  const [stats,          setStats]          = useState<PuzzleStats | null>(null);
  const [sessionResults, setSessionResults] = useState<PuzzleResult[]>([]);
  const [sessionDone,    setSessionDone]    = useState(false);
  const [playedSan,      setPlayedSan]      = useState("");

  const chessRef   = useRef<Chess | null>(null);
  const autoAdvRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const SESSION_GOAL = 5;
  const puzzle = puzzles[puzzleIdx] ?? null;
  const sessionCorrect = sessionResults.filter(r => r === "correct").length;

  const initPuzzle = useCallback((p: PuzzleData) => {
    if (autoAdvRef.current) clearTimeout(autoAdvRef.current);
    chessRef.current = new Chess(p.fen);
    setFen(p.fen);
    setSolveState("idle");
    setHintLevel(0);
    setPlayedSan("");
  }, []);

  // ── Load ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (source === "queue") {
      if (!signedIn) return;
      setLoading(true);
      setError("");
      setSessionResults([]);
      setSessionDone(false);
      Promise.all([getPuzzleQueue(SESSION_GOAL), getMistakeFingerprint(3), getPuzzleStats()])
        .then(([q, fp, st]) => {
          const mapped = q.puzzles.map(queuedToPuzzleData);
          setPuzzles(mapped);
          setThemes(fp.themes);
          setStats(st);
          setLoading(false);
          if (mapped.length > 0) { setPuzzleIdx(0); initPuzzle(mapped[0]); }
        })
        .catch(e => { setError((e as Error).message); setLoading(false); });
      return;
    }
    if (!pgn) { setPuzzles([]); return; }
    setLoading(true);
    setError("");
    fetchPuzzles(pgn, playerColor)
      .then(r => { setPuzzles(r.puzzles); setLoading(false); if (r.puzzles.length > 0) { setPuzzleIdx(0); initPuzzle(r.puzzles[0]); } })
      .catch(e => { setError((e as Error).message); setLoading(false); });
  }, [pgn, playerColor, source, signedIn, initPuzzle]);

  // ── Navigation ─────────────────────────────────────────────────────────────

  const goToPuzzle = useCallback((idx: number) => {
    if (!puzzles[idx]) return;
    setPuzzleIdx(idx);
    initPuzzle(puzzles[idx]);
  }, [puzzles, initPuzzle]);

  const advanceSession = useCallback((result: PuzzleResult) => {
    setSessionResults(prev => {
      const next = [...prev];
      next[puzzleIdx] = result;
      return next;
    });
    if (puzzleIdx + 1 < puzzles.length) {
      autoAdvRef.current = setTimeout(() => goToPuzzle(puzzleIdx + 1), 1500);
    } else {
      autoAdvRef.current = setTimeout(() => setSessionDone(true), 1500);
    }
  }, [puzzleIdx, puzzles, goToPuzzle]);

  // ── Solve ──────────────────────────────────────────────────────────────────

  const onPieceDrop = useCallback(({ sourceSquare: from, targetSquare: toOrNull }: PieceDropHandlerArgs) => {
    if (!chessRef.current || !puzzle || !toOrNull || solveState !== "idle") return false;
    try {
      const move = chessRef.current.move({ from, to: toOrNull, promotion: "q" });
      if (!move) return false;
    } catch { return false; }

    const played = chessRef.current.history({ verbose: true }).slice(-1)[0];
    const san = played?.san ?? "";
    setPlayedSan(san);
    setFen(chessRef.current.fen());

    const isCorrect = san === puzzle.best_move_san;

    if (isCorrect) {
      setSolveState("correct");
      if (source === "queue") {
        recordPuzzleProgress(puzzle.fen, true).catch(() => {});
        advanceSession("correct");
      }
    } else {
      setSolveState("wrong");
      if (source === "queue") {
        recordPuzzleProgress(puzzle.fen, false).catch(() => {});
      }
    }
    return true;
  }, [puzzle, solveState, source, advanceSession]);

  const showSolution = useCallback(() => {
    if (!puzzle) return;
    try {
      const c = new Chess(puzzle.fen);
      c.move(puzzle.best_move_san);
      chessRef.current = c;
      setFen(c.fen());
    } catch { /* uci format fallback */ }
    setSolveState("shown");
    if (source === "queue") recordPuzzleProgress(puzzle.fen, false).catch(() => {});
  }, [puzzle, source]);

  const retryPuzzle = useCallback(() => {
    if (!puzzle) return;
    chessRef.current = new Chess(puzzle.fen);
    setFen(puzzle.fen);
    setSolveState("idle");
    setPlayedSan("");
    setHintLevel(0);
    if (autoAdvRef.current) clearTimeout(autoAdvRef.current);
  }, [puzzle]);

  const handleNext = useCallback(() => {
    if (autoAdvRef.current) clearTimeout(autoAdvRef.current);
    if (source === "queue") {
      const result: PuzzleResult = solveState === "correct" ? "correct" : "wrong";
      setSessionResults(prev => { const n = [...prev]; n[puzzleIdx] = result; return n; });
      if (puzzleIdx + 1 < puzzles.length) goToPuzzle(puzzleIdx + 1);
      else setSessionDone(true);
    } else {
      if (puzzleIdx + 1 < puzzles.length) goToPuzzle(puzzleIdx + 1);
    }
  }, [source, solveState, puzzleIdx, puzzles, goToPuzzle]);

  // ── Hint squares ───────────────────────────────────────────────────────────

  const hintSquares = useMemo<Record<string, { backgroundColor: string }>>(() => {
    if (hintLevel === 0 || !puzzle) return {};
    try {
      const c = new Chess(puzzle.fen);
      const r = c.move(puzzle.best_move_san);
      if (!r) return {};
      const sq: Record<string, { backgroundColor: string }> = {};
      if (hintLevel >= 1) sq[r.from] = { backgroundColor: "rgba(201,162,68,0.65)" };
      if (hintLevel >= 2) sq[r.to]   = { backgroundColor: "rgba(201,162,68,0.85)" };
      return sq;
    } catch { return {}; }
  }, [hintLevel, puzzle]);

  // ── Continuation line ──────────────────────────────────────────────────────
  // Show the engine line after solving so the user understands the tactic.
  const continuationLine = useMemo(() => {
    if (!puzzle || solveState === "idle") return [];
    const line: string[] = [puzzle.best_move_san, ...puzzle.continuation.slice(0, 4)];
    return line;
  }, [puzzle, solveState]);

  // ── Weak theme for this puzzle ─────────────────────────────────────────────
  const puzzleWeakTheme = useMemo(() => {
    if (!puzzle || !themes.length) return null;
    return themes.find(t => t.theme === puzzle.theme) ?? null;
  }, [puzzle, themes]);

  // ── Next due text ──────────────────────────────────────────────────────────
  const nextDueText = stats?.next_due_at ? formatTimeUntil(stats.next_due_at) : null;

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <>
      <Navbar />
      <main style={{ background: "var(--bg-base)", minHeight: "100vh" }} className="px-4 py-6 max-w-5xl mx-auto">

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Link href="/analyze" style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" }}
              className="hover:text-[var(--gold)] transition-colors">← Analysis</Link>
            <span style={{ color: "var(--border)" }}>|</span>
            <span style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>Puzzle Training</span>
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "clamp(20px, 3vw, 28px)", color: "var(--text-primary)", lineHeight: 1.2 }}>
            Train your <em className="text-gold-gradient not-italic">weak spots.</em>
          </h1>
        </div>

        {/* Tab bar */}
        {signedIn && (
          <div style={{ display: "flex", gap: 6, marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
            {([["queue", "◆ Daily Practice"], ["game", "This Game"]] as [PuzzleSource, string][]).map(([s, label]) => (
              <button key={s} onClick={() => { setSource(s); setPuzzleIdx(0); }}
                style={{
                  padding: "8px 16px", fontSize: 12, cursor: "pointer", fontWeight: source === s ? 700 : 500,
                  background: "transparent", border: "none",
                  borderBottom: source === s ? "2px solid var(--gold)" : "2px solid transparent",
                  color: source === s ? "var(--gold)" : "var(--text-muted)",
                  marginBottom: -1, transition: "all 0.15s",
                }}>
                {label}
              </button>
            ))}
          </div>
        )}

        {/* ── DAILY PRACTICE ───────────────────────────────────────────────── */}
        {source === "queue" && (
          <>
            {/* Stats bar */}
            {stats && !sessionDone && (
              <StatsBar stats={stats} sessionCorrect={sessionCorrect} />
            )}

            {/* Loading */}
            {loading && (
              <div className="card" style={{ padding: 32, textAlign: "center" }}>
                <div style={{ position: "relative", width: 36, height: 36, margin: "0 auto 16px" }}>
                  <div style={{ width: 36, height: 36, border: "2.5px solid rgba(91,142,245,0.2)", borderTopColor: "var(--accent-blue)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  <div style={{ position: "absolute", inset: 6, border: "2px solid rgba(201,162,68,0.2)", borderBottomColor: "var(--gold)", borderRadius: "50%", animation: "spin 1.3s linear infinite reverse" }} />
                </div>
                <p style={{ color: "var(--text-secondary)", fontSize: 13, fontWeight: 500 }}>Loading your puzzles…</p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{ background: "rgba(224,82,82,0.1)", border: "1px solid rgba(224,82,82,0.3)", color: "var(--clr-blunder)", padding: "12px 16px", borderRadius: 10, marginBottom: 16, fontSize: 13 }}>
                {error}
              </div>
            )}

            {/* Not signed in */}
            {!signedIn && sessionStatus !== "loading" && (
              <div className="card" style={{ padding: "32px 28px", textAlign: "center" }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
                <p style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Sign in to access daily practice</p>
                <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
                  Your puzzles are built from your own games and tracked per account.
                </p>
                <Link href="/login?callbackUrl=/puzzles" className="btn-gold" style={{ padding: "10px 24px", borderRadius: 10, fontSize: 13, display: "inline-block", textDecoration: "none" }}>
                  Sign in
                </Link>
              </div>
            )}

            {/* No puzzles ever saved */}
            {!loading && !error && signedIn && puzzles.length === 0 && stats && stats.total_saved === 0 && (
              <div className="card" style={{ padding: "32px 28px", textAlign: "center" }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>♟</div>
                <p style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 16, marginBottom: 8 }}>No puzzles yet</p>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7, marginBottom: 20 }}>
                  Analyze a game on the Analyze page. Puzzles are automatically extracted from your mistakes
                  and queued here for spaced-repetition practice.
                </p>
                <Link href="/analyze" className="btn-gold" style={{ padding: "10px 24px", borderRadius: 10, fontSize: 13, display: "inline-block", textDecoration: "none" }}>
                  Analyze a game
                </Link>
              </div>
            )}

            {/* All caught up — puzzles exist but all scheduled for the future */}
            {!loading && !error && signedIn && puzzles.length === 0 && stats && stats.total_saved > 0 && !sessionDone && (
              <div className="card" style={{ padding: "32px 28px", textAlign: "center" }}>
                <div style={{ fontSize: 44, marginBottom: 12 }}>🎉</div>
                <p style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 18, marginBottom: 8 }}>All caught up!</p>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7, marginBottom: 4 }}>
                  You've completed today's review. Spaced repetition is working —
                  puzzles you solved recently will reappear when you're most likely to forget them.
                </p>
                {nextDueText && (
                  <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 20 }}>
                    Next puzzle due in <strong style={{ color: "var(--gold)" }}>{nextDueText}</strong>
                  </p>
                )}
                <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                  {stats.daily_streak > 0 && (
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 8,
                      background: "var(--gold-subtle)", border: "1px solid var(--gold-border)",
                      borderRadius: 10, padding: "10px 18px",
                    }}>
                      <span style={{ fontSize: 20 }}>🔥</span>
                      <span style={{ fontWeight: 700, color: "var(--gold)", fontSize: 14 }}>{stats.daily_streak}-day streak</span>
                    </div>
                  )}
                  <Link href="/analyze" style={{
                    padding: "10px 20px", borderRadius: 10, fontSize: 13,
                    background: "var(--bg-elevated)", border: "1px solid var(--border)",
                    color: "var(--text-secondary)", textDecoration: "none", display: "inline-block",
                  }}>
                    Analyze another game
                  </Link>
                </div>
              </div>
            )}

            {/* ── SESSION COMPLETE ─────────────────────────────────────────── */}
            {sessionDone && (
              <div className="card" style={{ padding: "40px 28px", textAlign: "center", animation: "pop-in 0.45s cubic-bezier(0.34,1.56,0.64,1) both" }}>
                <div style={{ fontSize: 52, marginBottom: 14, lineHeight: 1 }}>
                  {sessionCorrect >= puzzles.length ? "🏆" : sessionCorrect >= Math.ceil(puzzles.length / 2) ? "🎯" : "💪"}
                </div>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, color: "var(--text-primary)", marginBottom: 6 }}>
                  Session complete!
                </h2>
                <p style={{ color: "var(--text-secondary)", fontSize: 15, marginBottom: 20 }}>
                  {sessionCorrect}/{puzzles.length} correct
                  {sessionCorrect === puzzles.length ? " — perfect!" : sessionCorrect >= Math.ceil(puzzles.length / 2) ? " — solid work." : " — keep at it."}
                </p>

                {/* Per-puzzle dots */}
                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 22 }}>
                  {sessionResults.slice(0, puzzles.length).map((r, i) => (
                    <div key={i} style={{
                      width: 16, height: 16, borderRadius: "50%",
                      background: r === "correct" ? "var(--accent-green)" : "rgba(224,82,82,0.65)",
                      boxShadow: r === "correct" ? "0 0 8px rgba(34,197,94,0.4)" : "0 0 6px rgba(224,82,82,0.25)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <span style={{ fontSize: 8, color: "#fff", fontWeight: 900 }}>{r === "correct" ? "✓" : "✗"}</span>
                    </div>
                  ))}
                </div>

                {/* Streak */}
                {stats && stats.daily_streak > 0 && (
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 10,
                    background: "var(--gold-subtle)", border: "1px solid var(--gold-border)",
                    borderRadius: 12, padding: "12px 22px", marginBottom: 20,
                  }}>
                    <span style={{ fontSize: 26 }}>🔥</span>
                    <div style={{ textAlign: "left" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: "var(--gold)", lineHeight: 1 }}>
                        {stats.daily_streak}-day streak
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {nextDueText ? `Next puzzle in ${nextDueText}` : "Come back tomorrow!"}
                      </div>
                    </div>
                  </div>
                )}

                {/* Weakness insight */}
                {themes[0] && (
                  <div style={{
                    background: "rgba(91,142,245,0.06)", border: "1px solid rgba(91,142,245,0.2)",
                    borderRadius: 10, padding: "12px 16px", marginBottom: 22, textAlign: "left",
                  }}>
                    <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--accent-blue)", marginBottom: 4 }}>
                      Your top weakness — keep training this
                    </p>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>{themes[0].theme}</p>
                    {THEME_GLOSSARY[themes[0].theme] && (
                      <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{THEME_GLOSSARY[themes[0].theme]}</p>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                  {stats && stats.queue_size > 0 && (
                    <button onClick={() => { setSessionDone(false); setSessionResults([]); setPuzzleIdx(0); if (puzzles[0]) initPuzzle(puzzles[0]); }}
                      className="btn-gold" style={{ padding: "10px 22px", borderRadius: 10, fontSize: 13, cursor: "pointer" }}>
                      Practice more ({stats.queue_size} left)
                    </button>
                  )}
                  <Link href="/analyze" style={{
                    padding: "10px 20px", borderRadius: 10, fontSize: 13, display: "inline-block", textDecoration: "none",
                    background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)",
                  }}>Analyze another game</Link>
                </div>
              </div>
            )}

            {/* ── ACTIVE PUZZLE ────────────────────────────────────────────── */}
            {!loading && !error && puzzle && !sessionDone && (
              <>
                {/* Session progress dots */}
                <SessionDots results={sessionResults} current={puzzleIdx} total={puzzles.length} />

                <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-5 items-start">
                  {/* Board */}
                  <div>
                    <Chessboard
                      options={{
                        position: fen,
                        boardOrientation: puzzle.color === "White" ? "white" : "black",
                        canDragPiece: () => solveState === "idle",
                        onPieceDrop,
                        squareStyles: hintSquares,
                        boardStyle: { borderRadius: "var(--board-radius)", boxShadow: "var(--shadow-lg)" },
                      }}
                    />
                  </div>

                  {/* Info panel */}
                  <div className="flex flex-col gap-3">

                    {/* Context card */}
                    <div className="card" style={{ padding: 18 }}>
                      {/* Badges row */}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                        {/* Phase badge */}
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 5,
                          background: "var(--bg-elevated)", border: "1px solid var(--border)",
                          color: "var(--text-secondary)", letterSpacing: "0.05em",
                        }}>
                          {PHASE_ICON[puzzle.phase] ?? "◆"} {puzzle.phase}
                        </span>
                        {/* Classification badge */}
                        {(() => {
                          const key = Object.keys(CLF_COLORS).find(k => puzzle.classification.includes(k));
                          const color = key ? CLF_COLORS[key] : "var(--text-muted)";
                          return key ? (
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 5,
                              background: color + "18", border: `1px solid ${color}40`, color,
                            }}>
                              {key === "Blunder" ? "?? " : key === "Mistake" ? "? " : "?! "}{key} −{puzzle.cp_loss}cp
                            </span>
                          ) : null;
                        })()}
                        {/* Weak theme badge */}
                        {puzzleWeakTheme && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 5,
                            background: "rgba(91,142,245,0.1)", border: "1px solid rgba(91,142,245,0.25)",
                            color: "var(--accent-blue)",
                          }} title={THEME_GLOSSARY[puzzleWeakTheme.theme] ?? undefined}>
                            ⚠ Your #{themes.indexOf(puzzleWeakTheme) + 1} weakness
                          </span>
                        )}
                      </div>

                      {/* Prompt */}
                      <p style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                        {puzzle.color} to move.
                      </p>
                      <p style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.55, marginBottom: 10 }}>
                        {puzzle.classification.includes("Blunder")
                          ? "A critical mistake was made here. Find the best move that changes the game."
                          : puzzle.phase === "Endgame"
                          ? "This endgame position requires precise play. Find the best continuation."
                          : "Find the move that gives the best position."}
                      </p>

                      {/* Game source */}
                      {(puzzle.game_white || puzzle.game_black) && (
                        <p style={{ fontSize: 11, color: "var(--text-muted)", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                          From your game · {puzzle.game_white} vs {puzzle.game_black}
                          {puzzle.game_date ? ` · ${puzzle.game_date}` : ""}
                        </p>
                      )}
                    </div>

                    {/* Feedback card — shown after attempt */}
                    {solveState !== "idle" && (
                      <div
                        key={`${puzzleIdx}-${solveState}`}
                        style={{
                          background: solveState === "correct" ? "rgba(34,197,94,0.09)" : solveState === "wrong" ? "rgba(224,82,82,0.09)" : "rgba(201,162,68,0.09)",
                          border: "1px solid " + (solveState === "correct" ? "rgba(34,197,94,0.3)" : solveState === "wrong" ? "rgba(224,82,82,0.3)" : "rgba(201,162,68,0.3)"),
                          borderRadius: 12, padding: 16,
                          animation: solveState === "correct" ? "pop-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both"
                            : solveState === "wrong" ? "shake 0.4s ease both" : "fade-up 0.3s ease both",
                        }}
                      >
                        {/* Result line */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                          <span style={{
                            fontSize: 18, lineHeight: 1,
                            color: solveState === "correct" ? "var(--accent-green)" : solveState === "wrong" ? "var(--clr-blunder)" : "var(--gold)",
                          }}>
                            {solveState === "correct" ? "✓" : solveState === "wrong" ? "✗" : "◈"}
                          </span>
                          <span style={{
                            fontSize: 13, fontWeight: 700,
                            color: solveState === "correct" ? "var(--accent-green)" : solveState === "wrong" ? "var(--clr-blunder)" : "var(--gold-light)",
                          }}>
                            {solveState === "correct" ? "Correct!" : solveState === "wrong" ? `Not quite — you played ${playedSan}` : "Here's the answer"}
                          </span>
                        </div>

                        {/* Best move */}
                        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                          <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>Best move:</span>
                          <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 15, color: "var(--accent-green)" }}>
                            {puzzle.best_move_san}
                          </span>
                        </div>

                        {/* Continuation line */}
                        {continuationLine.length > 1 && (
                          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10 }}>
                            <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 6 }}>
                              Line
                            </p>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                              {continuationLine.map((move, i) => (
                                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                                  {i % 2 === 0 && (
                                    <span style={{ fontSize: 10, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                                      {i === 0 ? "" : `${Math.floor(i / 2) + 1}.`}
                                    </span>
                                  )}
                                  <span style={{
                                    fontFamily: "monospace", fontWeight: 700, fontSize: 12,
                                    color: i === 0 ? "var(--accent-green)" : "var(--text-secondary)",
                                    background: i === 0 ? "rgba(34,197,94,0.12)" : "var(--bg-elevated)",
                                    padding: "2px 6px", borderRadius: 4,
                                  }}>
                                    {move}
                                  </span>
                                  {i < continuationLine.length - 1 && (
                                    <span style={{ color: "var(--border)", fontSize: 10 }}>›</span>
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Theme insight on wrong/shown */}
                        {solveState !== "correct" && puzzle.theme && THEME_GLOSSARY[puzzle.theme] && (
                          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10, marginTop: 10 }}>
                            <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--accent-blue)", marginBottom: 4 }}>
                              Pattern: {puzzle.theme}
                            </p>
                            <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>
                              {THEME_GLOSSARY[puzzle.theme]}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {solveState === "idle" && (
                        <>
                          <button
                            onClick={() => setHintLevel(l => Math.min(l + 1, 2))}
                            disabled={hintLevel >= 2}
                            style={{
                              padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: hintLevel >= 2 ? "default" : "pointer",
                              background: hintLevel > 0 ? "rgba(201,162,68,0.1)" : "var(--bg-elevated)",
                              border: `1px solid ${hintLevel > 0 ? "rgba(201,162,68,0.35)" : "var(--border)"}`,
                              color: hintLevel > 0 ? "var(--gold-light)" : "var(--text-secondary)",
                              opacity: hintLevel >= 2 ? 0.5 : 1,
                            }}>
                            💡 {hintLevel === 0 ? "Hint" : hintLevel === 1 ? "More hint" : "Max hints"}
                          </button>
                          <button onClick={showSolution} style={{
                            padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                            background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)",
                          }}>
                            Show answer
                          </button>
                        </>
                      )}
                      {solveState === "wrong" && (
                        <button onClick={retryPuzzle} style={{
                          padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                          background: "rgba(224,82,82,0.08)", border: "1px solid rgba(224,82,82,0.3)", color: "var(--clr-blunder)",
                        }}>
                          ↺ Try again
                        </button>
                      )}
                      {solveState !== "idle" && (
                        <button onClick={handleNext} className="btn-gold" style={{ padding: "8px 16px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>
                          {puzzleIdx < puzzles.length - 1 ? "Next →" : "Finish →"}
                        </button>
                      )}
                    </div>

                    {/* Weak areas panel — below buttons */}
                    {themes.length > 0 && (
                      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                        <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-muted)", marginBottom: 10 }}>
                          Your weak areas
                        </p>
                        <div className="flex flex-col gap-2">
                          {themes.map((t, idx) => (
                            <div key={t.theme} style={{
                              display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8,
                              background: t.theme === puzzle.theme ? "rgba(91,142,245,0.08)" : "var(--bg-elevated)",
                              border: `1px solid ${t.theme === puzzle.theme ? "rgba(91,142,245,0.25)" : "var(--border)"}`,
                            }}>
                              <span style={{
                                width: 18, height: 18, borderRadius: "50%", flexShrink: 0, fontSize: 9, fontWeight: 800,
                                background: idx === 0 ? "var(--clr-blunder)" : idx === 1 ? "var(--clr-mistake)" : "var(--clr-inaccuracy)",
                                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                              }}>{idx + 1}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>{t.theme}</p>
                                <p style={{ fontSize: 10, color: "var(--text-muted)", margin: 0 }}>
                                  −{t.total_cp_loss}cp · {t.occurrences}×
                                </p>
                              </div>
                              {t.sparkline && <Sparkline data={t.sparkline} color={idx === 0 ? "var(--clr-blunder)" : "var(--accent-blue)"} />}
                              {t.theme === puzzle.theme && (
                                <span style={{ fontSize: 9, fontWeight: 800, color: "var(--accent-blue)", background: "rgba(91,142,245,0.12)", padding: "2px 6px", borderRadius: 4 }}>
                                  NOW
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ── THIS GAME MODE ──────────────────────────────────────────────── */}
        {source === "game" && (
          <>
            {!pgn && (
              <div className="card" style={{ padding: "28px 24px", textAlign: "center" }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>⟳</div>
                <p style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 16, marginBottom: 8 }}>No game loaded</p>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.65, marginBottom: 20 }}>
                  Analyze a game first. Puzzles are pulled from positions where you made significant mistakes.
                </p>
                <Link href="/analyze" className="btn-gold" style={{ padding: "10px 22px", borderRadius: 10, fontSize: 13, display: "inline-block", textDecoration: "none" }}>
                  ← Go to Analysis
                </Link>
              </div>
            )}

            {loading && (
              <div className="card" style={{ padding: 28, textAlign: "center" }}>
                <div style={{ position: "relative", width: 32, height: 32, margin: "0 auto 16px" }}>
                  <div style={{ width: 32, height: 32, border: "2.5px solid rgba(91,142,245,0.2)", borderTopColor: "var(--accent-blue)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  <div style={{ position: "absolute", inset: 6, border: "2px solid rgba(201,162,68,0.2)", borderBottomColor: "var(--gold)", borderRadius: "50%", animation: "spin 1.4s linear infinite reverse" }} />
                </div>
                <p style={{ color: "var(--text-secondary)", fontSize: 13, fontWeight: 500 }}>Extracting training positions…</p>
              </div>
            )}
            {error && (
              <div style={{ background: "rgba(224,82,82,0.1)", border: "1px solid rgba(224,82,82,0.3)", color: "var(--clr-blunder)", padding: "12px 16px", borderRadius: 10, marginBottom: 16, fontSize: 13 }}>
                {error}
              </div>
            )}
            {!loading && pgn && puzzles.length === 0 && !error && (
              <div className="card" style={{ padding: 24, textAlign: "center" }}>
                <p style={{ color: "var(--text-muted)" }}>No significant errors found — impressive! Analyze more games for puzzles.</p>
              </div>
            )}

            {/* Game puzzles — same board layout */}
            {puzzle && (
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-5 items-start">
                <div>
                  <Chessboard options={{
                    position: fen,
                    boardOrientation: puzzle.color === "White" ? "white" : "black",
                    canDragPiece: () => solveState === "idle",
                    onPieceDrop, squareStyles: hintSquares,
                    boardStyle: { borderRadius: "var(--board-radius)", boxShadow: "var(--shadow-lg)" },
                  }} />
                </div>

                <div className="flex flex-col gap-3">
                  {/* Puzzle nav */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {puzzles.map((_, i) => (
                      <button key={i} onClick={() => goToPuzzle(i)} style={{
                        width: 28, height: 28, borderRadius: "50%", fontSize: 10, fontWeight: 700,
                        background: i === puzzleIdx ? "var(--gold)" : "var(--bg-elevated)",
                        border: `1px solid ${i === puzzleIdx ? "var(--gold)" : "var(--border)"}`,
                        color: i === puzzleIdx ? "#000" : "var(--text-muted)", cursor: "pointer",
                      }}>{i + 1}</button>
                    ))}
                  </div>

                  <div className="card" style={{ padding: 18 }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 5, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                        {PHASE_ICON[puzzle.phase] ?? "◆"} {puzzle.phase}
                      </span>
                      {(() => {
                        const key = Object.keys(CLF_COLORS).find(k => puzzle.classification.includes(k));
                        const color = key ? CLF_COLORS[key] : "var(--text-muted)";
                        return key ? (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 5, background: color + "18", border: `1px solid ${color}40`, color }}>
                            {key} −{puzzle.cp_loss}cp
                          </span>
                        ) : null;
                      })()}
                    </div>
                    <p style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)", marginBottom: 4 }}>{puzzle.color} to move.</p>
                    <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
                      Find the best response in this {puzzle.phase.toLowerCase()} position.
                    </p>
                  </div>

                  {solveState !== "idle" && (
                    <div key={`game-${puzzleIdx}-${solveState}`} style={{
                      background: solveState === "correct" ? "rgba(34,197,94,0.09)" : solveState === "wrong" ? "rgba(224,82,82,0.09)" : "rgba(201,162,68,0.09)",
                      border: "1px solid " + (solveState === "correct" ? "rgba(34,197,94,0.3)" : solveState === "wrong" ? "rgba(224,82,82,0.3)" : "rgba(201,162,68,0.3)"),
                      borderRadius: 12, padding: 16,
                      animation: solveState === "correct" ? "pop-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both" : "fade-up 0.3s ease both",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 16, color: solveState === "correct" ? "var(--accent-green)" : solveState === "wrong" ? "var(--clr-blunder)" : "var(--gold)" }}>
                          {solveState === "correct" ? "✓" : solveState === "wrong" ? "✗" : "◈"}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: solveState === "correct" ? "var(--accent-green)" : solveState === "wrong" ? "var(--clr-blunder)" : "var(--gold-light)" }}>
                          {solveState === "correct" ? "Correct!" : solveState === "wrong" ? `Not quite — you played ${playedSan}` : "Here's the answer"}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Best:</span>
                        <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: "var(--accent-green)" }}>{puzzle.best_move_san}</span>
                      </div>
                      {continuationLine.length > 1 && (
                        <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10 }}>
                          <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 6 }}>Line</p>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {continuationLine.map((m, i) => (
                              <span key={i} style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: i === 0 ? "var(--accent-green)" : "var(--text-secondary)", background: i === 0 ? "rgba(34,197,94,0.1)" : "var(--bg-elevated)", padding: "2px 6px", borderRadius: 4 }}>{m}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {solveState === "idle" && (
                      <>
                        <button onClick={() => setHintLevel(l => Math.min(l + 1, 2))} disabled={hintLevel >= 2}
                          style={{ padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: hintLevel >= 2 ? "default" : "pointer", background: hintLevel > 0 ? "rgba(201,162,68,0.1)" : "var(--bg-elevated)", border: `1px solid ${hintLevel > 0 ? "rgba(201,162,68,0.35)" : "var(--border)"}`, color: hintLevel > 0 ? "var(--gold-light)" : "var(--text-secondary)", opacity: hintLevel >= 2 ? 0.5 : 1 }}>
                          💡 {hintLevel === 0 ? "Hint" : hintLevel === 1 ? "More hint" : "Max hints"}
                        </button>
                        <button onClick={showSolution} style={{ padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                          Show answer
                        </button>
                      </>
                    )}
                    {solveState === "wrong" && (
                      <button onClick={retryPuzzle} style={{ padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", background: "rgba(224,82,82,0.08)", border: "1px solid rgba(224,82,82,0.3)", color: "var(--clr-blunder)" }}>
                        ↺ Try again
                      </button>
                    )}
                    {puzzleIdx > 0 && (
                      <button onClick={() => goToPuzzle(puzzleIdx - 1)} style={{ padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>← Prev</button>
                    )}
                    {solveState !== "idle" && puzzleIdx < puzzles.length - 1 && (
                      <button onClick={handleNext} className="btn-gold" style={{ padding: "8px 16px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>Next →</button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

      </main>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pop-in {
          0%   { opacity: 0; transform: scale(0.88) translateY(8px); }
          70%  { transform: scale(1.02) translateY(-1px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20%     { transform: translateX(-6px); }
          40%     { transform: translateX(6px); }
          60%     { transform: translateX(-4px); }
          80%     { transform: translateX(4px); }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}

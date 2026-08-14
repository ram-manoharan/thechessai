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
  getPuzzleQueue, getMistakeFingerprint, recordPuzzleProgress, getPuzzleStats,
  type PuzzleData, type MistakeTheme, type PuzzleStats,
} from "@/lib/api";
import { THEME_GLOSSARY } from "@/lib/chess-utils";

const Chessboard = dynamic(
  () => import("react-chessboard").then(m => m.Chessboard),
  { ssr: false, loading: () => <div style={{ aspectRatio: "1/1", background: "var(--bg-elevated)", borderRadius: 12 }} className="animate-pulse" /> }
);

// ── Types ────────────────────────────────────────────────────────────────────

type SolveState = "idle" | "partial" | "correct" | "wrong" | "shown";
type PuzzleResult = "correct" | "wrong" | null;

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

function puzzleColor(fen: string): "white" | "black" {
  return fen.split(" ")[1] === "w" ? "white" : "black";
}

function displayColor(fen: string): "White" | "Black" {
  return fen.split(" ")[1] === "w" ? "White" : "Black";
}

function resultIcon(r: string | null): string {
  if (r === "1-0") return "♔";
  if (r === "0-1") return "♚";
  if (r === "1/2-1/2") return "½";
  return "·";
}

const PHASE_ICON: Record<string, string> = { Opening: "♙", Middlegame: "♛", Endgame: "♔" };
const CLF_COLORS: Record<string, string> = {
  Blunder: "var(--clr-blunder)", Mistake: "var(--clr-mistake)", Inaccuracy: "var(--clr-inaccuracy)",
};

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const w = 52, h = 18, pad = 2;
  const max = Math.max(...data, 1), min = Math.min(...data, 0), range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });
  const [lx, ly] = pts[pts.length - 1].split(",");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
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
      <div style={{ padding: "12px 20px", display: "flex", alignItems: "center", gap: 10, borderRight: "1px solid var(--border)" }}>
        <span style={{ fontSize: 22 }}>🔥</span>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: stats.daily_streak > 0 ? "var(--gold)" : "var(--text-muted)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{stats.daily_streak}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em", marginTop: 1 }}>day streak</div>
        </div>
      </div>
      <div style={{ flex: 1, padding: "12px 20px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 5 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Today's session</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{todayTotal} / {stats.session_goal}</span>
        </div>
        <div style={{ height: 5, background: "var(--bg-elevated)", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: pct >= 100 ? "var(--accent-green)" : "linear-gradient(90deg, var(--accent-blue) 0%, var(--gold) 100%)", borderRadius: 3, transition: "width 0.5s ease" }} />
        </div>
      </div>
      <div style={{ padding: "12px 20px", display: "flex", alignItems: "center", gap: 8, borderLeft: "1px solid var(--border)" }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{stats.total_solved}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>total solved</div>
        </div>
        <span style={{ fontSize: 18 }}>✓</span>
      </div>
    </div>
  );
}

// ── SessionDots ───────────────────────────────────────────────────────────────

function SessionDots({ results, current, total }: { results: PuzzleResult[]; current: number; total: number }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 18 }}>
      {Array.from({ length: total }, (_, i) => {
        const r = results[i];
        const active = i === current;
        const bg = r === "correct" ? "var(--accent-green)" : r === "wrong" ? "var(--clr-blunder)" : active ? "var(--gold)" : "var(--bg-elevated)";
        return (
          <div key={i} style={{
            width: 13, height: 13, borderRadius: "50%", flexShrink: 0,
            background: bg,
            border: `2px solid ${active ? "var(--gold)" : r ? "transparent" : "var(--border)"}`,
            boxShadow: active ? "0 0 0 3px rgba(201,162,68,0.2)" : r === "correct" ? "0 0 6px rgba(34,197,94,0.3)" : "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.3s ease",
          }}>
            {r === "correct" && <span style={{ fontSize: 7, color: "#fff", fontWeight: 900 }}>✓</span>}
            {r === "wrong"   && <span style={{ fontSize: 7, color: "#fff", fontWeight: 900 }}>✗</span>}
          </div>
        );
      })}
      <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4, fontVariantNumeric: "tabular-nums" }}>
        Puzzle {current + 1} of {total}
      </span>
    </div>
  );
}

// ── GameContextCard (shown BEFORE solving) ────────────────────────────────────

function GameContextCard({ puzzle, themes, themeRank }: { puzzle: PuzzleData; themes: MistakeTheme[]; themeRank: number | null }) {
  const isLichess = puzzle.source === "lichess";
  const resultColor = puzzle.game_result === "1-0" ? "var(--accent-green)" : puzzle.game_result === "0-1" ? "var(--clr-blunder)" : "var(--text-muted)";

  return (
    <div className="card" style={{ padding: 18, marginBottom: 12 }}>
      {/* Source context */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: isLichess ? "rgba(91,142,245,0.12)" : "rgba(201,162,68,0.12)",
          border: `1px solid ${isLichess ? "rgba(91,142,245,0.3)" : "rgba(201,162,68,0.3)"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18,
        }}>
          {isLichess ? "♟" : "🎮"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: isLichess ? "var(--accent-blue)" : "var(--gold)", marginBottom: 3 }}>
            {isLichess ? "Lichess game" : "Your game"}
          </div>
          {/* Players line */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
              {puzzle.game_white}
              {puzzle.game_white_rating != null && (
                <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)", marginLeft: 3 }}>({puzzle.game_white_rating})</span>
              )}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>vs</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
              {puzzle.game_black}
              {puzzle.game_black_rating != null && (
                <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)", marginLeft: 3 }}>({puzzle.game_black_rating})</span>
              )}
            </span>
          </div>
          {/* Result + event line */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
            {puzzle.game_result && (
              <span style={{ fontSize: 12, fontWeight: 700, color: resultColor }}>
                {resultIcon(puzzle.game_result)} {puzzle.game_result_display || puzzle.game_result}
              </span>
            )}
            {puzzle.game_event && puzzle.game_event !== "Lichess" && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>· {puzzle.game_event}</span>
            )}
            {puzzle.game_date && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>· {puzzle.game_date.substring(0, 7)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop: "1px solid var(--border)", marginBottom: 14 }} />

      {/* Badges row */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {/* Phase */}
        <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 5, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
          {PHASE_ICON[puzzle.phase] ?? "◆"} {puzzle.phase}
        </span>
        {/* Classification — severity only, no theme name */}
        {(() => {
          const key = Object.keys(CLF_COLORS).find(k => puzzle.classification?.includes(k));
          const color = key ? CLF_COLORS[key] : "var(--text-muted)";
          return key ? (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 5, background: color + "18", border: `1px solid ${color}40`, color }}>
              {key === "Blunder" ? "??" : key === "Mistake" ? "?" : "?!"} {key}
              {puzzle.cp_loss > 0 ? ` −${puzzle.cp_loss}cp` : ""}
            </span>
          ) : null;
        })()}
        {/* Weakness rank badge — NO theme name, just rank */}
        {themeRank !== null && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 5,
            background: "rgba(91,142,245,0.1)", border: "1px solid rgba(91,142,245,0.25)",
            color: "var(--accent-blue)",
          }}>
            ⚠ Your #{themeRank + 1} weakness
          </span>
        )}
        {/* Multi-move indicator */}
        {puzzle.solution_sans && puzzle.solution_sans.length > 1 && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 5, background: "rgba(201,162,68,0.08)", border: "1px solid rgba(201,162,68,0.25)", color: "var(--gold-light)" }}>
            {puzzle.solution_sans.length}-move puzzle
          </span>
        )}
        {/* Lichess puzzle rating */}
        {puzzle.rating != null && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 5, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
            ★ {puzzle.rating}
          </span>
        )}
      </div>

      {/* Setup move context */}
      {puzzle.setup_move_san && (
        <div style={{ background: "var(--bg-elevated)", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
            Your opponent just played{" "}
            <span style={{ fontFamily: "monospace", fontWeight: 800, color: "var(--text-primary)", fontSize: 13 }}>
              {puzzle.setup_move_san}
            </span>
            {" "} — what's the best response?
          </p>
        </div>
      )}

      {/* Prompt */}
      <p style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)", margin: 0 }}>
        {displayColor(puzzle.fen)} to move.
        {puzzle.solution_sans && puzzle.solution_sans.length > 1
          ? ` Find the best ${puzzle.solution_sans.length}-move continuation.`
          : " Find the best move."}
      </p>
    </div>
  );
}

// ── Post-solve ThemeReveal ─────────────────────────────────────────────────────

function ThemeReveal({ puzzle }: { puzzle: PuzzleData }) {
  const themeLabel = puzzle.theme_label || puzzle.theme;
  const glossary = THEME_GLOSSARY[puzzle.theme_lichess] || THEME_GLOSSARY[puzzle.theme] || "";

  return (
    <div style={{
      background: "rgba(91,142,245,0.06)", border: "1px solid rgba(91,142,245,0.2)",
      borderRadius: 10, padding: "12px 16px",
      animation: "fade-up 0.4s ease both",
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--accent-blue)", marginBottom: 6 }}>
        Tactic revealed
      </div>
      <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
        {themeLabel.split("—")[0].trim()}
      </p>
      {glossary && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
          {glossary.includes("—") ? glossary.split("—").slice(1).join("—").trim() : glossary}
        </p>
      )}
      {puzzle.lichess_url && (
        <a href={puzzle.lichess_url} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 10, color: "var(--accent-blue)", marginTop: 8, display: "inline-block", opacity: 0.7 }}>
          View game on Lichess ↗
        </a>
      )}
    </div>
  );
}

// ── SolutionLine ──────────────────────────────────────────────────────────────

function SolutionLine({ line, solvedUpTo }: { line: string[]; solvedUpTo: number }) {
  if (!line.length) return null;
  return (
    <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10 }}>
      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 6 }}>
        Best continuation
      </p>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        {line.map((move, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            <span style={{
              fontFamily: "monospace", fontWeight: 700, fontSize: 12,
              color: i < solvedUpTo ? "var(--accent-green)" : i === solvedUpTo ? "var(--gold-light)" : "var(--text-secondary)",
              background: i < solvedUpTo ? "rgba(34,197,94,0.12)" : i === solvedUpTo ? "rgba(201,162,68,0.12)" : "var(--bg-elevated)",
              padding: "2px 6px", borderRadius: 4,
            }}>
              {move}
            </span>
            {i < line.length - 1 && <span style={{ color: "var(--border)", fontSize: 10 }}>›</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PuzzlesPage() {
  const { status: sessionStatus } = useSession();
  const signedIn = sessionStatus === "authenticated";

  const [puzzles,        setPuzzles]        = useState<PuzzleData[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState("");
  const [puzzleIdx,      setPuzzleIdx]      = useState(0);
  const [solveState,     setSolveState]     = useState<SolveState>("idle");
  const [solutionStep,   setSolutionStep]   = useState(0);  // Which solution move we're waiting for
  const [fen,            setFen]            = useState("");
  const [hintLevel,      setHintLevel]      = useState(0);
  const [themes,         setThemes]         = useState<MistakeTheme[]>([]);
  const [stats,          setStats]          = useState<PuzzleStats | null>(null);
  const [sessionResults, setSessionResults] = useState<PuzzleResult[]>([]);
  const [sessionDone,    setSessionDone]    = useState(false);
  const [playedSan,      setPlayedSan]      = useState("");
  const [topThemes,      setTopThemes]      = useState<string[]>([]);

  const chessRef   = useRef<Chess | null>(null);
  const autoAdvRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const SESSION_GOAL = 5;
  const puzzle = puzzles[puzzleIdx] ?? null;
  const sessionCorrect = sessionResults.filter(r => r === "correct").length;

  // ── Load ───────────────────────────────────────────────────────────────────

  const loadQueue = useCallback(() => {
    if (!signedIn) return;
    setLoading(true);
    setError("");
    setSessionResults([]);
    setSessionDone(false);
    Promise.all([getPuzzleQueue(SESSION_GOAL), getMistakeFingerprint(5), getPuzzleStats()])
      .then(([q, fp, st]) => {
        setPuzzles(q.puzzles);
        setTopThemes(q.top_themes);
        setThemes(fp.themes);
        setStats(st);
        setLoading(false);
        if (q.puzzles.length > 0) initPuzzle(q.puzzles[0], 0);
      })
      .catch(e => { setError((e as Error).message); setLoading(false); });
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const initPuzzle = useCallback((p: PuzzleData, idx: number) => {
    if (autoAdvRef.current) clearTimeout(autoAdvRef.current);
    try {
      chessRef.current = new Chess(p.fen);
    } catch {
      chessRef.current = new Chess();
    }
    setFen(p.fen);
    setSolveState("idle");
    setSolutionStep(0);
    setHintLevel(0);
    setPlayedSan("");
    setPuzzleIdx(idx);
  }, []);

  // ── Hint squares ───────────────────────────────────────────────────────────

  const hintSquares = useMemo<Record<string, { backgroundColor: string }>>(() => {
    if (hintLevel === 0 || !puzzle) return {};
    const targetSan = puzzle.solution_sans?.[solutionStep] ?? puzzle.best_move_san;
    try {
      const c = new Chess(fen);
      const moves = c.moves({ verbose: true });
      const target = moves.find(m => m.san === targetSan);
      if (!target) return {};
      const sq: Record<string, { backgroundColor: string }> = {};
      if (hintLevel >= 1) sq[target.from] = { backgroundColor: "rgba(201,162,68,0.65)" };
      if (hintLevel >= 2) sq[target.to]   = { backgroundColor: "rgba(201,162,68,0.85)" };
      return sq;
    } catch { return {}; }
  }, [hintLevel, puzzle, fen, solutionStep]);

  // ── Progress recording ─────────────────────────────────────────────────────

  const recordProgress = useCallback((p: PuzzleData, solved: boolean) => {
    const promise = p.source === "lichess" && p.puzzle_id
      ? recordPuzzleProgress({ puzzleId: p.puzzle_id, source: "lichess", solved })
      : p.fen
        ? recordPuzzleProgress({ puzzleFen: p.fen, source: "own_game", solved })
        : Promise.resolve(null);
    if (solved) {
      promise
        .then(res => {
          if (res) setStats(prev => prev ? { ...prev, total_solved: prev.total_solved + 1, daily_streak: res.streak } : prev);
        })
        .catch(() => {});
    } else {
      promise.catch(() => {});
    }
  }, []);

  // ── Session advance ─────────────────────────────────────────────────────────

  const advanceSession = useCallback((result: PuzzleResult, currentIdx: number) => {
    setSessionResults(prev => { const n = [...prev]; n[currentIdx] = result; return n; });
    if (currentIdx + 1 < puzzles.length) {
      autoAdvRef.current = setTimeout(() => initPuzzle(puzzles[currentIdx + 1], currentIdx + 1), 1600);
    } else {
      autoAdvRef.current = setTimeout(() => {
        setSessionDone(true);
        getPuzzleStats().then(setStats).catch(() => {});
      }, 1600);
    }
  }, [puzzles, initPuzzle]);

  // ── On piece drop ──────────────────────────────────────────────────────────

  const onPieceDrop = useCallback(({ sourceSquare: from, targetSquare: toOrNull }: PieceDropHandlerArgs) => {
    if (!chessRef.current || !puzzle || !toOrNull || solveState === "correct" || solveState === "shown") return false;
    try {
      const move = chessRef.current.move({ from, to: toOrNull, promotion: "q" });
      if (!move) return false;

      const san = move.san;
      setPlayedSan(san);
      const newFen = chessRef.current.fen();

      const solutionSans = puzzle.solution_sans?.length ? puzzle.solution_sans : [puzzle.best_move_san];
      const expectedSan  = solutionSans[solutionStep] ?? "";
      const isCorrectMove = san === expectedSan;

      if (!isCorrectMove) {
        // Wrong move — snap back
        chessRef.current.undo();
        setFen(fen); // unchanged
        setSolveState("wrong");
        if (solutionStep === 0) {
          recordProgress(puzzle, false);
          advanceSession("wrong", puzzleIdx);
        }
        return false;
      }

      setFen(newFen);

      const nextStep = solutionStep + 1;
      const isLastMove = nextStep >= solutionSans.length;

      if (isLastMove) {
        // All solution moves found — correct!
        setSolveState("correct");
        recordProgress(puzzle, true);
        advanceSession("correct", puzzleIdx);
      } else {
        // More moves needed — auto-play opponent response and continue
        setSolveState("partial");
        setSolutionStep(nextStep);

        const responseSans = puzzle.response_sans ?? [];
        const responseToPlay = responseSans[solutionStep]; // same index (response after user move N)

        if (responseToPlay) {
          setTimeout(() => {
            try {
              if (!chessRef.current) return;
              const resp = chessRef.current.move(responseToPlay);
              if (resp) {
                setFen(chessRef.current.fen());
                setSolveState("idle");
              }
            } catch { /* ignore */ }
          }, 500);
        } else {
          // No more opponent response — keep going
          setSolveState("idle");
        }
      }

      return true;
    } catch { return false; }
  }, [puzzle, solveState, solutionStep, fen, puzzleIdx, recordProgress, advanceSession]);

  // ── Show solution ──────────────────────────────────────────────────────────

  const showSolution = useCallback(() => {
    if (!puzzle) return;
    const solutionSans = puzzle.solution_sans?.length ? puzzle.solution_sans : [puzzle.best_move_san];
    try {
      const c = new Chess(puzzle.fen);
      const allMoves = solutionSans.flatMap((s, i) => [s, puzzle.response_sans?.[i] ?? ""].filter(Boolean));
      for (const san of allMoves) {
        try { c.move(san); } catch { break; }
      }
      chessRef.current = c;
      setFen(c.fen());
    } catch { /* leave position as-is */ }
    setSolveState("shown");
    recordProgress(puzzle, false);
    const result: PuzzleResult = "wrong";
    setSessionResults(prev => { const n = [...prev]; n[puzzleIdx] = result; return n; });
  }, [puzzle, puzzleIdx, recordProgress]);

  const retryPuzzle = useCallback(() => {
    if (!puzzle) return;
    if (autoAdvRef.current) clearTimeout(autoAdvRef.current);
    try { chessRef.current = new Chess(puzzle.fen); } catch { chessRef.current = new Chess(); }
    setFen(puzzle.fen);
    setSolveState("idle");
    setSolutionStep(0);
    setHintLevel(0);
    setPlayedSan("");
    setSessionResults(prev => { const n = [...prev]; n[puzzleIdx] = null; return n; });
  }, [puzzle, puzzleIdx]);

  const handleNext = useCallback(() => {
    if (autoAdvRef.current) clearTimeout(autoAdvRef.current);
    // Make sure result is recorded before advancing
    if (!sessionResults[puzzleIdx]) {
      setSessionResults(prev => { const n = [...prev]; n[puzzleIdx] = "wrong"; return n; });
    }
    if (puzzleIdx + 1 < puzzles.length) {
      initPuzzle(puzzles[puzzleIdx + 1], puzzleIdx + 1);
    } else {
      setSessionDone(true);
    }
  }, [puzzleIdx, puzzles, sessionResults, initPuzzle]);

  // ── Theme rank for current puzzle ──────────────────────────────────────────

  const themeRank = useMemo(() => {
    if (!puzzle || !themes.length) return null;
    const idx = themes.findIndex(t => t.theme === puzzle.theme);
    return idx >= 0 ? idx : null;
  }, [puzzle, themes]);

  const nextDueText = stats?.next_due_at ? formatTimeUntil(stats.next_due_at) : null;

  // ── Which step are we showing in the full solution line? ──────────────────
  const solvedUpTo = useMemo(() => {
    if (solveState === "correct" || solveState === "shown") return 999;
    return solutionStep;
  }, [solveState, solutionStep]);

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
            Train your <em className="not-italic" style={{ background: "linear-gradient(90deg, var(--gold) 0%, #fff 180%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>weak spots.</em>
          </h1>
          {topThemes.length > 0 && (
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              Targeting: {topThemes.slice(0, 3).join(" · ")}
            </p>
          )}
        </div>

        {/* Not signed in */}
        {!signedIn && sessionStatus !== "loading" && (
          <div className="card" style={{ padding: "32px 28px", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
            <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: "var(--text-primary)" }}>Sign in to access daily training</p>
            <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20, lineHeight: 1.7 }}>
              Puzzles are matched to your weaknesses and tracked across sessions with spaced repetition.
            </p>
            <Link href="/login?callbackUrl=/puzzles" className="btn-gold" style={{ padding: "10px 24px", borderRadius: 10, fontSize: 13, display: "inline-block", textDecoration: "none" }}>Sign in</Link>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="card" style={{ padding: 36, textAlign: "center" }}>
            <div style={{ position: "relative", width: 36, height: 36, margin: "0 auto 16px" }}>
              <div style={{ width: 36, height: 36, border: "2.5px solid rgba(91,142,245,0.2)", borderTopColor: "var(--accent-blue)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <div style={{ position: "absolute", inset: 6, border: "2px solid rgba(201,162,68,0.2)", borderBottomColor: "var(--gold)", borderRadius: "50%", animation: "spin 1.3s linear infinite reverse" }} />
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: 13, fontWeight: 500 }}>Finding puzzles for your weaknesses…</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: "rgba(224,82,82,0.1)", border: "1px solid rgba(224,82,82,0.3)", color: "var(--clr-blunder)", padding: "12px 16px", borderRadius: 10, marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* ── No puzzles ever ───────────────────────────────────────────── */}
        {!loading && !error && signedIn && puzzles.length === 0 && stats && stats.total_saved === 0 && (
          <div className="card" style={{ padding: "32px 28px", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>♟</div>
            <p style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)", marginBottom: 8 }}>No puzzles yet</p>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7, marginBottom: 20 }}>
              Analyze a game first. Puzzles are extracted from your mistakes and combined with
              curated positions from the Lichess puzzle database targeting your weak areas.
            </p>
            <Link href="/analyze" className="btn-gold" style={{ padding: "10px 24px", borderRadius: 10, fontSize: 13, display: "inline-block", textDecoration: "none" }}>
              Analyze a game
            </Link>
          </div>
        )}

        {/* ── All caught up ─────────────────────────────────────────────── */}
        {!loading && !error && signedIn && puzzles.length === 0 && stats && stats.total_saved > 0 && !sessionDone && (
          <div className="card" style={{ padding: "40px 28px", textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 14, lineHeight: 1 }}>🎉</div>
            <p style={{ fontWeight: 800, fontSize: 20, color: "var(--text-primary)", marginBottom: 8 }}>All caught up!</p>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7, marginBottom: nextDueText ? 6 : 20 }}>
              Spaced repetition is working — puzzles will reappear when you're most likely to forget them.
            </p>
            {nextDueText && (
              <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 20 }}>
                Next puzzle due in <strong style={{ color: "var(--gold)" }}>{nextDueText}</strong>
              </p>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              {stats.daily_streak > 0 && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(201,162,68,0.08)", border: "1px solid rgba(201,162,68,0.25)", borderRadius: 10, padding: "10px 18px" }}>
                  <span style={{ fontSize: 20 }}>🔥</span>
                  <span style={{ fontWeight: 700, color: "var(--gold)", fontSize: 14 }}>{stats.daily_streak}-day streak</span>
                </div>
              )}
              <Link href="/analyze" style={{ padding: "10px 20px", borderRadius: 10, fontSize: 13, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)", textDecoration: "none", display: "inline-block" }}>
                Analyze another game
              </Link>
            </div>
          </div>
        )}

        {/* ── Stats bar (shown when puzzle is active) ────────────────────── */}
        {stats && !loading && puzzle && !sessionDone && <StatsBar stats={stats} sessionCorrect={sessionCorrect} />}

        {/* ── SESSION COMPLETE ──────────────────────────────────────────── */}
        {sessionDone && (
          <div className="card" style={{ padding: "40px 28px", textAlign: "center", animation: "pop-in 0.45s cubic-bezier(0.34,1.56,0.64,1) both" }}>
            <div style={{ fontSize: 52, marginBottom: 14, lineHeight: 1 }}>
              {sessionCorrect >= puzzles.length ? "🏆" : sessionCorrect >= Math.ceil(puzzles.length / 2) ? "🎯" : "💪"}
            </div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, color: "var(--text-primary)", marginBottom: 6 }}>Session complete!</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 15, marginBottom: 20 }}>
              {sessionCorrect}/{puzzles.length} correct{sessionCorrect === puzzles.length ? " — flawless!" : sessionCorrect >= Math.ceil(puzzles.length / 2) ? " — solid work." : " — keep training."}
            </p>
            {/* Per-puzzle dots */}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 22 }}>
              {sessionResults.slice(0, puzzles.length).map((r, i) => (
                <div key={i} style={{ width: 16, height: 16, borderRadius: "50%", background: r === "correct" ? "var(--accent-green)" : "rgba(224,82,82,0.65)", boxShadow: r === "correct" ? "0 0 8px rgba(34,197,94,0.4)" : "0 0 6px rgba(224,82,82,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 8, color: "#fff", fontWeight: 900 }}>{r === "correct" ? "✓" : "✗"}</span>
                </div>
              ))}
            </div>
            {/* Streak */}
            {stats && stats.daily_streak > 0 && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "rgba(201,162,68,0.08)", border: "1px solid rgba(201,162,68,0.25)", borderRadius: 12, padding: "12px 22px", marginBottom: 20 }}>
                <span style={{ fontSize: 26 }}>🔥</span>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "var(--gold)", lineHeight: 1 }}>{stats.daily_streak}-day streak</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{nextDueText ? `Next puzzle in ${nextDueText}` : "Come back tomorrow!"}</div>
                </div>
              </div>
            )}
            {/* Top weakness improvement note */}
            {themes[0] && (
              <div style={{ background: "rgba(91,142,245,0.06)", border: "1px solid rgba(91,142,245,0.2)", borderRadius: 10, padding: "12px 16px", marginBottom: 22, textAlign: "left" }}>
                <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--accent-blue)", marginBottom: 4 }}>Keep drilling your top weakness</p>
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>{themes[0].theme}</p>
                {THEME_GLOSSARY[themes[0].theme] && (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>{THEME_GLOSSARY[themes[0].theme]}</p>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              {stats && stats.queue_size > 0 && (
                <button onClick={() => { setSessionDone(false); loadQueue(); }} className="btn-gold" style={{ padding: "10px 22px", borderRadius: 10, fontSize: 13, cursor: "pointer" }}>
                  More puzzles ({stats.queue_size} left)
                </button>
              )}
              <Link href="/analyze" style={{ padding: "10px 20px", borderRadius: 10, fontSize: 13, display: "inline-block", textDecoration: "none", background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>Analyze another game</Link>
            </div>
          </div>
        )}

        {/* ── ACTIVE PUZZLE ────────────────────────────────────────────── */}
        {!loading && !error && puzzle && !sessionDone && (
          <>
            <SessionDots results={sessionResults} current={puzzleIdx} total={puzzles.length} />

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-5 items-start">
              {/* Board */}
              <div>
                <Chessboard options={{
                  position: fen,
                  boardOrientation: puzzleColor(puzzle.fen) as "white" | "black",
                  canDragPiece: () => solveState === "idle",
                  onPieceDrop,
                  squareStyles: hintSquares,
                  boardStyle: { borderRadius: "var(--board-radius)", boxShadow: "var(--shadow-lg)" },
                }} />

                {/* Multi-step progress bar below board */}
                {puzzle.solution_sans && puzzle.solution_sans.length > 1 && (
                  <div style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
                    {puzzle.solution_sans.map((_, i) => (
                      <div key={i} style={{
                        flex: 1, height: 3, borderRadius: 2,
                        background: i < solutionStep || solveState === "correct" || solveState === "shown"
                          ? "var(--accent-green)"
                          : i === solutionStep && solveState === "partial"
                          ? "var(--gold)"
                          : "var(--bg-elevated)",
                        transition: "background 0.3s ease",
                      }} />
                    ))}
                    <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                      {solutionStep < puzzle.solution_sans.length && solveState !== "correct" && solveState !== "shown"
                        ? `Move ${solutionStep + 1} of ${puzzle.solution_sans.length}`
                        : "Done ✓"}
                    </span>
                  </div>
                )}
              </div>

              {/* Right panel */}
              <div className="flex flex-col gap-3">
                {/* Game context — shown BEFORE solving */}
                <GameContextCard puzzle={puzzle} themes={themes} themeRank={themeRank} />

                {/* Feedback / result card */}
                {(solveState === "correct" || solveState === "wrong" || solveState === "shown") && (
                  <div
                    key={`${puzzleIdx}-${solveState}`}
                    style={{
                      background: solveState === "correct" ? "rgba(34,197,94,0.09)" : solveState === "wrong" ? "rgba(224,82,82,0.09)" : "rgba(201,162,68,0.09)",
                      border: "1px solid " + (solveState === "correct" ? "rgba(34,197,94,0.3)" : solveState === "wrong" ? "rgba(224,82,82,0.3)" : "rgba(201,162,68,0.3)"),
                      borderRadius: 12, padding: 16,
                      animation: solveState === "correct" ? "pop-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both" : "fade-up 0.3s ease both",
                    }}>
                    {/* Result header */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 18, color: solveState === "correct" ? "var(--accent-green)" : solveState === "wrong" ? "var(--clr-blunder)" : "var(--gold)" }}>
                        {solveState === "correct" ? "✓" : solveState === "wrong" ? "✗" : "◈"}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: solveState === "correct" ? "var(--accent-green)" : solveState === "wrong" ? "var(--clr-blunder)" : "var(--gold-light)" }}>
                        {solveState === "correct" ? "Correct!" : solveState === "wrong" ? `Not quite — you played ${playedSan}` : "Here's the solution"}
                      </span>
                    </div>

                    {/* Best move */}
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Best:</span>
                      <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: "var(--accent-green)" }}>
                        {puzzle.solution_sans?.length > 1
                          ? puzzle.solution_sans.join(" · ")
                          : puzzle.best_move_san}
                      </span>
                    </div>

                    {/* Solution line */}
                    {puzzle.continuation.length > 0 && (
                      <SolutionLine line={puzzle.continuation} solvedUpTo={solvedUpTo} />
                    )}

                    {/* Theme reveal — ONLY after solving */}
                    <div style={{ marginTop: 14 }}>
                      <ThemeReveal puzzle={puzzle} />
                    </div>
                  </div>
                )}

                {/* Partial correct state hint */}
                {solveState === "partial" && (
                  <div style={{ background: "rgba(201,162,68,0.08)", border: "1px solid rgba(201,162,68,0.25)", borderRadius: 10, padding: "10px 14px", animation: "pop-in 0.3s ease both" }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "var(--gold-light)", margin: 0 }}>
                      ✓ Good move! Now find the follow-up…
                    </p>
                  </div>
                )}

                {/* Weakness panel */}
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
                          <span style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, fontSize: 9, fontWeight: 800, background: idx === 0 ? "var(--clr-blunder)" : idx === 1 ? "var(--clr-mistake)" : "var(--clr-inaccuracy)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>{idx + 1}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>{t.theme}</p>
                            <p style={{ fontSize: 10, color: "var(--text-muted)", margin: 0 }}>−{t.total_cp_loss}cp · {t.occurrences}×</p>
                          </div>
                          {t.sparkline && <Sparkline data={t.sparkline} color={idx === 0 ? "var(--clr-blunder)" : "var(--accent-blue)"} />}
                          {t.theme === puzzle.theme && solveState !== "idle" && (
                            <span style={{ fontSize: 9, fontWeight: 800, color: "var(--accent-blue)", background: "rgba(91,142,245,0.12)", padding: "2px 6px", borderRadius: 4 }}>NOW</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>
                  {solveState === "idle" && (
                    <>
                      <button onClick={() => setHintLevel(l => Math.min(l + 1, 2))} disabled={hintLevel >= 2}
                        style={{ padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: hintLevel >= 2 ? "default" : "pointer", background: hintLevel > 0 ? "rgba(201,162,68,0.1)" : "var(--bg-elevated)", border: `1px solid ${hintLevel > 0 ? "rgba(201,162,68,0.35)" : "var(--border)"}`, color: hintLevel > 0 ? "var(--gold-light)" : "var(--text-secondary)", opacity: hintLevel >= 2 ? 0.5 : 1 }}>
                        💡 {hintLevel === 0 ? "Hint" : hintLevel === 1 ? "Another hint" : "Max hints"}
                      </button>
                      <button onClick={showSolution} style={{ padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                        Show solution
                      </button>
                    </>
                  )}
                  {solveState === "wrong" && (
                    <button onClick={retryPuzzle} style={{ padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", background: "rgba(224,82,82,0.08)", border: "1px solid rgba(224,82,82,0.3)", color: "var(--clr-blunder)" }}>
                      ↺ Try again
                    </button>
                  )}
                  {(solveState === "correct" || solveState === "wrong" || solveState === "shown") && (
                    <button onClick={handleNext} className="btn-gold" style={{ padding: "8px 18px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>
                      {puzzleIdx < puzzles.length - 1 ? "Next puzzle →" : "Finish →"}
                    </button>
                  )}
                </div>

              </div>
            </div>
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
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}

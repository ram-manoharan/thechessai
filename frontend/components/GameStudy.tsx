"use client";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { Chess } from "chess.js";
import type { PieceDropHandlerArgs } from "react-chessboard";
import type { MoveData, PositionExplanation, explainPosition as ExplainFn, ChatMessage, PuzzleData } from "@/lib/api";
import { recordPuzzleProgress, chatAboutPosition, getPuzzleQueue } from "@/lib/api";
import { CLF_CONFIG, THEME_GLOSSARY, eloBandLabel, countQuality } from "@/lib/chess-utils";
import { useGameStore } from "@/lib/store";
import { DonutChart, PhaseArc, printReport, type DonutSlice, type ReportData } from "@/components/AIReport";

// ── Dynamic chessboard (no SSR) ───────────────────────────────────────────────

const StudyBoard = dynamic(
  () => import("react-chessboard").then(m => m.Chessboard),
  { ssr: false, loading: () => <div style={{ aspectRatio: "1/1", background: "var(--bg-elevated)", borderRadius: 8 }} /> }
);

// ── Types ─────────────────────────────────────────────────────────────────────

type PhaseGrade = { grade: string; note: string };

type KeyMoment = {
  move_num: number;
  san: string;
  side: string;
  label: string;
  classification: string;
  cp_loss: number | null;
  best: string | null;
  principle?: string;
  what_happened: string;
  best_explanation: string;
};

export type GameReport = {
  verdict: string;
  game_type: string;
  phase_grades: { opening: PhaseGrade; middlegame: PhaseGrade; endgame: PhaseGrade };
  key_moments: KeyMoment[];
  tactical_patterns: { name: string; description: string }[];
  strengths: { title: string; detail: string }[];
  weaknesses: { title: string; detail: string }[];
  opening: {
    name: string;
    eco: string;
    assessment: string;
    deviation: { move_num: number; san: string; note: string } | null;
    resources: unknown[];
  };
  study_plan: {
    priority_phase: string;
    items: {
      type: string;
      title?: string;
      author?: string;
      chapter?: string;
      why?: string;
      platform?: string;
      theme?: string;
      description?: string;
    }[];
    daily_routine: string;
    four_week_goal: string;
  };
  coach_note: string;
};

export type StudyPosition = {
  move_num: number;
  san: string;
  best: string;
  classification: string;
  cp_loss: number;
  phase: string;
  color: string;         // "White" | "Black" — the side that made the move
  fen_before: string;    // FEN before the bad move
  label?: string;
  what_happened?: string;
  best_explanation?: string;
  principle?: string;
  clock_remaining?: number | null;
  continuation?: string[];  // SAN moves after `best`, for multi-move re-solve
};

// ── StudyPuzzleModal ──────────────────────────────────────────────────────────

export function StudyPuzzleModal({
  position,
  playerColor,
  onClose,
  explainPositionFn,
  onSolved,
  drillInfo,
}: {
  position: StudyPosition;
  playerColor: "white" | "black";
  onClose: () => void;
  explainPositionFn: typeof ExplainFn;
  /** Fires once when the puzzle is finished — true if actually solved, false
      if the player used "Show Solution" instead. Used by drill mode to track
      the streak without reaching into internal solve state. */
  onSolved?: (correct: boolean) => void;
  /** When set, renders drill-mode chrome (progress + streak in the header,
      a "Next Puzzle" button once finished) instead of the single-puzzle UI. */
  drillInfo?: { index: number; total: number; streak: number; onNext: () => void };
}) {
  type SolveState = "idle" | "wrong" | "correct" | "shown";

  const { status: sessionStatus } = useSession();
  const estimatedElo = useGameStore(s => s.estimatedElo);
  const [solveState, setSolveState] = useState<SolveState>("idle");
  const [currentFen, setCurrentFen] = useState(position.fen_before);
  const [hintLevel, setHintLevel] = useState(0);
  const [explanation, setExplanation] = useState<PositionExplanation | null>(null);
  const [loadingExpl, setLoadingExpl] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]     = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  // Multi-move re-solve (enhancement #3): stage 0 = find the best move; if the
  // position has a real continuation, the opponent's actual reply auto-plays
  // and stage becomes 1 = find the follow-up too. Most puzzle tools stop after
  // one move, which undersells how the mistake actually cost the game.
  const [puzzleStage, setPuzzleStage] = useState<0 | 1>(0);
  const [followUpNote, setFollowUpNote] = useState<string | null>(null);
  const [awaitingReply, setAwaitingReply] = useState(false);
  // "Ask before telling" (enhancement #4): capture the player's own guess at
  // WHY the best move works before revealing the AI explanation, so learning
  // isn't just passively nodding along at an answer they never attempted.
  const [reasoningRevealed, setReasoningRevealed] = useState(false);
  const [reasoningDraft, setReasoningDraft] = useState("");
  const wrongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset everything when a new position is opened
  useEffect(() => {
    setSolveState("idle");
    setCurrentFen(position.fen_before);
    setHintLevel(0);
    setExplanation(null);
    setLoadingExpl(false);
    setChatHistory([]);
    setChatInput("");
    setPuzzleStage(0);
    setFollowUpNote(null);
    setAwaitingReply(false);
    setReasoningRevealed(false);
    setReasoningDraft("");
    return () => {
      if (wrongTimer.current) clearTimeout(wrongTimer.current);
      if (replyTimer.current) clearTimeout(replyTimer.current);
    };
  }, [position.fen_before]);

  // Load explanation once solved or shown
  useEffect(() => {
    if (solveState !== "correct" && solveState !== "shown") return;
    if (!reasoningRevealed) return;
    if (explanation || loadingExpl) return;

    if (position.what_happened && position.best_explanation) {
      setExplanation({
        why_bad: position.what_happened,
        why_good: position.best_explanation,
        theme: "",
        elo_note: position.principle ?? "",
      });
      return;
    }

    setLoadingExpl(true);
    explainPositionFn({
      fen: position.fen_before,
      played_move: position.san,
      best_move: position.best,
      phase: position.phase,
      cp_loss: position.cp_loss,
      player_color: playerColor,
      estimated_elo: estimatedElo ?? undefined,
      clock_remaining: position.clock_remaining ?? undefined,
      player_reasoning: reasoningDraft.trim() || undefined,
    })
      .then(r => setExplanation(r))
      .catch(() =>
        setExplanation({
          why_bad: `${position.san} was not the best choice in this position.`,
          why_good: `${position.best} was the engine's recommendation here.`,
          theme: "",
          elo_note: "",
        }),
      )
      .finally(() => setLoadingExpl(false));
  }, [solveState, reasoningRevealed, reasoningDraft, explanation, loadingExpl, position, playerColor, explainPositionFn, estimatedElo]);

  const handleSendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    const nextHistory: ChatMessage[] = [...chatHistory, { role: "user", content: text }];
    setChatHistory(nextHistory);
    setChatInput("");
    setChatLoading(true);
    chatAboutPosition({
      fen: position.fen_before,
      played_move: position.san,
      best_move: position.best,
      player_color: playerColor,
      estimated_elo: estimatedElo ?? undefined,
      history: nextHistory,
    })
      .then(r => setChatHistory(h => [...h, { role: "assistant", content: r.reply }]))
      .catch(() => setChatHistory(h => [...h, { role: "assistant", content: "Sorry, I couldn't answer that — try again." }]))
      .finally(() => setChatLoading(false));
  }, [chatInput, chatLoading, chatHistory, position, playerColor, estimatedElo]);

  // Has a real follow-up to ask for: continuation[0] is the opponent's actual
  // reply (auto-played), continuation[1] is the move we'll ask the user to find.
  const hasFollowUp = (position.continuation?.length ?? 0) >= 2;

  const targetSan = puzzleStage === 0 ? position.best : (position.continuation?.[1] ?? "");

  // Hint squares — targets whichever move is currently being asked for.
  const hintSquares = useMemo<Record<string, React.CSSProperties>>(() => {
    if (hintLevel < 1 || !targetSan) return {};
    try {
      const chess = new Chess(currentFen);
      const mv = chess.move(targetSan);
      if (!mv) return {};
      const sq: Record<string, React.CSSProperties> = {
        [mv.from]: { background: "rgba(91,142,245,0.4)" },
      };
      if (hintLevel >= 2) sq[mv.to] = { background: "rgba(91,142,245,0.65)" };
      return sq;
    } catch { return {}; }
  }, [hintLevel, currentFen, targetSan]);

  const handlePieceDrop = useCallback(({ sourceSquare: from, targetSquare: toRaw }: PieceDropHandlerArgs) => {
    if (!toRaw) return false;
    const to = toRaw;
    if (solveState !== "idle" && solveState !== "wrong") return false;
    if (awaitingReply) return false;
    if (wrongTimer.current) clearTimeout(wrongTimer.current);

    try {
      const chess = new Chess(currentFen);
      const played = chess.move({ from, to, promotion: "q" });
      if (!played) return false;

      const cmp = new Chess(currentFen);
      const target = targetSan ? cmp.move(targetSan) : null;
      const isCorrect = target && played.from === target.from && played.to === target.to;

      if (isCorrect) {
        setCurrentFen(chess.fen());
        setHintLevel(0);

        if (puzzleStage === 0 && hasFollowUp) {
          // Auto-play the opponent's real reply, then ask for the follow-up.
          setAwaitingReply(true);
          replyTimer.current = setTimeout(() => {
            try {
              const afterReply = new Chess(chess.fen());
              afterReply.move(position.continuation![0]);
              setCurrentFen(afterReply.fen());
              setPuzzleStage(1);
            } catch {
              // Continuation didn't apply cleanly (rare PGN/SAN edge case) —
              // fall back to treating the first move as the whole puzzle.
              setSolveState("correct");
              if (sessionStatus === "authenticated") {
                recordPuzzleProgress({ puzzleFen: position.fen_before, source: "own_game", solved: true }).catch(() => {});
              }
            } finally {
              setAwaitingReply(false);
            }
          }, 550);
        } else {
          setSolveState("correct");
          if (sessionStatus === "authenticated") {
            // Fire-and-forget — a failed progress write shouldn't block the
            // puzzle UI from showing "Correct!".
            recordPuzzleProgress({ puzzleFen: position.fen_before, source: "own_game", solved: true }).catch(() => {});
          }
        }
      } else if (puzzleStage === 1) {
        // Lenient on the follow-up: the player already found the key idea in
        // the first move, which is the actual lesson — don't make them redo it.
        setFollowUpNote(`Close — the sharper follow-up was ${targetSan}, but you'd already found the key idea.`);
        setSolveState("correct");
        if (sessionStatus === "authenticated") {
          recordPuzzleProgress({ puzzleFen: position.fen_before, source: "own_game", solved: true }).catch(() => {});
        }
      } else {
        setSolveState("wrong");
        wrongTimer.current = setTimeout(() => {
          setCurrentFen(position.fen_before);
          setSolveState("idle");
        }, 1300);
      }
      return true;
    } catch { return false; }
  }, [solveState, awaitingReply, currentFen, targetSan, puzzleStage, hasFollowUp, position, sessionStatus]);

  function showSolution() {
    if (wrongTimer.current) clearTimeout(wrongTimer.current);
    if (replyTimer.current) clearTimeout(replyTimer.current);
    try {
      const chess = new Chess(position.fen_before);
      chess.move(position.best);
      if (hasFollowUp) {
        chess.move(position.continuation![0]);
        chess.move(position.continuation![1]);
      }
      setCurrentFen(chess.fen());
    } catch { /* leave board as-is */ }
    setPuzzleStage(hasFollowUp ? 1 : 0);
    setAwaitingReply(false);
    setSolveState("shown");
  }

  function retry() {
    if (wrongTimer.current) clearTimeout(wrongTimer.current);
    if (replyTimer.current) clearTimeout(replyTimer.current);
    setSolveState("idle");
    setCurrentFen(position.fen_before);
    setHintLevel(0);
    setPuzzleStage(0);
    setFollowUpNote(null);
    setAwaitingReply(false);
  }

  const cfg = CLF_CONFIG[position.classification as keyof typeof CLF_CONFIG];
  const cfgColor = cfg?.color ?? "var(--clr-blunder)";
  const cfgBadge = cfg?.badge ?? "?";
  const boardOrientation = position.color.toLowerCase() as "white" | "black";
  const showExpl = solveState === "correct" || solveState === "shown";

  const onSolvedRef = useRef(onSolved);
  useEffect(() => { onSolvedRef.current = onSolved; });
  useEffect(() => {
    if (solveState === "correct") onSolvedRef.current?.(true);
    else if (solveState === "shown") onSolvedRef.current?.(false);
  }, [solveState]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9990,
        background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: "min(920px, 100%)",
          maxHeight: "calc(100vh - 32px)",
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 40px 100px rgba(0,0,0,0.65)",
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "center", gap: 10,
            flexShrink: 0,
            background: "var(--bg-elevated)",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 800, color: cfgColor }}>
            {cfgBadge} {position.classification}
          </span>
          {position.move_num > 0 && (
            <>
              <span style={{ color: "var(--border)", fontSize: 12 }}>·</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Move {position.move_num}</span>
            </>
          )}
          <span style={{ color: "var(--border)", fontSize: 12 }}>·</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{position.phase}</span>
          {drillInfo && (
            <>
              <span style={{ color: "var(--border)", fontSize: 12 }}>·</span>
              <span
                style={{
                  fontSize: 11, fontWeight: 700, color: "var(--gold)",
                  background: "var(--gold-subtle)", border: "1px solid var(--gold-border)",
                  borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap",
                }}
              >
                Puzzle {drillInfo.index + 1}/{drillInfo.total}
                {drillInfo.streak > 0 ? ` · 🔥 ${drillInfo.streak} streak` : ""}
              </span>
            </>
          )}
          {position.label && (
            <>
              <span style={{ color: "var(--border)", fontSize: 12 }}>·</span>
              <span style={{ fontSize: 13, color: "var(--text-primary)", fontStyle: "italic", fontWeight: 600 }}>
                &ldquo;{position.label}&rdquo;
              </span>
            </>
          )}
          <span
            title={estimatedElo != null
              ? `Explanations below are calibrated to ~${estimatedElo} Elo (from this game's own rating/accuracy) — vocabulary and depth change by level.`
              : "No rating detected for this game — defaulting to Intermediate-level explanations."}
            style={{
              marginLeft: "auto",
              fontSize: 10, fontWeight: 700, color: "#5b8ef5",
              background: "rgba(91,142,245,0.1)", border: "1px solid rgba(91,142,245,0.25)",
              borderRadius: 6, padding: "3px 8px", cursor: "help", whiteSpace: "nowrap",
            }}
          >
            {"🎯 "}{eloBandLabel(estimatedElo)}{estimatedElo != null ? ` (~${estimatedElo})` : ""}
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none",
              color: "var(--text-muted)", fontSize: 22, cursor: "pointer",
              lineHeight: 1, padding: "2px 6px", borderRadius: 6,
            }}
          >
            ×
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>

          {/* Board column */}
          <div
            style={{
              padding: 20, display: "flex", flexDirection: "column", gap: 10,
              borderRight: "1px solid var(--border)", flexShrink: 0,
              background: "var(--bg-base)",
            }}
          >
            <div style={{ width: 340, height: 340, borderRadius: 8, overflow: "hidden" }}>
              <StudyBoard
                options={{
                  position: currentFen,
                  onPieceDrop: handlePieceDrop,
                  boardOrientation,
                  allowDragging: (solveState === "idle" || solveState === "wrong") && !awaitingReply,
                  squareStyles: hintSquares,
                  boardStyle: { borderRadius: 6 },
                }}
              />
            </div>

            {/* Controls row */}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setHintLevel(h => Math.min(h + 1, 2))}
                disabled={solveState !== "idle" || hintLevel >= 2}
                style={{
                  flex: 1, padding: "7px 0", borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg-elevated)",
                  color: hintLevel >= 2 || solveState !== "idle" ? "var(--text-muted)" : "#5b8ef5",
                  fontSize: 12, fontWeight: 600,
                  cursor: hintLevel >= 2 || solveState !== "idle" ? "default" : "pointer",
                  transition: "all 0.15s",
                }}
              >
                {hintLevel === 0 ? "💡 Hint" : hintLevel === 1 ? "💡 More" : "✓ Hinted"}
              </button>
              <button
                onClick={showSolution}
                disabled={showExpl}
                style={{
                  flex: 1, padding: "7px 0", borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg-elevated)",
                  color: showExpl ? "var(--text-muted)" : "var(--text-secondary)",
                  fontSize: 12, fontWeight: 600,
                  cursor: showExpl ? "default" : "pointer",
                  opacity: showExpl ? 0.5 : 1,
                  transition: "all 0.15s",
                }}
              >
                Show Solution
              </button>
            </div>

            {showExpl && (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={retry}
                  style={{
                    flex: drillInfo ? "0 0 auto" : 1, padding: "7px 14px", borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg-elevated)",
                    color: "var(--text-secondary)",
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  ↺ Try Again
                </button>
                {drillInfo && (
                  <button
                    onClick={drillInfo.onNext}
                    style={{
                      flex: 1, padding: "7px 0", borderRadius: 8,
                      border: "1px solid var(--gold-border)",
                      background: "var(--gold-subtle)",
                      color: "var(--gold)",
                      fontSize: 12, fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    {drillInfo.index + 1 >= drillInfo.total ? "Finish drill →" : "Next puzzle →"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Explanation column */}
          <div
            style={{
              flex: 1, overflowY: "auto", padding: 20,
              display: "flex", flexDirection: "column", gap: 14,
              scrollbarWidth: "thin",
            }}
          >
            {/* Auto-playing opponent's reply between stages */}
            {awaitingReply && (
              <div
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "center", flex: 1, gap: 14, textAlign: "center",
                  padding: "24px 0",
                }}
              >
                <div style={{ fontSize: 32, animation: "pulseGlow 1s ease-in-out infinite" }}>♞</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>
                  Playing the opponent&apos;s reply…
                </div>
              </div>
            )}

            {/* Idle */}
            {solveState === "idle" && !awaitingReply && (
              <div
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "center", flex: 1, gap: 16, textAlign: "center",
                  padding: "24px 0",
                }}
              >
                <div style={{ fontSize: 38 }}>{puzzleStage === 1 ? "⚔" : "♟"}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                  {puzzleStage === 1 ? "Now find your follow-up" : "Find the best move"}
                </div>
                {puzzleStage === 1 ? (
                  <div
                    style={{
                      fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.65,
                      maxWidth: 260,
                    }}
                  >
                    The opponent replied. What&apos;s the strongest continuation now that
                    presses the advantage?
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.65,
                        maxWidth: 260,
                      }}
                    >
                      {position.san ? (
                        <>
                          Drag a piece on the board to try. You played{" "}
                          <strong style={{ color: cfgColor, fontFamily: "var(--font-mono)" }}>
                            {position.san}
                          </strong>{" "}
                          here. Can you find what the engine recommends instead?
                        </>
                      ) : (
                        "Drag a piece on the board to try. Can you find the strongest move in this position?"
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11, color: "var(--text-muted)",
                        background: "var(--bg-elevated)", border: "1px solid var(--border)",
                        borderRadius: 8, padding: "5px 12px",
                      }}
                    >
                      {position.phase} · −{position.cp_loss} cp
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Wrong */}
            {solveState === "wrong" && (
              <div
                style={{
                  background: "rgba(239,68,68,0.06)",
                  border: "1px solid rgba(239,68,68,0.22)",
                  borderRadius: 12, padding: "14px 16px",
                }}
              >
                <div
                  style={{
                    fontSize: 11, fontWeight: 800, textTransform: "uppercase",
                    letterSpacing: "0.08em", color: "var(--clr-blunder)", marginBottom: 8,
                  }}
                >
                  Not quite
                </div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, margin: 0 }}>
                  That&apos;s not the best move here. Try again — use hints if you&apos;re stuck.
                </p>
              </div>
            )}

            {/* Correct banner */}
            {solveState === "correct" && (
              <div
                style={{
                  background: "rgba(74,222,128,0.06)",
                  border: "1px solid rgba(74,222,128,0.25)",
                  borderRadius: 10, padding: "10px 14px",
                  display: "flex", flexDirection: "column", gap: 6,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "var(--accent-green)", fontSize: 18 }}>✓</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent-green)" }}>
                    Correct! You found the best move.
                  </span>
                </div>
                {followUpNote && (
                  <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6, margin: "0 0 0 28px" }}>
                    {followUpNote}
                  </p>
                )}
              </div>
            )}

            {/* Ask before telling — capture the player's own guess first */}
            {showExpl && !reasoningRevealed && (
              <div
                style={{
                  background: "var(--bg-surface)", border: "1px solid var(--border)",
                  borderRadius: 12, padding: "14px 16px",
                  display: "flex", flexDirection: "column", gap: 10,
                }}
              >
                <div
                  style={{
                    fontSize: 11, fontWeight: 800, textTransform: "uppercase",
                    letterSpacing: "0.08em", color: "var(--text-muted)",
                  }}
                >
                  Before the explanation…
                </div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                  Why do you think{" "}
                  <strong style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                    {position.best}
                  </strong>{" "}
                  works here? A quick guess, even a wrong one, helps it stick. Optional.
                </p>
                <textarea
                  value={reasoningDraft}
                  onChange={e => setReasoningDraft(e.target.value)}
                  placeholder="e.g. it wins the pawn on e5 because the knight is pinned…"
                  rows={3}
                  style={{
                    resize: "vertical", fontSize: 13, padding: "8px 10px",
                    borderRadius: 8, border: "1px solid var(--border)",
                    background: "var(--bg-elevated)", color: "var(--text-primary)",
                    fontFamily: "inherit",
                  }}
                />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => { setReasoningDraft(""); setReasoningRevealed(true); }}
                    style={{
                      background: "transparent", border: "1px solid var(--border)",
                      color: "var(--text-muted)", borderRadius: 8, padding: "6px 14px",
                      fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => setReasoningRevealed(true)}
                    style={{
                      background: "var(--accent-blue)", border: "1px solid var(--accent-blue)",
                      color: "#fff", borderRadius: 8, padding: "6px 14px",
                      fontSize: 12, fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    Reveal explanation
                  </button>
                </div>
              </div>
            )}

            {/* Explanation */}
            {showExpl && reasoningRevealed && (
              <>
                {loadingExpl ? (
                  <div
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "24px 0", color: "var(--text-muted)", fontSize: 13,
                    }}
                  >
                    <div
                      style={{
                        width: 16, height: 16,
                        border: "2px solid var(--border)", borderTopColor: "var(--accent-blue)",
                        borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0,
                      }}
                    />
                    Generating position analysis…
                  </div>
                ) : explanation ? (
                  <>
                    {/* Why played move is bad */}
                    <div
                      style={{
                        background: "rgba(239,68,68,0.05)",
                        border: "1px solid rgba(239,68,68,0.18)",
                        borderRadius: 12, padding: "14px 16px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11, fontWeight: 800, textTransform: "uppercase",
                          letterSpacing: "0.1em", color: "var(--clr-blunder)", marginBottom: 8,
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        WHY {position.san} IS BAD
                      </div>
                      <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.75, margin: 0 }}>
                        {explanation.why_bad}
                      </p>
                    </div>

                    {/* Why engine move is best */}
                    <div
                      style={{
                        background: "rgba(74,222,128,0.04)",
                        border: "1px solid rgba(74,222,128,0.18)",
                        borderRadius: 12, padding: "14px 16px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11, fontWeight: 800, textTransform: "uppercase",
                          letterSpacing: "0.1em", color: "var(--accent-green)", marginBottom: 8,
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        WHY {position.best} IS BEST
                      </div>
                      <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.75, margin: 0 }}>
                        {explanation.why_good}
                      </p>
                    </div>

                    {/* Feedback on the player's own pre-reveal guess */}
                    {explanation.reasoning_feedback && (
                      <div
                        style={{
                          background: "var(--gold-subtle)",
                          border: "1px solid var(--gold-border)",
                          borderRadius: 12, padding: "14px 16px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11, fontWeight: 800, textTransform: "uppercase",
                            letterSpacing: "0.1em", color: "var(--gold)", marginBottom: 8,
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          ON YOUR GUESS
                        </div>
                        <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.75, margin: 0 }}>
                          {explanation.reasoning_feedback}
                        </p>
                      </div>
                    )}

                    {/* Theme + ELO note */}
                    {(explanation.theme || explanation.elo_note) && (
                      <div
                        style={{
                          background: "rgba(91,142,245,0.05)",
                          border: "1px solid rgba(91,142,245,0.18)",
                          borderRadius: 12, padding: "12px 16px",
                          display: "flex", flexDirection: "column", gap: 8,
                        }}
                      >
                        {explanation.theme && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span
                              style={{
                                fontSize: 11, fontWeight: 800, textTransform: "uppercase",
                                letterSpacing: "0.08em", color: "#5b8ef5",
                              }}
                            >
                              Theme
                            </span>
                            <span
                              title={THEME_GLOSSARY[explanation.theme] ?? undefined}
                              style={{
                                fontSize: 12, color: "#5b8ef5",
                                background: "rgba(91,142,245,0.12)",
                                padding: "2px 8px", borderRadius: 4, fontWeight: 600,
                                cursor: THEME_GLOSSARY[explanation.theme] ? "help" : "default",
                                borderBottom: THEME_GLOSSARY[explanation.theme] ? "1px dotted #5b8ef5" : "none",
                              }}
                            >
                              {explanation.theme}
                            </span>
                          </div>
                        )}
                        {explanation.elo_note && (
                          <p
                            style={{
                              fontSize: 12, color: "var(--text-muted)",
                              lineHeight: 1.6, margin: 0, fontStyle: "italic",
                            }}
                          >
                            💡 {explanation.elo_note}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Conversational follow-up — "why", "what if I played X" (ANALYSIS_STRATEGY.md phase 3) */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {chatHistory.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {chatHistory.map((m, i) => (
                            <div
                              key={i}
                              style={{
                                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                                maxWidth: "88%",
                                background: m.role === "user" ? "var(--gold-subtle)" : "var(--bg-elevated)",
                                border: `1px solid ${m.role === "user" ? "var(--gold-border)" : "var(--border)"}`,
                                borderRadius: 10,
                                padding: "8px 12px",
                                fontSize: 12.5,
                                color: "var(--text-secondary)",
                                lineHeight: 1.6,
                              }}
                            >
                              {m.content}
                            </div>
                          ))}
                          {chatLoading && (
                            <div style={{ alignSelf: "flex-start", fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
                              Thinking…
                            </div>
                          )}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          value={chatInput}
                          onChange={e => setChatInput(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") handleSendChat(); }}
                          placeholder="Ask a follow-up — e.g. what if I played Nf3 instead?"
                          disabled={chatLoading}
                          style={{
                            flex: 1, background: "var(--bg-elevated)", border: "1px solid var(--border-strong)",
                            color: "var(--text-primary)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5,
                          }}
                        />
                        <button
                          onClick={handleSendChat}
                          disabled={chatLoading || !chatInput.trim()}
                          style={{
                            padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                            background: "var(--gold-subtle)", border: "1px solid var(--gold-border)",
                            color: "var(--gold)", opacity: (chatLoading || !chatInput.trim()) ? 0.5 : 1,
                            cursor: (chatLoading || !chatInput.trim()) ? "default" : "pointer",
                          }}
                        >
                          Ask
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── StudyPanel ────────────────────────────────────────────────────────────────

export function StudyPanel({
  aiReport,
  movesData,
  positions,
  playerColor,
  analyzing,
  explainPositionFn,
  metadata,
}: {
  aiReport: string | null;
  movesData: MoveData[];
  positions: string[];
  playerColor: "white" | "black";
  analyzing: boolean;
  explainPositionFn: typeof ExplainFn;
  metadata?: Record<string, string>;
}) {
  const [activePosition, setActivePosition] = useState<StudyPosition | null>(null);

  // In-tab drill mode (enhancement #6): solve the cross-game spaced-repetition
  // queue back-to-back without leaving Study for /puzzles. Reuses the same
  // StudyPuzzleModal as single-position practice, just chained across puzzles.
  const { status: drillSessionStatus } = useSession();
  const [drillQueue, setDrillQueue] = useState<PuzzleData[] | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillIndex, setDrillIndex] = useState(0);
  const [drillStreak, setDrillStreak] = useState(0);
  const [drillActive, setDrillActive] = useState(false);
  const drillSolvedRef = useRef<Set<number>>(new Set());

  const refreshDrillQueue = useCallback(() => {
    if (drillSessionStatus !== "authenticated") return;
    setDrillLoading(true);
    getPuzzleQueue(20)
      .then(r => setDrillQueue(r.puzzles))
      .catch(() => setDrillQueue([]))
      .finally(() => setDrillLoading(false));
  }, [drillSessionStatus]);

  useEffect(() => {
    if (drillSessionStatus === "authenticated" && drillQueue === null) refreshDrillQueue();
  }, [drillSessionStatus, drillQueue, refreshDrillQueue]);

  function drillPositionFor(q: PuzzleData): StudyPosition {
    const sideToMove = q.fen.split(" ")[1] === "b" ? "Black" : "White";
    const classification = q.cp_loss >= 200 ? "Blunder" : q.cp_loss >= 90 ? "Mistake" : "Inaccuracy";
    return {
      move_num: 0,
      san: "",
      best: q.best_move_san,
      classification,
      cp_loss: q.cp_loss,
      phase: q.phase || "Middlegame",
      color: sideToMove,
      fen_before: q.fen,
      continuation: q.continuation,
    };
  }

  function startDrill() {
    drillSolvedRef.current = new Set();
    setDrillIndex(0);
    setDrillStreak(0);
    setDrillActive(true);
  }

  function advanceDrill() {
    if (!drillQueue) return;
    if (drillIndex + 1 >= drillQueue.length) {
      setDrillActive(false);
      refreshDrillQueue();
    } else {
      setDrillIndex(i => i + 1);
    }
  }

  const report = useMemo((): GameReport | null => {
    if (!aiReport) return null;
    try { return JSON.parse(aiReport) as GameReport; } catch { return null; }
  }, [aiReport]);

  // Move-quality donut (ported from the old separate AI Report modal —
  // Study is now the single destination, see product decision Aug 2026).
  const donutSlices: DonutSlice[] = useMemo(() => {
    const qCounts = countQuality(movesData, playerColor === "white" ? "White" : "Black");
    return [
      { label: "Brilliant",  value: qCounts.brilliant,  color: "var(--clr-brilliant)",  badge: "!!" },
      { label: "Best",       value: qCounts.best,       color: "var(--clr-best)",       badge: "✓"  },
      { label: "Excellent",  value: qCounts.excellent,  color: "var(--clr-excellent)",  badge: "!"  },
      { label: "Good",       value: qCounts.good,       color: "var(--clr-good)",       badge: ""   },
      { label: "Inaccuracy", value: qCounts.inaccuracy, color: "var(--clr-inaccuracy)", badge: "?!" },
      { label: "Mistake",    value: qCounts.mistake,    color: "var(--clr-mistake)",    badge: "?"  },
      { label: "Blunder",    value: qCounts.blunder,    color: "var(--clr-blunder)",    badge: "??" },
    ].filter(s => s.value > 0);
  }, [movesData, playerColor]);

  // Map key_moments by "move_numSide" for O(1) lookup — avoids collision when
  // both White and Black have a key moment on the same full move number.
  const kmByMoveNum = useMemo(() => {
    const map = new Map<string, KeyMoment>();
    (report?.key_moments ?? []).forEach(km => map.set(`${km.move_num}${km.side}`, km));
    return map;
  }, [report]);

  // Build study positions from all blunders / mistakes in movesData
  const studyPositions = useMemo((): StudyPosition[] => {
    return movesData
      .filter(m => {
        const c = (m.classification ?? "").toLowerCase();
        const isError = c.includes("blunder") || c.includes("mistake");
        const isPlayerMove = m.color.toLowerCase() === playerColor;
        return isError && isPlayerMove;
      })
      .map(m => {
        const km = kmByMoveNum.get(`${m.move_number}${m.color}`);
        // positions[] is indexed by half-move (positions[0]=start, positions[1]=after 1st half-move).
        // m.move_number is the FULL chess move number, so we must convert:
        //   White's move N → half-move index (N-1)*2
        //   Black's move N → half-move index (N-1)*2 + 1
        const halfMoveIdx = m.color === "White"
          ? (m.move_number - 1) * 2
          : (m.move_number - 1) * 2 + 1;
        const fenBefore = positions[halfMoveIdx] ?? "";
        const bestTopMove = m.top_moves?.find(tm => tm.uci === m.best_move_uci) ?? m.top_moves?.[0];
        return {
          move_num: m.move_number,
          san: m.san,
          best: m.best_move_san ?? "",
          classification: m.classification ?? "",
          cp_loss: m.cp_loss,
          phase: m.phase ?? "Middlegame",
          color: m.color,
          fen_before: fenBefore,
          label: km?.label,
          what_happened: km?.what_happened,
          best_explanation: km?.best_explanation,
          principle: km?.principle,
          clock_remaining: m.clock_remaining,
          continuation: bestTopMove?.continuation ?? [],
        };
      })
      .filter(p => p.fen_before && p.best)
      .sort((a, b) => b.cp_loss - a.cp_loss);
  }, [movesData, positions, kmByMoveNum]);

  // ── Empty / loading states ──

  if (!movesData.length && !analyzing) {
    return (
      <div
        style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", height: "100%", gap: 12,
          color: "var(--text-muted)", padding: 24,
        }}
      >
        <div style={{ fontSize: 30 }}>◎</div>
        <div style={{ fontSize: 13, textAlign: "center", lineHeight: 1.6 }}>
          Import a game and run analysis to see the study report.
        </div>
      </div>
    );
  }

  if (analyzing && !report && !movesData.length) {
    return (
      <div
        style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", height: "100%", gap: 14,
        }}
      >
        <div
          style={{
            width: 24, height: 24,
            border: "2px solid var(--border)", borderTopColor: "var(--gold)",
            borderRadius: "50%", animation: "spin 0.8s linear infinite",
          }}
        />
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {movesData.length > 0 ? "AI writing coaching report…" : "Stockfish analysing game…"}
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          flex: 1, overflowY: "auto", padding: "14px 12px",
          display: "flex", flexDirection: "column", gap: 14,
          scrollbarWidth: "thin",
        }}
      >
        {/* ── Verdict ── */}
        {report && (
          <div
            style={{
              background: "var(--bg-elevated)", border: "1px solid var(--border)",
              borderRadius: 12, padding: "14px 16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ color: "var(--gold)", fontSize: 12 }}>✦</span>
              <span
                style={{
                  fontSize: 11, fontWeight: 800, textTransform: "uppercase",
                  letterSpacing: "0.1em", color: "var(--gold)",
                }}
              >
                Game Verdict
              </span>
              <span
                style={{
                  marginLeft: "auto", fontSize: 10, fontWeight: 700,
                  padding: "2px 8px", borderRadius: 4,
                  background: "rgba(91,142,245,0.1)", color: "#5b8ef5",
                  border: "1px solid rgba(91,142,245,0.25)",
                }}
              >
                {report.game_type}
              </span>
              {metadata && (
                <button
                  onClick={() => printReport(report as unknown as ReportData, metadata)}
                  title="Export as PDF"
                  style={{
                    fontSize: 10, color: "var(--text-secondary)", background: "var(--bg-surface)",
                    border: "1px solid var(--border-strong)", borderRadius: 6, padding: "3px 8px",
                    cursor: "pointer",
                  }}
                >
                  {"↓ PDF"}
                </button>
              )}
            </div>
            <p
              style={{
                fontSize: 13, color: "var(--text-secondary)",
                lineHeight: 1.6, margin: 0, fontStyle: "italic",
              }}
            >
              &ldquo;{report.verdict}&rdquo;
            </p>
          </div>
        )}

        {/* ── Drill mode launcher (enhancement #6) ── */}
        {drillSessionStatus === "authenticated" && (drillLoading || (drillQueue && drillQueue.length > 0)) && (
          <div
            style={{
              background: "var(--gold-subtle)", border: "1px solid var(--gold-border)",
              borderRadius: 12, padding: "12px 16px",
              display: "flex", alignItems: "center", gap: 12,
            }}
          >
            <span style={{ fontSize: 20 }}>🔥</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--gold)" }}>
                {drillLoading ? "Checking your practice queue…" : `${drillQueue!.length} puzzle${drillQueue!.length === 1 ? "" : "s"} due for review`}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                From your own analyzed games, prioritized by your weakest patterns.
              </div>
            </div>
            {!drillLoading && drillQueue && drillQueue.length > 0 && (
              <button
                onClick={startDrill}
                style={{
                  background: "var(--gold)", border: "none", color: "var(--bg-base)",
                  borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 800,
                  cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                Start Drill →
              </button>
            )}
          </div>
        )}

        {/* ── Move quality + phase grades (ported from the old separate AI Report) ── */}
        {report?.phase_grades && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "stretch" }}>
            {donutSlices.length > 0 && (
              <div style={{
                background: "var(--bg-surface)", border: "1px solid var(--border)",
                borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center",
                flex: "0 0 auto",
              }}>
                <DonutChart slices={donutSlices} />
              </div>
            )}
            <div style={{
              background: "var(--bg-surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: "10px 8px", display: "flex", flex: "1 1 220px", justifyContent: "space-around",
            }}>
              {(["opening", "middlegame", "endgame"] as const).map(ph => (
                <PhaseArc key={ph} label={ph} grade={report.phase_grades[ph].grade} note={report.phase_grades[ph].note} />
              ))}
            </div>
          </div>
        )}

        {/* ── Opening insight ── */}
        {report?.opening && (
          <div
            style={{
              background: "var(--bg-surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: "14px 16px",
            }}
          >
            <div
              style={{
                fontSize: 11, fontWeight: 800, textTransform: "uppercase",
                letterSpacing: "0.1em", color: "#5b8ef5", marginBottom: 8,
              }}
            >
              Opening — {report.opening.eco} {report.opening.name}
            </div>
            <p
              style={{
                fontSize: 13, color: "var(--text-secondary)",
                lineHeight: 1.7, margin: 0,
              }}
            >
              {report.opening.assessment}
            </p>
            {report.opening.deviation && (
              <div
                style={{
                  marginTop: 10, display: "flex", alignItems: "flex-start", gap: 8,
                  paddingTop: 10, borderTop: "1px solid var(--border)",
                }}
              >
                <span
                  style={{
                    fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                    background: "rgba(247,144,9,0.1)", color: "#f79009",
                    border: "1px solid rgba(247,144,9,0.25)", flexShrink: 0, whiteSpace: "nowrap",
                  }}
                >
                  Move {report.opening.deviation.move_num}: {report.opening.deviation.san}
                </span>
                <span
                  style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}
                >
                  {report.opening.deviation.note}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Tactical patterns ── */}
        {report?.tactical_patterns && report.tactical_patterns.length > 0 && (
          <div
            style={{
              background: "var(--bg-surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: "14px 16px",
            }}
          >
            <div
              style={{
                fontSize: 11, fontWeight: 800, textTransform: "uppercase",
                letterSpacing: "0.1em", color: "#a78bfa", marginBottom: 10,
              }}
            >
              Tactical Patterns in This Game
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {report.tactical_patterns.map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ color: "#a78bfa", fontSize: 11, marginTop: 2, flexShrink: 0 }}>▸</span>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    <strong style={{ color: "var(--text-primary)", fontWeight: 700 }}>{p.name}: </strong>
                    {p.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Strengths & Weaknesses ── */}
        {report && (report.strengths.length > 0 || report.weaknesses.length > 0) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {report.strengths.slice(0, 2).map((s, i) => (
              <div
                key={`s${i}`}
                style={{
                  background: "rgba(74,222,128,0.04)",
                  border: "1px solid rgba(74,222,128,0.15)",
                  borderRadius: 10, padding: "10px 12px",
                }}
              >
                <div
                  style={{
                    fontSize: 10, fontWeight: 800, color: "var(--accent-green)",
                    textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5,
                  }}
                >
                  ✓ {s.title}
                </div>
                <p
                  style={{
                    fontSize: 11, color: "var(--text-secondary)",
                    lineHeight: 1.55, margin: 0,
                  }}
                >
                  {s.detail}
                </p>
              </div>
            ))}
            {report.weaknesses.slice(0, 2).map((w, i) => (
              <div
                key={`w${i}`}
                style={{
                  background: "rgba(239,68,68,0.04)",
                  border: "1px solid rgba(239,68,68,0.15)",
                  borderRadius: 10, padding: "10px 12px",
                }}
              >
                <div
                  style={{
                    fontSize: 10, fontWeight: 800, color: "var(--clr-blunder)",
                    textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5,
                  }}
                >
                  ✗ {w.title}
                </div>
                <p
                  style={{
                    fontSize: 11, color: "var(--text-secondary)",
                    lineHeight: 1.55, margin: 0,
                  }}
                >
                  {w.detail}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ── Key Positions to Study ── */}
        <div>
          <div
            style={{
              fontSize: 11, fontWeight: 800, textTransform: "uppercase",
              letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 8,
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            Key Positions to Study
            {studyPositions.length > 0 && (
              <span
                style={{
                  fontSize: 10, fontWeight: 600, color: "var(--text-muted)",
                  background: "var(--bg-elevated)", border: "1px solid var(--border)",
                  padding: "1px 6px", borderRadius: 4,
                }}
              >
                {studyPositions.length}
              </span>
            )}
          </div>

          {analyzing && studyPositions.length === 0 && (
            <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "8px 0" }}>
              Waiting for engine analysis…
            </div>
          )}

          {!analyzing && studyPositions.length === 0 && movesData.length > 0 && (
            <div
              style={{
                color: "var(--accent-green)", fontSize: 13,
                padding: "14px 0", textAlign: "center",
              }}
            >
              ✓ No significant errors — clean game!
            </div>
          )}

          {studyPositions.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {studyPositions.map((pos, i) => {
                const c = CLF_CONFIG[pos.classification as keyof typeof CLF_CONFIG];
                const isKey = kmByMoveNum.has(`${pos.move_num}${pos.color}`);
                return (
                  <div
                    key={i}
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                      borderLeft: `3px solid ${c?.color ?? "var(--clr-blunder)"}`,
                      borderRadius: 10, padding: "10px 14px",
                      display: "flex", alignItems: "center", gap: 10,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex", alignItems: "center",
                          gap: 5, marginBottom: 3, flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            color: c?.color ?? "var(--clr-blunder)",
                            fontSize: 11, fontWeight: 800,
                          }}
                        >
                          {c?.badge} {pos.classification}
                        </span>
                        <span style={{ color: "var(--border)", fontSize: 10 }}>·</span>
                        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                          Move {pos.move_num}
                        </span>
                        <span style={{ color: "var(--border)", fontSize: 10 }}>·</span>
                        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                          {pos.phase}
                        </span>
                        {isKey && (
                          <span
                            style={{
                              fontSize: 9, fontWeight: 700, padding: "1px 5px",
                              borderRadius: 3,
                              background: "rgba(201,162,68,0.12)",
                              color: "var(--gold)",
                              border: "1px solid rgba(201,162,68,0.28)",
                            }}
                          >
                            ★ KEY
                          </span>
                        )}
                      </div>
                      {pos.label ? (
                        <div
                          style={{
                            fontSize: 12, color: "var(--text-primary)",
                            fontStyle: "italic",
                            overflow: "hidden", textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          &ldquo;{pos.label}&rdquo;
                        </div>
                      ) : (
                        <div
                          style={{
                            fontSize: 12, fontFamily: "var(--font-mono)",
                            color: "var(--text-secondary)",
                          }}
                        >
                          <span style={{ color: c?.color ?? "var(--clr-blunder)" }}>{pos.san}</span>
                          <span style={{ color: "var(--text-muted)", margin: "0 4px" }}>→</span>
                          <span style={{ color: "var(--clr-best)" }}>{pos.best}</span>
                          <span
                            style={{
                              color: c?.color ?? "var(--clr-blunder)",
                              fontSize: 10, marginLeft: 8,
                            }}
                          >
                            −{pos.cp_loss} cp
                          </span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setActivePosition(pos)}
                      style={{
                        padding: "6px 12px", borderRadius: 7, flexShrink: 0,
                        background: "rgba(91,142,245,0.1)",
                        border: "1px solid rgba(91,142,245,0.25)",
                        color: "#5b8ef5", fontSize: 11, fontWeight: 700,
                        cursor: "pointer", whiteSpace: "nowrap",
                        transition: "all 0.15s",
                      }}
                    >
                      Study ▶
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Coach note ── */}
        {report?.coach_note && (
          <div
            style={{
              background: "rgba(201,162,68,0.05)",
              border: "1px solid rgba(201,162,68,0.2)",
              borderRadius: 12, padding: "14px 16px",
            }}
          >
            <div
              style={{
                fontSize: 11, fontWeight: 800, textTransform: "uppercase",
                letterSpacing: "0.1em", color: "var(--gold)", marginBottom: 8,
              }}
            >
              ✦ Coach&apos;s Note
            </div>
            <p
              style={{
                fontSize: 13, color: "var(--text-secondary)",
                lineHeight: 1.7, margin: 0,
              }}
            >
              {report.coach_note}
            </p>
          </div>
        )}

        {/* ── Study plan ── */}
        {report?.study_plan?.items && report.study_plan.items.length > 0 && (
          <div
            style={{
              background: "var(--bg-surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: "14px 16px",
            }}
          >
            <div
              style={{
                fontSize: 11, fontWeight: 800, textTransform: "uppercase",
                letterSpacing: "0.1em", color: "var(--accent-amber)", marginBottom: 10,
              }}
            >
              What to Study Next
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {report.study_plan.items.slice(0, 3).map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ color: "var(--accent-amber)", fontSize: 11, marginTop: 2, flexShrink: 0 }}>▸</span>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
                    {item.type === "book" && (
                      <>
                        <strong style={{ color: "var(--text-primary)" }}>{item.title}</strong>
                        {item.author ? ` — ${item.author}` : ""}
                        {item.chapter ? ` (${item.chapter})` : ""}
                        {item.why ? `: ${item.why}` : ""}
                      </>
                    )}
                    {item.type === "puzzles" && (
                      <>
                        <strong style={{ color: "var(--text-primary)" }}>{item.theme}</strong>
                        {item.platform ? ` on ${item.platform}` : ""}
                        {item.why ? `: ${item.why}` : ""}
                      </>
                    )}
                    {item.type === "practice" && (
                      <>
                        <strong style={{ color: "var(--text-primary)" }}>Practice: </strong>
                        {item.description}
                        {item.why ? ` — ${item.why}` : ""}
                      </>
                    )}
                  </div>
                </div>
              ))}
              {report.study_plan.daily_routine && (
                <div
                  style={{
                    fontSize: 11, color: "var(--text-muted)", marginTop: 6,
                    paddingTop: 8, borderTop: "1px solid var(--border)",
                    fontStyle: "italic",
                  }}
                >
                  {report.study_plan.daily_routine}
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Puzzle modal */}
      {activePosition && (
        <StudyPuzzleModal
          position={activePosition}
          playerColor={playerColor}
          onClose={() => setActivePosition(null)}
          explainPositionFn={explainPositionFn}
        />
      )}

      {/* Drill mode modal */}
      {drillActive && drillQueue && drillQueue[drillIndex] && (
        <StudyPuzzleModal
          key={drillIndex}
          position={drillPositionFor(drillQueue[drillIndex])}
          playerColor={drillQueue[drillIndex].fen.split(" ")[1] === "b" ? "black" : "white"}
          onClose={() => setDrillActive(false)}
          explainPositionFn={explainPositionFn}
          onSolved={(correct) => {
            if (drillSolvedRef.current.has(drillIndex)) return;
            drillSolvedRef.current.add(drillIndex);
            setDrillStreak(s => (correct ? s + 1 : 0));
          }}
          drillInfo={{ index: drillIndex, total: drillQueue.length, streak: drillStreak, onNext: advanceDrill }}
        />
      )}
    </>
  );
}

"use client";
import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Chess } from "chess.js";
import type { PieceDropHandlerArgs } from "react-chessboard";
import { useGameStore } from "@/lib/store";
import { replayMove } from "@/lib/api";
import { computeOpponentFingerprint, estimatePhase } from "@/lib/chess-utils";
import { playSound, sanToSound } from "@/lib/sounds";

const Chessboard = dynamic(
  () => import("react-chessboard").then(m => m.Chessboard),
  { ssr: false, loading: () => <div style={{ aspectRatio: "1/1", background: "var(--bg-elevated)", borderRadius: 12 }} className="animate-pulse" /> }
);

type ReplayStatus = "your-move" | "thinking" | "checkmate" | "stalemate" | "draw" | "error";

export function ReplayModal({ startPly, onClose }: { startPly: number; onClose: () => void }) {
  const positions    = useGameStore(s => s.positions);
  const movesData    = useGameStore(s => s.movesData);
  const playerColor  = useGameStore(s => s.playerColor);
  const metadata     = useGameStore(s => s.metadata);
  const soundEnabled = useGameStore(s => s.soundEnabled);

  const startFen = positions[startPly] ?? "";
  const userColorWord: "White" | "Black"     = playerColor === "white" ? "White" : "Black";
  const opponentColorWord: "White" | "Black" = userColorWord === "White" ? "Black" : "White";
  const opponentName = (opponentColorWord === "White" ? metadata.White : metadata.Black) || opponentColorWord;
  const opponentRatingRaw = opponentColorWord === "White" ? metadata.WhiteElo : metadata.BlackElo;
  const opponentRating = opponentRatingRaw ? parseInt(opponentRatingRaw, 10) : null;

  const fingerprint = useMemo(
    () => computeOpponentFingerprint(movesData, opponentColorWord),
    [movesData, opponentColorWord]
  );
  const hasFingerprint = Object.values(fingerprint).some(rate => rate > 0);

  const chessRef = useRef<Chess | null>(null);
  const [fen,         setFen]         = useState(startFen);
  const [status,      setStatus]      = useState<ReplayStatus>("your-move");
  const [error,       setError]       = useState("");
  const [sanHistory,  setSanHistory]  = useState<string[]>([]);
  const [lastSource,  setLastSource]  = useState<"maia" | "fingerprint_deviation" | null>(null);
  const [lastBand,    setLastBand]    = useState<number | null>(null);
  const [evalCp,      setEvalCp]      = useState<number | null>(null);

  const reset = useCallback(() => {
    try { chessRef.current = new Chess(startFen); } catch { chessRef.current = new Chess(); }
    setFen(startFen);
    setStatus("your-move");
    setSanHistory([]);
    setError("");
    setLastSource(null);
    setLastBand(null);
    setEvalCp(null);
  }, [startFen]);

  useEffect(() => { reset(); }, [reset]);

  // Lock page scroll while the modal is open — the board sits in a portal
  // at document.body, so nothing else pins the page in place.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const requestOpponentReply = useCallback((afterFen: string) => {
    setStatus("thinking");
    replayMove({
      fen:              afterFen,
      opponentRating,
      errorRateByPhase: hasFingerprint ? fingerprint : null,
      phase:            estimatePhase(afterFen),
    }).then(res => {
      try {
        if (!chessRef.current) throw new Error("no board");
        const applied = chessRef.current.move(res.move_san);
        if (!applied) throw new Error("illegal reply");
      } catch {
        // Trust the server's resulting FEN even if local SAN replay
        // somehow disagreed with it (promotion notation edge cases etc.)
        chessRef.current = new Chess(res.fen);
      }
      setFen(res.fen);
      setSanHistory(h => [...h, res.move_san]);
      setLastSource(res.source);
      setLastBand(res.maia_band);
      setEvalCp(res.eval_cp);
      if (soundEnabled) playSound(sanToSound(res.move_san));
      if (res.is_checkmate)      setStatus("checkmate");
      else if (res.is_stalemate) setStatus("stalemate");
      else if (res.is_game_over) setStatus("draw");
      else                       setStatus("your-move");
    }).catch(e => {
      setError((e as Error).message || "The opponent engine is unavailable right now.");
      setStatus("error");
    });
  }, [opponentRating, fingerprint, hasFingerprint, soundEnabled]);

  const onPieceDrop = useCallback(({ sourceSquare: from, targetSquare: to }: PieceDropHandlerArgs) => {
    if (!chessRef.current || !to || status !== "your-move") return false;
    try {
      const move = chessRef.current.move({ from, to, promotion: "q" });
      if (!move) return false;
      const newFen = chessRef.current.fen();
      setFen(newFen);
      setSanHistory(h => [...h, move.san]);
      if (soundEnabled) playSound(sanToSound(move.san));
      if (chessRef.current.isGameOver()) {
        if (chessRef.current.isCheckmate())      setStatus("checkmate");
        else if (chessRef.current.isStalemate()) setStatus("stalemate");
        else                                     setStatus("draw");
      } else {
        requestOpponentReply(newFen);
      }
      return true;
    } catch { return false; }
  }, [status, soundEnabled, requestOpponentReply]);

  if (!startFen) return null;

  // Whoever is to move in the final FEN is the side with no legal moves —
  // the mated side in a checkmate.
  const matedColor: "White" | "Black" = fen.split(" ")[1] === "w" ? "White" : "Black";
  const checkmateText = matedColor === userColorWord
    ? `Checkmate — ${opponentName} got you.`
    : `Checkmate — you won this line!`;

  const statusText: Record<ReplayStatus, string> = {
    "your-move":  `Your move (playing ${userColorWord})`,
    "thinking":   `${opponentName} is thinking…`,
    "checkmate":  checkmateText,
    "stalemate":  "Stalemate — drawn.",
    "draw":       "Drawn position.",
    "error":      error,
  };

  // How this replay line compares to what actually happened in the game at
  // the same point — the number of half-moves played here plus where the
  // replay started lines up with the equivalent entry in the real game's
  // move-by-move eval history, already sitting in the store.
  const totalPly = startPly + sanHistory.length;
  const actualEvalCp = totalPly > 0 ? movesData[totalPly - 1]?.score_after ?? null : null;
  const userIsWhite = userColorWord === "White";
  const toUserAdvantage = (cp: number | null) => cp == null ? null : (userIsWhite ? cp : -cp);
  const replayAdvantage = toUserAdvantage(evalCp);
  const actualAdvantage = toUserAdvantage(actualEvalCp ?? null);
  const evalDelta = replayAdvantage != null && actualAdvantage != null ? replayAdvantage - actualAdvantage : null;
  const EVAL_NOISE_FLOOR = 40; // cp — below this, don't claim a meaningful difference
  const showEvalCompare = evalDelta != null && status !== "thinking";

  // Rendered via a portal straight to document.body: this modal was
  // previously mounted inline inside the analyze page's board column, and
  // `position: fixed` only escapes the viewport when NO ancestor sets
  // transform/filter/will-change/contain -- one somewhere in that column
  // did, which pinned the "fixed" overlay to a small ancestor box instead
  // of the real viewport, letting the page's own tab bar and eval sparklines
  // show through around/behind it. A portal makes the modal immune to that
  // category of bug regardless of which ancestor is the culprit.
  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9990,
        background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="card"
        style={{
          width: "min(880px, 100%)", maxHeight: "92vh", overflowY: "auto",
          boxShadow: "0 40px 100px rgba(0,0,0,0.65)",
          padding: 22, display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--gold)", marginBottom: 4 }}>
              🧪 What if?
            </div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
              Replaying from move {Math.floor(startPly / 2) + 1}
            </h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, maxWidth: 480 }}>
              You play {userColorWord.toLowerCase()} from here. {opponentName} is played by an AI at{" "}
              {opponentRating ? <><b style={{ color: "var(--text-secondary)" }}>the same {opponentRating} strength</b> as your real opponent</> : "the same strength as your real opponent"}
              {hasFingerprint ? ", including the mistakes they actually made in this game" : ""} — not a raw chess engine.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, width: 30, height: 30, color: "var(--text-muted)", cursor: "pointer", flexShrink: 0 }}
            aria-label="Close"
          >✕</button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-5 items-start">
          {/* Board */}
          <div>
            <Chessboard options={{
              position: fen,
              boardOrientation: userColorWord.toLowerCase() as "white" | "black",
              canDragPiece: () => status === "your-move",
              onPieceDrop,
              boardStyle: { borderRadius: "var(--board-radius)", boxShadow: "var(--shadow-lg)" },
            }} />
          </div>

          {/* Side panel */}
          <div className="flex flex-col gap-3">
            {/* Eval comparison vs. what actually happened — the headline
                signal for this feature, so it leads the panel and pops
                visually rather than blending into the status text below. */}
            {showEvalCompare && evalDelta != null && (
              <div
                key={sanHistory.length}
                style={{
                  background: evalDelta > EVAL_NOISE_FLOOR ? "rgba(34,197,94,0.12)"
                    : evalDelta < -EVAL_NOISE_FLOOR ? "rgba(224,82,82,0.1)" : "var(--bg-elevated)",
                  border: `1.5px solid ${evalDelta > EVAL_NOISE_FLOOR ? "rgba(34,197,94,0.4)"
                    : evalDelta < -EVAL_NOISE_FLOOR ? "rgba(224,82,82,0.3)" : "var(--border)"}`,
                  borderRadius: 10, padding: "11px 14px",
                  animation: evalDelta > EVAL_NOISE_FLOOR ? "pop-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both" : "fade-in 0.3s ease both",
                }}
              >
                <p style={{
                  fontSize: 13, fontWeight: 800, margin: 0,
                  color: evalDelta > EVAL_NOISE_FLOOR ? "var(--accent-green)"
                    : evalDelta < -EVAL_NOISE_FLOOR ? "var(--clr-blunder)" : "var(--text-secondary)",
                }}>
                  {evalDelta > EVAL_NOISE_FLOOR && `📈 +${Math.round(evalDelta)}cp better than what actually happened here`}
                  {evalDelta < -EVAL_NOISE_FLOOR && `📉 ${Math.round(evalDelta)}cp worse than what actually happened here`}
                  {evalDelta >= -EVAL_NOISE_FLOOR && evalDelta <= EVAL_NOISE_FLOOR && "≈ About the same as what actually happened here"}
                </p>
                <p style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 3 }}>
                  Compared to the real game at this point in the moves
                </p>
              </div>
            )}

            {/* Status banner */}
            <div style={{
              background: status === "checkmate" || status === "stalemate" || status === "draw"
                ? "rgba(201,162,68,0.09)" : status === "error" ? "rgba(224,82,82,0.09)" : "var(--bg-elevated)",
              border: `1px solid ${status === "error" ? "rgba(224,82,82,0.3)" : "var(--border)"}`,
              borderRadius: 10, padding: "10px 14px",
            }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: status === "error" ? "var(--clr-blunder)" : "var(--text-primary)", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                {status === "thinking" && (
                  <span style={{ width: 12, height: 12, border: "2px solid rgba(201,162,68,0.3)", borderTopColor: "var(--gold)", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                )}
                {statusText[status]}
              </p>
              {lastSource === "fingerprint_deviation" && (
                <p style={{ fontSize: 10.5, color: "var(--accent-blue)", marginTop: 4 }}>
                  ⚠ {opponentName} just missed the best move here — matching a pattern from their own game.
                </p>
              )}
              {lastBand != null && status !== "error" && (
                <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                  Playing at the ~{lastBand} level
                </p>
              )}
            </div>

            {/* Move history */}
            {sanHistory.length > 0 && (
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 6 }}>
                  Moves played
                </p>
                <p style={{ fontSize: 12.5, fontFamily: "var(--font-mono)", color: "var(--text-secondary)", lineHeight: 1.8, wordBreak: "break-word" }}>
                  {sanHistory.join("  ")}
                </p>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>
              <button onClick={reset}
                style={{ padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                ↺ Start over
              </button>
              <button onClick={onClose} className="btn-gold" style={{ padding: "8px 18px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>
                Back to analysis
              </button>
            </div>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pop-in {
          0%   { opacity: 0; transform: scale(0.9) translateY(6px); }
          70%  { transform: scale(1.02) translateY(-1px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>,
    document.body
  );
}

"use client";
import { useState, useRef, useCallback, useMemo, useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Chess, type Square } from "chess.js";
import type { PieceDropHandlerArgs } from "react-chessboard";
import { useGameStore } from "@/lib/store";
import { replayMove } from "@/lib/api";
import { replayGate } from "@/lib/replayGate";
import { computeOpponentFingerprint, estimatePhase, PROMOTION_PIECES, PROMOTION_GLYPH, PROMOTION_LABEL, type PromotionPiece } from "@/lib/chess-utils";
import { playSound, sanToSound } from "@/lib/sounds";

const Chessboard = dynamic(
  () => import("react-chessboard").then(m => m.Chessboard),
  { ssr: false, loading: () => <div style={{ aspectRatio: "1/1", background: "var(--bg-elevated)", borderRadius: 12 }} className="animate-pulse" /> }
);

type ReplayStatus = "your-move" | "thinking" | "checkmate" | "stalemate" | "draw" | "error";
type HistoryEntry = { san: string; fen: string; evalCp: number | null; byUser: boolean };
type PendingPromotion = { from: Square; to: Square; color: "w" | "b" };

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

  // chessRef always tracks the LIVE (latest) position — used for legality
  // checks and game-over detection. What's actually shown on the board is
  // `displayFen` below, which can be an earlier point in the replay's own
  // move history when the user has stepped back to review it.
  const chessRef = useRef<Chess | null>(null);

  // Populates chessRef exactly once per mount -- a ref-only effect (no
  // state setters), so it doesn't trip the "no setState in effects" rule
  // that governs the rest of this component's state resets. Mutating a
  // ref during render itself isn't safe (React may discard/redo that
  // render), so this has to run post-render even though the modal is
  // freshly mounted per open and startFen never actually changes in
  // practice for a given instance.
  useEffect(() => {
    try { chessRef.current = new Chess(startFen); } catch { chessRef.current = new Chess(); }
  }, [startFen]);

  const [status,      setStatus]      = useState<ReplayStatus>("your-move");
  const [error,       setError]       = useState("");
  const [history,     setHistory]     = useState<HistoryEntry[]>([]);
  const [viewIndex,   setViewIndex]   = useState(-1); // -1 = startFen, else history[viewIndex]
  const [lastSource,  setLastSource]  = useState<"maia" | "fingerprint_deviation" | null>(null);
  const [lastBand,    setLastBand]    = useState<number | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);

  // Invalidates any in-flight opponent-reply request on reset, so a slow
  // response arriving after the user hits "Start over" can't clobber the
  // freshly-reset state with a stale move from the abandoned line.
  const requestIdRef = useRef(0);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    try { chessRef.current = new Chess(startFen); } catch { chessRef.current = new Chess(); }
    setStatus("your-move");
    setHistory([]);
    setViewIndex(-1);
    setError("");
    setLastSource(null);
    setLastBand(null);
    setPendingPromotion(null);
  }, [startFen]);

  // Lock page scroll while the modal is open — the board sits in a portal
  // at document.body, so nothing else pins the page in place.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const isViewingLive = viewIndex === history.length - 1;
  const liveFen = history.length > 0 ? history[history.length - 1].fen : startFen;
  const displayFen = viewIndex === -1 ? startFen : (history[viewIndex]?.fen ?? liveFen);

  const goTo = useCallback(
    (idx: number) => setViewIndex(Math.max(-1, Math.min(idx, history.length - 1))),
    [history.length]
  );

  // Tell the analyze page's global arrow-key handler to stand down while
  // this modal is open, so ArrowLeft/ArrowRight drive this replay's own
  // move history instead of silently jumping the real game underneath it.
  useEffect(() => {
    replayGate.active = true;
    return () => { replayGate.active = false; };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft")  { e.preventDefault(); goTo(viewIndex - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); goTo(viewIndex + 1); }
      if (e.key === "Home")       { e.preventDefault(); goTo(-1); }
      if (e.key === "End")        { e.preventDefault(); goTo(history.length - 1); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewIndex, history.length, goTo]);

  const requestOpponentReply = useCallback((afterFen: string) => {
    const myRequestId = requestIdRef.current;
    setStatus("thinking");
    replayMove({
      fen:              afterFen,
      opponentRating,
      errorRateByPhase: hasFingerprint ? fingerprint : null,
      phase:            estimatePhase(afterFen),
    }).then(res => {
      if (requestIdRef.current !== myRequestId) return; // reset happened meanwhile — discard
      try {
        if (!chessRef.current) throw new Error("no board");
        const applied = chessRef.current.move(res.move_san);
        if (!applied) throw new Error("illegal reply");
      } catch {
        // Trust the server's resulting FEN even if local SAN replay
        // somehow disagreed with it (promotion notation edge cases etc.)
        chessRef.current = new Chess(res.fen);
      }
      // setViewIndex is called from inside the setHistory updater (not a
      // separate statement) so it always sees the freshly-appended array's
      // real length, never a stale closure over `history` from render time.
      setHistory(h => {
        const next = [...h, { san: res.move_san, fen: res.fen, evalCp: res.eval_cp, byUser: false }];
        setViewIndex(next.length - 1);
        return next;
      });
      setLastSource(res.source);
      setLastBand(res.maia_band);
      if (soundEnabled) playSound(sanToSound(res.move_san));
      if (res.is_checkmate)      setStatus("checkmate");
      else if (res.is_stalemate) setStatus("stalemate");
      else if (res.is_game_over) setStatus("draw");
      else                       setStatus("your-move");
    }).catch(e => {
      if (requestIdRef.current !== myRequestId) return;
      setError((e as Error).message || "The opponent engine is unavailable right now.");
      setStatus("error");
    });
  }, [opponentRating, fingerprint, hasFingerprint, soundEnabled]);

  // Shared by direct (non-promotion) drops and by the promotion picker once
  // the user has chosen a piece -- a promotion move can't be committed to
  // the board until we know which piece it's promoting to.
  const commitUserMove = useCallback((from: Square, to: Square, promotion?: PromotionPiece) => {
    if (!chessRef.current) return false;
    try {
      const move = chessRef.current.move({ from, to, promotion });
      if (!move) return false;
      const newFen = chessRef.current.fen();
      setHistory(h => {
        const next = [...h, { san: move.san, fen: newFen, evalCp: null, byUser: true }];
        setViewIndex(next.length - 1);
        return next;
      });
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
  }, [soundEnabled, requestOpponentReply]);

  const onPieceDrop = useCallback(({ sourceSquare: from, targetSquare: to }: PieceDropHandlerArgs) => {
    if (!chessRef.current || !to || status !== "your-move" || !isViewingLive) return false;
    const fromSq = from as Square;
    const toSq   = to as Square;
    const piece  = chessRef.current.get(fromSq);
    if (piece?.type === "p" && (toSq[1] === "8" || toSq[1] === "1")) {
      // Only pop the picker for an actually-legal promotion (not just any
      // pawn dragged onto the back rank) -- an illegal drop should still
      // just bounce back like any other illegal move.
      const legal = chessRef.current.moves({ square: fromSq, verbose: true });
      if (!legal.some(m => m.to === toSq && m.promotion)) return false;
      setPendingPromotion({ from: fromSq, to: toSq, color: piece.color });
      return false; // reject the raw drop; the piece snaps back until a promotion piece is chosen
    }
    return commitUserMove(fromSq, toSq);
  }, [status, isViewingLive, commitUserMove]);

  if (!startFen) return null;

  // Whoever is to move in the live FEN is the side with no legal moves —
  // the mated side in a checkmate.
  const matedColor: "White" | "Black" = liveFen.split(" ")[1] === "w" ? "White" : "Black";
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
  const displayStatus = !isViewingLive
    ? `Reviewing move ${viewIndex + 1} of ${history.length}`
    : statusText[status];

  // How this replay line compares to what actually happened in the game at
  // the same point — the ply being viewed lines up with the equivalent
  // entry in the real game's move-by-move eval history, already sitting in
  // the store. Only opponent-reply entries carry an eval (the user's own
  // move isn't separately evaluated), so this only shows on those.
  const viewedEntry = viewIndex >= 0 ? history[viewIndex] : null;
  const evalCp = viewedEntry && !viewedEntry.byUser ? viewedEntry.evalCp : null;
  const totalPly = startPly + viewIndex + 1;
  const actualEvalCp = totalPly > 0 ? movesData[totalPly - 1]?.score_after ?? null : null;
  const userIsWhite = userColorWord === "White";
  const toUserAdvantage = (cp: number | null) => cp == null ? null : (userIsWhite ? cp : -cp);
  const replayAdvantage = toUserAdvantage(evalCp);
  const actualAdvantage = toUserAdvantage(actualEvalCp ?? null);
  const evalDelta = replayAdvantage != null && actualAdvantage != null ? replayAdvantage - actualAdvantage : null;
  const EVAL_NOISE_FLOOR = 40; // cp — below this, don't claim a meaningful difference
  const showEvalCompare = evalDelta != null;

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
              You play {userColorWord.toLowerCase()} from here, against{" "}
              <b style={{ color: "var(--text-secondary)" }}>an AI version of {opponentName}</b>
              {opponentRating ? ` (${opponentRating} strength` : " (matched to their strength"}
              {hasFingerprint ? ", including the mistakes they actually made in this game)" : ")"} — not a raw chess engine.
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
          <div style={{ position: "relative" }}>
            <Chessboard options={{
              position: displayFen,
              boardOrientation: userColorWord.toLowerCase() as "white" | "black",
              canDragPiece: () => status === "your-move" && isViewingLive,
              onPieceDrop,
              boardStyle: { borderRadius: "var(--board-radius)", boxShadow: "var(--shadow-lg)" },
            }} />

            {pendingPromotion && (
              <div
                style={{
                  position: "absolute", inset: 0, zIndex: 5,
                  background: "rgba(0,0,0,0.55)", borderRadius: "var(--board-radius)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
                onClick={() => setPendingPromotion(null)}
              >
                <div
                  onClick={e => e.stopPropagation()}
                  className="card"
                  style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}
                >
                  <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", margin: 0 }}>
                    Promote to
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    {PROMOTION_PIECES.map(p => (
                      <button
                        key={p}
                        title={PROMOTION_LABEL[p]}
                        onClick={() => {
                          const { from, to } = pendingPromotion;
                          setPendingPromotion(null);
                          commitUserMove(from, to, p);
                        }}
                        style={{
                          width: 46, height: 46, fontSize: 26, borderRadius: 8, cursor: "pointer",
                          background: "var(--bg-elevated)", border: "1px solid var(--border)",
                          color: "var(--text-primary)",
                        }}
                        className="hover:opacity-80 transition-opacity"
                      >
                        {PROMOTION_GLYPH[pendingPromotion.color][p]}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setPendingPromotion(null)}
                    style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Replay move navigation — steps through THIS session's own
                moves, separate from the real game's move list. */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10 }}>
              <button onClick={() => goTo(-1)} disabled={viewIndex === -1}
                title="Start of this replay"
                style={navBtnStyle(viewIndex === -1)}>⏮</button>
              <button onClick={() => goTo(viewIndex - 1)} disabled={viewIndex === -1}
                title="Previous move"
                style={navBtnStyle(viewIndex === -1)}>◀</button>
              <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 74, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                {history.length === 0 ? "No moves yet" : `Move ${viewIndex + 1} of ${history.length}`}
              </span>
              <button onClick={() => goTo(viewIndex + 1)} disabled={isViewingLive}
                title="Next move"
                style={navBtnStyle(isViewingLive)}>▶</button>
              <button onClick={() => goTo(history.length - 1)} disabled={isViewingLive}
                title="Jump to latest"
                style={navBtnStyle(isViewingLive)}>⏭</button>
            </div>
            {!isViewingLive && (
              <button
                onClick={() => goTo(history.length - 1)}
                style={{
                  display: "block", width: "100%", marginTop: 8, padding: "7px 10px",
                  borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                  background: "rgba(201,162,68,0.1)", border: "1px solid rgba(201,162,68,0.3)", color: "var(--gold-light)",
                }}
              >
                Reviewing an earlier move — jump to latest to keep playing ⏭
              </button>
            )}
          </div>

          {/* Side panel */}
          <div className="flex flex-col gap-3">
            {/* Eval comparison vs. what actually happened — the headline
                signal for this feature, so it leads the panel and pops
                visually rather than blending into the status text below. */}
            {showEvalCompare && evalDelta != null && (
              <div
                key={viewIndex}
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
                {displayStatus}
              </p>
              {isViewingLive && lastSource === "fingerprint_deviation" && (
                <p style={{ fontSize: 10.5, color: "var(--accent-blue)", marginTop: 4 }}>
                  ⚠ {opponentName} just missed the best move here — matching a pattern from their own game.
                </p>
              )}
              {isViewingLive && lastBand != null && status !== "error" && (
                <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                  Playing at the ~{lastBand} level
                </p>
              )}
            </div>

            {/* Move history — each move is clickable, jumps the board to
                that point in this replay's own line. */}
            {history.length > 0 && (
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 6 }}>
                  Moves played
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {history.map((h, i) => (
                    <button
                      key={i}
                      onClick={() => goTo(i)}
                      style={{
                        fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: i === viewIndex ? 800 : 500,
                        color: i === viewIndex ? "var(--gold)" : "var(--text-secondary)",
                        background: i === viewIndex ? "rgba(201,162,68,0.12)" : "transparent",
                        border: `1px solid ${i === viewIndex ? "rgba(201,162,68,0.35)" : "transparent"}`,
                        borderRadius: 4, padding: "2px 5px", cursor: "pointer",
                      }}
                    >
                      {h.san}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>
              {status === "error" && (
                <button onClick={() => requestOpponentReply(liveFen)} className="btn-gold"
                  style={{ padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>
                  ↻ Retry
                </button>
              )}
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

function navBtnStyle(disabled: boolean): CSSProperties {
  return {
    width: 28, height: 28, borderRadius: 7, fontSize: 12,
    background: "var(--bg-elevated)", border: "1px solid var(--border)",
    color: disabled ? "var(--text-muted)" : "var(--text-secondary)",
    opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer",
  };
}

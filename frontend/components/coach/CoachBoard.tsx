"use client";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { Chess, type Square } from "chess.js";
import type { PieceDropHandlerArgs } from "react-chessboard";
import { PROMOTION_PIECES, PROMOTION_GLYPH, PROMOTION_LABEL, type PromotionPiece } from "@/lib/chess-utils";
import { useClickToMove } from "@/lib/useClickToMove";

const Chessboard = dynamic(
  () => import("react-chessboard").then(m => m.Chessboard),
  { ssr: false, loading: () => <BoardSkeleton /> }
);

function BoardSkeleton() {
  return (
    <div
      style={{ background: "var(--bg-elevated)", aspectRatio: "1/1" }}
      className="w-full rounded-lg animate-pulse flex items-center justify-center"
    >
      <span className="text-4xl opacity-20">♟</span>
    </div>
  );
}

/** Standalone, store-free board for /coach — unlike components/Board.tsx,
 * this reads nothing from useGameStore, it's driven entirely by the `fen`
 * prop. Interactive (click or drag to move, same as Board.tsx's explore
 * mode) whenever `onMove` is passed and `interactive` isn't false — the
 * GameStepper view doesn't pass onMove, so it stays read-only there. Every
 * commit is derived fresh from the current `fen` prop (no persistent
 * internal chess.js instance), since the parent always re-renders with the
 * updated FEN right after a move, keeping this component purely
 * functional.
 *
 * `arrowMove`, when set, draws a gold arrow + pulsing ring on the
 * destination square — the coach "pointing at the board" while its voice
 * narration talks about that move (see lib/useCoachVoice.ts). */
export function CoachBoard({
  fen, flipped = false, onMove, interactive = true, arrowMove = null,
}: {
  fen: string;
  flipped?: boolean;
  onMove?: (newFen: string, san: string) => void;
  interactive?: boolean;
  arrowMove?: { from: string; to: string } | null;
}) {
  const movesEnabled = !!onMove && interactive;
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square; color: "w" | "b" } | null>(null);

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
      if (!movesEnabled || !targetSquare) return false;
      const chess = new Chess(fen);
      const from = sourceSquare as Square;
      const to = targetSquare as Square;
      const piece = chess.get(from);
      if (piece?.type === "p" && (to[1] === "8" || to[1] === "1")) {
        const legal = chess.moves({ square: from, verbose: true });
        if (!legal.some(m => m.to === to && m.promotion)) return false;
        setPendingPromotion({ from, to, color: piece.color });
        return false; // reject the raw drop; the piece snaps back until a promotion piece is chosen
      }
      try {
        const result = chess.move({ from, to });
        if (!result) return false;
        onMove?.(chess.fen(), result.san);
        return true;
      } catch {
        return false;
      }
    },
    [fen, movesEnabled, onMove]
  );

  const commitPromotion = useCallback((p: PromotionPiece) => {
    if (!pendingPromotion) return;
    const chess = new Chess(fen);
    try {
      const result = chess.move({ from: pendingPromotion.from, to: pendingPromotion.to, promotion: p });
      if (result) onMove?.(chess.fen(), result.san);
    } catch {
      // swallow -- illegal promotion shouldn't be reachable given the guard above
    } finally {
      setPendingPromotion(null);
    }
  }, [fen, pendingPromotion, onMove]);

  const { onSquareClick, clickSquareStyles } = useClickToMove(fen, movesEnabled, onPieceDrop);

  const arrowSquareStyles: Record<string, React.CSSProperties> = arrowMove
    ? { [arrowMove.to]: { boxShadow: "inset 0 0 0 3px var(--gold)", animation: "coach-voice-pulse 1.2s ease-in-out infinite" } }
    : {};

  const boardOptions: Record<string, unknown> = {
    position: fen,
    boardOrientation: flipped ? "black" : "white",
    boardStyle: {
      borderRadius: "var(--board-radius)",
      boxShadow: "var(--shadow-lg)",
      height: "auto",
    },
    arrows: arrowMove ? [{ startSquare: arrowMove.from, endSquare: arrowMove.to, color: "var(--gold)" }] : [],
  };
  if (movesEnabled) {
    boardOptions.onPieceDrop = onPieceDrop;
    boardOptions.onSquareClick = onSquareClick;
    boardOptions.squareStyles = { ...clickSquareStyles, ...arrowSquareStyles };
    boardOptions.canDragPiece = () => true;
  } else {
    boardOptions.allowDragging = false;
    boardOptions.squareStyles = arrowSquareStyles;
  }

  return (
    <div style={{ width: "100%", aspectRatio: "1 / 1", position: "relative" }}>
      <Chessboard options={boardOptions} />
      {arrowMove && (
        <style>{`
          @keyframes coach-voice-pulse {
            0%, 100% { box-shadow: inset 0 0 0 3px var(--gold); }
            50%      { box-shadow: inset 0 0 0 3px var(--gold), 0 0 10px var(--gold); }
          }
        `}</style>
      )}

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
                  onClick={() => commitPromotion(p)}
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
    </div>
  );
}

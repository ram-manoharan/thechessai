"use client";
import { useState, useCallback, useMemo } from "react";
import { Chess, type Square } from "chess.js";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";

/** Click-to-move for any react-chessboard v5 board: click a piece, then click
 * a destination square. Deliberately delegates the actual move (including
 * promotion) to the board's existing onPieceDrop handler instead of
 * reimplementing move/validation logic, so drag and click always behave
 * identically. `enabled` should mirror whatever condition already gates
 * dragging (canDragPiece / allowDragging) on that board. */
export function useClickToMove(
  fen: string,
  enabled: boolean,
  onPieceDrop: (args: PieceDropHandlerArgs) => boolean,
) {
  const [selected, setSelected] = useState<Square | null>(null);

  const board = useMemo(() => {
    try { return new Chess(fen); } catch { return null; }
  }, [fen]);

  const onSquareClick = useCallback(({ square }: SquareHandlerArgs) => {
    if (!enabled || !board) { setSelected(null); return; }
    const sq = square as Square;

    if (selected) {
      if (sq === selected) { setSelected(null); return; }

      const legal = board.moves({ square: selected, verbose: true });
      if (legal.some(m => m.to === sq)) {
        onPieceDrop({
          piece: { isSparePiece: false, position: selected, pieceType: "" },
          sourceSquare: selected,
          targetSquare: sq,
        });
        setSelected(null);
        return;
      }

      const clickedPiece = board.get(sq);
      const fromPiece = board.get(selected);
      if (clickedPiece && fromPiece && clickedPiece.color === fromPiece.color) {
        setSelected(sq);
        return;
      }
      setSelected(null);
      return;
    }

    const piece = board.get(sq);
    if (piece && piece.color === board.turn()) setSelected(sq);
  }, [board, selected, enabled, onPieceDrop]);

  const clickSquareStyles = useMemo<Record<string, React.CSSProperties>>(() => {
    if (!selected || !board) return {};
    const styles: Record<string, React.CSSProperties> = {
      [selected]: { boxShadow: "inset 0 0 0 3px rgba(201,162,68,0.85)" },
    };
    try {
      const legal = board.moves({ square: selected, verbose: true });
      for (const m of legal) {
        styles[m.to] = m.captured
          ? { boxShadow: "inset 0 0 0 4px rgba(224,82,82,0.55)" }
          : { backgroundImage: "radial-gradient(circle, rgba(120,120,120,0.55) 19%, transparent 20%)" };
      }
    } catch { /* leave selected-square highlight only */ }
    return styles;
  }, [selected, board]);

  return { onSquareClick, clickSquareStyles, selectedSquare: selected, clearSelection: () => setSelected(null) };
}

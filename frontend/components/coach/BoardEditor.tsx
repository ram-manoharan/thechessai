"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { validateFen } from "chess.js";
import type { PositionDataType, PieceDropHandlerArgs, SquareHandlerArgs, PieceHandlerArgs } from "react-chessboard";
import { emptyPosition, startingPositionObject, assembleFen } from "@/lib/fenBoardEditor";

const BoardEditorCanvas = dynamic(
  () => import("./BoardEditorCanvas").then(m => m.BoardEditorCanvas),
  {
    ssr: false,
    loading: () => (
      <div style={{ background: "var(--bg-elevated)", aspectRatio: "1/1", width: "100%" }} className="rounded-lg animate-pulse" />
    ),
  }
);

const ERASE = "erase";

/** Click-a-palette-piece-then-click-a-square (or drag either way) board
 * editor, built on react-chessboard v5's native SparePiece support rather
 * than hand-rolled drag machinery — verified directly against the bundled
 * source: SparePiece drops fire the same onPieceDrop as a normal move
 * (piece.isSparePiece=true), and clicking (not dragging) a SparePiece fires
 * onPieceClick independently, which is the "arm the palette" signal. */
export function BoardEditor({ onConfirm }: { onConfirm: (fen: string) => void }) {
  const [position, setPosition] = useState<PositionDataType>(startingPositionObject());
  const [sideToMove, setSideToMove] = useState<"w" | "b">("w");
  const [armed, setArmed] = useState<string | null>(null);

  const fen = assembleFen(position, sideToMove);
  const validation = validateFen(fen);

  const handlePieceDrop = ({ piece, sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
    setPosition(prev => {
      const next = { ...prev };
      if (!piece.isSparePiece) delete next[sourceSquare];
      if (targetSquare) next[targetSquare] = { pieceType: piece.pieceType };
      return next;
    });
    return true;
  };

  const handleSquareClick = ({ square }: SquareHandlerArgs) => {
    if (!armed) return;
    setPosition(prev => {
      const next = { ...prev };
      if (armed === ERASE) delete next[square];
      else next[square] = { pieceType: armed };
      return next;
    });
  };

  const handlePieceClick = ({ isSparePiece, piece }: PieceHandlerArgs) => {
    if (isSparePiece) setArmed(piece.pieceType);
  };

  const boardOptions = {
    position,
    onPieceDrop: handlePieceDrop,
    onSquareClick: handleSquareClick,
    onPieceClick: handlePieceClick,
    allowDragOffBoard: true,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center", width: "100%", maxWidth: 460, margin: "0 auto" }}>
      <BoardEditorCanvas boardOptions={boardOptions} armed={armed} onArm={setArmed} />

      <div style={{ display: "flex", gap: 8, width: "100%" }}>
        <button
          onClick={() => setArmed(ERASE)}
          style={{
            flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer",
            background: armed === ERASE ? "rgba(224,82,82,0.1)" : "var(--bg-elevated)",
            border: `1px solid ${armed === ERASE ? "rgba(224,82,82,0.3)" : "var(--border)"}`,
            color: armed === ERASE ? "var(--clr-blunder)" : "var(--text-secondary)",
          }}
        >
          ✕ Eraser
        </button>
        <button
          onClick={() => { setPosition(emptyPosition()); setArmed(null); }}
          style={{ flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
        >
          Clear Board
        </button>
        <button
          onClick={() => { setPosition(startingPositionObject()); setArmed(null); }}
          style={{ flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
        >
          Starting Position
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 12, flexShrink: 0 }}>Side to move</span>
        {(["w", "b"] as const).map(c => (
          <button
            key={c}
            onClick={() => setSideToMove(c)}
            style={{
              flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 13,
              fontWeight: sideToMove === c ? 600 : 400, cursor: "pointer",
              background: sideToMove === c ? "var(--gold-subtle)" : "var(--bg-elevated)",
              color: sideToMove === c ? "var(--gold-light)" : "var(--text-secondary)",
              border: sideToMove === c ? "1px solid var(--gold-border)" : "1px solid var(--border)",
            }}
          >
            {c === "w" ? "♔ White" : "♚ Black"}
          </button>
        ))}
      </div>

      <p style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)", wordBreak: "break-all", textAlign: "center" }}>
        {fen}
      </p>
      {!validation.ok && (
        <p style={{ color: "var(--clr-blunder)", fontSize: 12, textAlign: "center", margin: 0 }}>
          {validation.error ?? "Not a legal position yet."}
        </p>
      )}

      <button
        onClick={() => validation.ok && onConfirm(fen)}
        disabled={!validation.ok}
        className="btn-gold"
        style={{ padding: "12px 0", fontSize: 14, borderRadius: 10, width: "100%", opacity: validation.ok ? 1 : 0.5 }}
      >
        Start Discussion →
      </button>
    </div>
  );
}

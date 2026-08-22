"use client";
import { ChessboardProvider, Chessboard, SparePiece, type ChessboardOptions } from "react-chessboard";

const PALETTE: string[] = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"];

/** ChessboardProvider/Chessboard/SparePiece must share one React context, so
 * this whole file is loaded as a single client-only dynamic boundary from
 * BoardEditor.tsx — nesting three independently-dynamic-imported components
 * here would risk them resolving out of sync with each other. */
export function BoardEditorCanvas({
  boardOptions, armed, onArm,
}: {
  boardOptions: ChessboardOptions;
  armed: string | null;
  onArm: (pieceType: string) => void;
}) {
  return (
    <ChessboardProvider options={boardOptions}>
      <div style={{ width: "100%" }}>
        <Chessboard />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6, width: "100%", marginTop: 16 }}>
        {PALETTE.map(pt => (
          <button
            key={pt}
            onClick={() => onArm(pt)}
            style={{
              aspectRatio: "1/1", borderRadius: 8, cursor: "pointer",
              background: armed === pt ? "var(--gold-subtle)" : "var(--bg-elevated)",
              border: `1px solid ${armed === pt ? "var(--gold-border)" : "var(--border)"}`,
              padding: 4,
            }}
            title={pt}
          >
            <SparePiece pieceType={pt} />
          </button>
        ))}
      </div>
    </ChessboardProvider>
  );
}

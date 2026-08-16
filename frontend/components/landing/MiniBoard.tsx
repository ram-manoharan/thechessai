"use client";
import { useEffect, useRef } from "react";

// Shared by every decorative landing-page board (Rematch, Ask-the-coach,
// Puzzle) so a fix here — coloring, coordinates, piece legibility — lands
// everywhere at once instead of drifting across copies.

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
export const PIECE_GLYPH: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

export function parseBoard(rows: string[]): string[][] {
  return rows.map(row => row.split(""));
}

export function squareToRC(square: string): { r: number; c: number } {
  return { c: FILES.indexOf(square[0]), r: 8 - parseInt(square[1], 10) };
}

const prefersReducedMotion = typeof window !== "undefined"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Small letter-grid board (uppercase = White, lowercase = Black, "." =
 * empty) — decorative only, not a real position. Every piece sits on a
 * solid colored disc behind the glyph so it stays legible regardless of
 * square color or how a given OS/browser renders the chess Unicode block
 * (some fonts render those glyphs very thin, especially the white set).
 * `rings` highlights squares with a colored pulsing ring. `move` (optional)
 * slides a piece from one square to another on top of the static board —
 * without it, a board-state swap reads as a teleport rather than a move.
 * Re-triggers fresh whenever move.from/to changes. */
export function MiniBoard({
  rows, rings, size = 156, move,
}: {
  rows: string[][];
  rings?: Record<string, string>;
  size?: number;
  move?: { from: string; to: string; piece: string } | null;
}) {
  // Imperative DOM mutation (not React state) so the slide is driven by a
  // plain double-rAF position swap — starting state renders inline below,
  // the effect only ever writes to the DOM, never triggers a re-render.
  const pieceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!move) return;
    const el = pieceRef.current;
    if (!el) return;
    const to = squareToRC(move.to);
    if (prefersReducedMotion) {
      el.style.transition = "none";
      el.style.left = `${to.c * 12.5}%`;
      el.style.top = `${to.r * 12.5}%`;
      return;
    }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        el.style.transition = "left 0.6s cubic-bezier(0.4,0,0.2,1), top 0.6s cubic-bezier(0.4,0,0.2,1)";
        el.style.left = `${to.c * 12.5}%`;
        el.style.top = `${to.r * 12.5}%`;
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move?.from, move?.to, move?.piece]);

  return (
    <div
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "repeat(8, 1fr)",
        width: size,
        aspectRatio: "1 / 1",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid var(--border-strong)",
        boxShadow: "var(--shadow-md)",
        flexShrink: 0,
        margin: "0 auto",
      }}
    >
      {rows.map((row, r) =>
        row.map((cell, c) => {
          const isLight = (r + c) % 2 === 0;
          const square = `${FILES[c]}${8 - r}`;
          const ring = rings?.[square];
          const hidden = move?.from === square;
          const isWhitePiece = cell !== "." && cell === cell.toUpperCase();
          return (
            <div
              key={square}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: isLight ? "var(--board-light)" : "var(--board-dark)",
              }}
            >
              {c === 0 && (
                <span style={{
                  position: "absolute", top: 1, left: 2,
                  fontSize: 7, fontWeight: 700, lineHeight: 1,
                  color: isLight ? "var(--board-dark)" : "var(--board-light)",
                  opacity: 0.65,
                }}>
                  {8 - r}
                </span>
              )}
              {r === 7 && (
                <span style={{
                  position: "absolute", bottom: 1, right: 2,
                  fontSize: 7, fontWeight: 700, lineHeight: 1,
                  color: isLight ? "var(--board-dark)" : "var(--board-light)",
                  opacity: 0.65,
                }}>
                  {FILES[c]}
                </span>
              )}
              {ring && (
                <span
                  style={{
                    position: "absolute", inset: 1, borderRadius: 3,
                    border: `2px solid ${ring}`,
                    boxShadow: `0 0 8px ${ring}`,
                    animation: "capshow-square-pulse 1.5s ease-in-out infinite",
                  }}
                />
              )}
              {cell !== "." && !hidden && (
                <span
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: "80%", height: "80%", borderRadius: "50%",
                    background: isWhitePiece ? "#f7f4ec" : "#26221c",
                    border: isWhitePiece ? "1px solid rgba(0,0,0,0.22)" : "1px solid rgba(255,255,255,0.18)",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
                    fontSize: "clamp(11px, 2.3vw, 17px)",
                    lineHeight: 1,
                    color: isWhitePiece ? "#1a1a1a" : "#f5f2ea",
                  }}
                >
                  {PIECE_GLYPH[cell]}
                </span>
              )}
            </div>
          );
        }),
      )}
      {move && (() => {
        const from = squareToRC(move.from);
        const isWhitePiece = move.piece === move.piece.toUpperCase();
        return (
          <div
            ref={pieceRef}
            style={{
              position: "absolute",
              width: "12.5%", height: "12.5%",
              left: `${from.c * 12.5}%`,
              top: `${from.r * 12.5}%`,
              display: "flex", alignItems: "center", justifyContent: "center",
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            <span
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "80%", height: "80%", borderRadius: "50%",
                background: isWhitePiece ? "#f7f4ec" : "#26221c",
                border: isWhitePiece ? "1px solid rgba(0,0,0,0.22)" : "1px solid rgba(255,255,255,0.18)",
                boxShadow: "0 2px 4px rgba(0,0,0,0.4)",
                fontSize: "clamp(11px, 2.3vw, 17px)",
                lineHeight: 1,
                color: isWhitePiece ? "#1a1a1a" : "#f5f2ea",
              }}
            >
              {PIECE_GLYPH[move.piece]}
            </span>
          </div>
        );
      })()}
      <style>{`
        @keyframes capshow-square-pulse {
          0%, 100% { opacity: 0.65; }
          50%      { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

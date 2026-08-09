"use client";
import dynamic from "next/dynamic";
import { useRef, useState, useCallback, useMemo } from "react";
import { Chess } from "chess.js";
import type { PieceDropHandlerArgs } from "react-chessboard";
import { useGameStore } from "@/lib/store";

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

const ARROW_COLORS = [
  "rgba(21,120,64,0.85)",
  "rgba(50,100,220,0.70)",
  "rgba(180,60,60,0.55)",
];

const ERROR_CLASSES = ["Blunder", "Mistake", "Miss"];

export function Board() {
  const fen          = useGameStore(s => s.currentFen());
  const move         = useGameStore(s => s.currentMove());
  const movesData    = useGameStore(s => s.movesData);
  const positions    = useGameStore(s => s.positions);
  const currentIdx   = useGameStore(s => s.currentIdx);
  const playerColor  = useGameStore(s => s.playerColor);
  const flipped      = useGameStore(s => s.flipped);
  const showArrows   = useGameStore(s => s.showArrows);
  const exploreMode  = useGameStore(s => s.exploreMode);
  const toggleFlip   = useGameStore(s => s.toggleFlip);
  const toggleArrows = useGameStore(s => s.toggleArrows);
  const setExploreMode = useGameStore(s => s.setExploreMode);

  const chessRef = useRef<Chess | null>(null);
  const [exploreFen, setExploreFen] = useState<string>("");
  const [copied, setCopied] = useState(false);

  // Compute last-move square highlights
  const lastMoveSquares = useMemo<Record<string, React.CSSProperties>>(() => {
    if (exploreMode || currentIdx < 0 || !movesData[currentIdx] || !positions[currentIdx]) return {};
    try {
      const chess = new Chess(positions[currentIdx]);
      const result = chess.move(movesData[currentIdx].san);
      if (!result) return {};
      const isError = ERROR_CLASSES.some(k => movesData[currentIdx].classification?.includes(k));
      const fromBg = isError ? "rgba(224,82,82,0.28)" : "rgba(201,162,68,0.32)";
      const toBg   = isError ? "rgba(224,82,82,0.50)" : "rgba(201,162,68,0.52)";
      return {
        [result.from]: { backgroundColor: fromBg },
        [result.to]:   { backgroundColor: toBg },
      };
    } catch { return {}; }
  }, [currentIdx, movesData, positions, exploreMode]);

  const enterExplore = useCallback(() => {
    chessRef.current = new Chess(fen);
    setExploreFen(fen);
    setExploreMode(true);
  }, [fen, setExploreMode]);

  const exitExplore = useCallback(() => {
    chessRef.current = null;
    setExploreFen("");
    setExploreMode(false);
  }, [setExploreMode]);

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: PieceDropHandlerArgs) => {
      if (!chessRef.current || !targetSquare) return false;
      try {
        const result = chessRef.current.move({
          from: sourceSquare,
          to: targetSquare,
          promotion: "q",
        });
        if (!result) return false;
        setExploreFen(chessRef.current.fen());
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const copyFen = useCallback(() => {
    const currentFen = exploreMode ? exploreFen : fen;
    navigator.clipboard.writeText(currentFen).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [fen, exploreFen, exploreMode]);

  // Engine moves FOR the current board position (currentIdx+1 maps to best moves from that FEN)
  const engineMoves = movesData[currentIdx + 1]?.top_moves ?? [];
  const arrows = showArrows && !exploreMode
    ? engineMoves.slice(0, 3).map((tm, i) => ({
        startSquare: tm.uci.slice(0, 2),
        endSquare:   tm.uci.slice(2, 4),
        color:       ARROW_COLORS[i] ?? ARROW_COLORS[2],
      }))
    : [];

  const orientation = flipped
    ? (playerColor === "white" ? "black" : "white")
    : playerColor;

  const displayFen = exploreMode ? exploreFen : fen;

  const boardOptions: Record<string, unknown> = {
    position:          displayFen,
    boardOrientation:  orientation as "white" | "black",
    customSquareStyles: exploreMode ? {} : lastMoveSquares,
    boardStyle: {
      borderRadius: "var(--board-radius)",
      boxShadow: "var(--shadow-lg)",
    },
  };

  if (!exploreMode) {
    boardOptions.arrows = arrows;
  } else {
    boardOptions.onPieceDrop = onPieceDrop;
    boardOptions.canDragPiece = () => true;
  }

  return (
    <div className="flex flex-col gap-2">
      {exploreMode && (
        <div
          style={{
            background: "rgba(201,162,68,0.1)",
            border: "1px solid var(--gold-border)",
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 12,
            color: "var(--gold-light)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>◈ Try a move — play freely from this position</span>
          <button
            onClick={exitExplore}
            style={{ color: "var(--gold)", fontWeight: 600, fontSize: 11 }}
          >
            ← Back to analysis
          </button>
        </div>
      )}

      <Chessboard options={boardOptions} />

      {/* Board controls */}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <button
          onClick={toggleFlip}
          title="Flip board (F)"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
          }}
          className="px-3 py-1.5 rounded-lg text-xs hover:opacity-80 transition-opacity"
        >
          ⇅ Flip
        </button>
        <button
          onClick={toggleArrows}
          disabled={exploreMode}
          title="Toggle engine arrows"
          style={{
            background: showArrows && !exploreMode ? "rgba(79,142,247,0.15)" : "var(--bg-elevated)",
            border: `1px solid ${showArrows && !exploreMode ? "rgba(79,142,247,0.4)" : "var(--border)"}`,
            color: showArrows && !exploreMode ? "var(--accent-blue)" : "var(--text-secondary)",
            opacity: exploreMode ? 0.4 : 1,
          }}
          className="px-3 py-1.5 rounded-lg text-xs hover:opacity-80 transition-opacity"
        >
          → {showArrows ? "Arrows On" : "Arrows Off"}
        </button>
        <button
          onClick={exploreMode ? exitExplore : enterExplore}
          title="Try moves freely from this position without saving to the game"
          style={{
            background: exploreMode ? "var(--gold-subtle)" : "var(--bg-elevated)",
            border: `1px solid ${exploreMode ? "var(--gold-border)" : "var(--border)"}`,
            color: exploreMode ? "var(--gold-light)" : "var(--text-secondary)",
          }}
          className="px-3 py-1.5 rounded-lg text-xs hover:opacity-80 transition-opacity"
        >
          ◉ {exploreMode ? "Exit" : "Try a move"}
        </button>
        <button
          onClick={copyFen}
          title="Copy FEN to clipboard"
          style={{
            background: copied ? "rgba(34,197,94,0.12)" : "var(--bg-elevated)",
            border: `1px solid ${copied ? "rgba(34,197,94,0.35)" : "var(--border)"}`,
            color: copied ? "var(--accent-green)" : "var(--text-secondary)",
          }}
          className="px-3 py-1.5 rounded-lg text-xs hover:opacity-80 transition-opacity"
        >
          {copied ? "✓ Copied" : "⊕ FEN"}
        </button>
      </div>
    </div>
  );
}

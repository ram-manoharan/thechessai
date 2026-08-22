"use client";
import dynamic from "next/dynamic";

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
 * prop. Read-only in every /coach view (no move-making UI here in v1). */
export function CoachBoard({ fen, flipped = false }: { fen: string; flipped?: boolean }) {
  return (
    <Chessboard
      options={{
        position: fen,
        boardOrientation: flipped ? "black" : "white",
        allowDragging: false,
      }}
    />
  );
}

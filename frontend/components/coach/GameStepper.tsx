"use client";
import { useMemo, useState } from "react";
import { Chess } from "chess.js";
import { CoachBoard } from "./CoachBoard";

/** Client-side-only (chess.js) ply stepper over a loaded PGN — deliberately
 * not the Stockfish game-analysis pipeline /analyze uses, since /coach just
 * needs to let the user pick a position to discuss, not grade every move. */
export function GameStepper({
  pgn, onConfirm,
}: {
  pgn: string;
  onConfirm: (fen: string, sansSoFar: string[]) => void;
}) {
  const { fens, sans, error } = useMemo(() => {
    try {
      const chess = new Chess();
      const start = chess.fen();
      chess.loadPgn(pgn);
      const moves = chess.history({ verbose: true });
      const fens = [start, ...moves.map(m => m.after)];
      const sans = moves.map(m => m.san);
      return { fens, sans, error: "" };
    } catch {
      return { fens: [] as string[], sans: [] as string[], error: "Couldn't read that PGN — check the move text." };
    }
  }, [pgn]);

  const [ply, setPly] = useState(0);

  if (error) {
    return <p style={{ color: "var(--clr-blunder)", fontSize: 13, textAlign: "center" }}>{error}</p>;
  }

  const atStart = ply === 0;
  const atEnd = ply === fens.length - 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", width: "100%", maxWidth: 420, margin: "0 auto" }}>
      <div style={{ width: "100%" }}>
        <CoachBoard fen={fens[ply]} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          onClick={() => setPly(p => Math.max(0, p - 1))}
          disabled={atStart}
          style={navBtn(atStart)}
        >
          ← Prev
        </button>
        <span style={{ color: "var(--text-muted)", fontSize: 12.5, fontVariantNumeric: "tabular-nums", minWidth: 90, textAlign: "center" }}>
          {ply === 0 ? "Starting position" : `After ${sans[ply - 1]} (ply ${ply})`}
        </span>
        <button
          onClick={() => setPly(p => Math.min(fens.length - 1, p + 1))}
          disabled={atEnd}
          style={navBtn(atEnd)}
        >
          Next →
        </button>
      </div>

      <button
        onClick={() => onConfirm(fens[ply], sans.slice(0, ply))}
        className="btn-gold"
        style={{ padding: "12px 24px", fontSize: 14, borderRadius: 10, width: "100%" }}
      >
        Discuss This Position →
      </button>
    </div>
  );
}

function navBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
    background: "var(--bg-elevated)", border: "1px solid var(--border)",
    color: disabled ? "var(--text-muted)" : "var(--text-primary)",
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
  };
}

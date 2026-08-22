"use client";
import { useState } from "react";
import { validateFen } from "chess.js";

const inputBase: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-strong)",
  color: "var(--text-primary)",
  borderRadius: 10,
  padding: "11px 14px",
  fontSize: 14,
  width: "100%",
  outline: "none",
  fontFamily: "var(--font-mono)",
};

const SAMPLE_FEN = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";

export function FenInputPanel({ onLoad }: { onLoad: (fen: string) => void }) {
  const [fen, setFen] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    const trimmed = fen.trim();
    if (!trimmed) { setError("Paste a FEN string first."); return; }
    const result = validateFen(trimmed);
    if (!result.ok) { setError(result.error ?? "That FEN isn't valid."); return; }
    setError("");
    onLoad(trimmed);
  };

  return (
    <div className="card" style={{ width: "100%", maxWidth: 440, margin: "0 auto", padding: 24 }}>
      <p style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
        Paste the FEN of any position — from a book, a database, or one you&apos;re curious about.
      </p>
      <button
        onClick={() => setFen(SAMPLE_FEN)}
        style={{ ...inputBase, padding: "9px 12px", textAlign: "left", cursor: "pointer", color: "var(--text-muted)", fontSize: 12, marginBottom: 12 }}
      >
        Try a sample position
      </button>
      <textarea
        style={{ ...inputBase, fontSize: 13, resize: "none", height: 76, lineHeight: 1.5, marginBottom: 12 }}
        placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
        value={fen}
        onChange={e => { setFen(e.target.value); setError(""); }}
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
      />
      {error && <p style={{ color: "var(--clr-blunder)", fontSize: 12, marginBottom: 12 }}>{error}</p>}
      <button
        onClick={submit}
        disabled={!fen.trim()}
        className="btn-gold"
        style={{ padding: "12px 0", fontSize: 14, borderRadius: 10, width: "100%" }}
      >
        Load Position →
      </button>
    </div>
  );
}

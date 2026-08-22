"use client";
import type { CandidateMove } from "@/lib/api";

function fmtEval(ev: CandidateMove["Evaluation"], sideToMove: "w" | "b"): string {
  // analyze_position's evals are relative to the side to move (python-chess
  // score.relative) — flip to White POV so this list agrees with
  // CoachEvalBar's convention instead of contradicting it.
  const val = sideToMove === "b" ? -ev.value : ev.value;
  if (ev.type === "mate") return `#${val}`;
  return val > 0 ? `+${(val / 100).toFixed(2)}` : (val / 100).toFixed(2);
}

/** Top-3 Stockfish candidates for the loaded position — same data the
 * backend hands the coach chat as grounding, shown here too so the two
 * stay visibly consistent with each other. */
export function MoveRecommendations({
  topMoves, sideToMove,
}: {
  topMoves: CandidateMove[];
  sideToMove: "w" | "b";
}) {
  if (!topMoves.length) {
    return (
      <div className="card" style={{ padding: 14 }}>
        <p style={{ color: "var(--text-muted)", fontSize: 12.5 }}>Evaluating…</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <p style={{
        color: "var(--gold)", fontSize: 10, fontWeight: 800,
        letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10,
      }}>
        Engine recommends
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {topMoves.map((m, i) => (
          <div
            key={m.Move}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "7px 10px", borderRadius: 8,
              background: i === 0 ? "var(--gold-subtle)" : "var(--bg-elevated)",
              border: `1px solid ${i === 0 ? "var(--gold-border)" : "var(--border)"}`,
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: i === 0 ? 700 : 500, color: "var(--text-primary)" }}>
              {i + 1}. {m.SAN}
            </span>
            <span style={{
              fontSize: 12.5, fontFamily: "var(--font-mono)", fontWeight: 600,
              color: i === 0 ? "var(--gold)" : "var(--text-secondary)",
            }}>
              {fmtEval(m.Evaluation, sideToMove)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

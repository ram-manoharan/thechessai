"use client";
import { useGameStore } from "@/lib/store";

export function OpeningBadge() {
  const opening = useGameStore(s => s.opening);
  if (!opening || opening.name === "Unknown Opening") return null;

  return (
    <div
      className="animate-fade-in"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        background: "var(--gold-subtle)",
        border: "1px solid var(--gold-border)",
        borderRadius: 10,
        padding: "8px 14px",
      }}
    >
      <span style={{ color: "var(--gold)", fontSize: 14, lineHeight: 1 }}>◈</span>
      <div style={{ minWidth: 0 }}>
        <span
          style={{
            color: "var(--gold-light)",
            fontSize: 13,
            fontWeight: 600,
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {opening.name}
        </span>
        {opening.eco && (
          <span style={{ color: "var(--gold)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em" }}>
            {opening.eco}
          </span>
        )}
      </div>
    </div>
  );
}

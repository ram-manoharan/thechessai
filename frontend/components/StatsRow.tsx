"use client";
import { useMemo } from "react";
import { useGameStore } from "@/lib/store";
import { countQuality, CLF_CONFIG } from "@/lib/chess-utils";

type StatPill = { key: string; badge: string; color: string; label: string };

const PILLS: StatPill[] = [
  { key: "brilliant",  ...CLF_CONFIG["Brilliant"]  },
  { key: "best",       ...CLF_CONFIG["Best"]        },
  { key: "excellent",  ...CLF_CONFIG["Excellent"]   },
  { key: "inaccuracy", ...CLF_CONFIG["Inaccuracy"]  },
  { key: "mistake",    ...CLF_CONFIG["Mistake"]     },
  { key: "blunder",    ...CLF_CONFIG["Blunder"]     },
];

function Pill({ badge, color, label, count }: StatPill & { count: number }) {
  if (count === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 44 }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 900,
          background: `${color}18`,
          color,
          border: `1px solid ${color}38`,
        }}
      >
        {badge || "✓"}
      </div>
      <span style={{ color, fontSize: 18, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
        {count}
      </span>
      <span style={{ color: "var(--text-muted)", fontSize: 9, textAlign: "center", lineHeight: 1.2, maxWidth: 42 }}>
        {label}
      </span>
    </div>
  );
}

export function StatsRow() {
  const movesData   = useGameStore(s => s.movesData);
  const playerColor = useGameStore(s => s.playerColor);

  const counts = useMemo(
    () => countQuality(movesData, playerColor === "white" ? "White" : "Black"),
    [movesData, playerColor],
  );

  if (!movesData.length) return null;

  return (
    <div className="card animate-fade-in" style={{ padding: "16px 20px" }}>
      <p style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 14 }}>
        Your Moves
      </p>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", flexWrap: "wrap", gap: 6 }}>
        {PILLS.map(p => (
          <Pill
            key={p.key}
            label={p.label}
            color={p.color}
            badge={p.badge}
            count={counts[p.key as keyof typeof counts]}
          />
        ))}
      </div>
    </div>
  );
}

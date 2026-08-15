"use client";
import { useEffect, useState } from "react";

type Stats = {
  registeredUsers: number | null;
  gamesAnalyzed: number | null;
  profilesGenerated: number | null;
  puzzlesSolved: number | null;
};

const TILES: { key: keyof Stats; label: string }[] = [
  { key: "gamesAnalyzed", label: "Games Analysed" },
  { key: "profilesGenerated", label: "Profiles Built" },
  { key: "registeredUsers", label: "Players" },
  { key: "puzzlesSolved", label: "Puzzles Solved" },
];

function formatCount(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

/** Platform-wide "pitch" numbers on the homepage — every one of them is a
 * real, live count from the same dataset the Recurrence Engine mistake
 * ledger is built on, not a marketing placeholder. */
export function PlatformStats() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stats")
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (!cancelled) setStats(data); })
      .catch(() => { if (!cancelled) setStats(null); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: 0,
        background: "var(--gold-subtle)",
        border: "1px solid var(--gold-border)",
        borderRadius: 14,
        padding: "18px 8px",
      }}
    >
      {TILES.map((tile, i) => (
        <div
          key={tile.key}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            padding: "4px 28px",
            borderLeft: i > 0 ? "1px solid var(--border)" : "none",
            minWidth: 110,
          }}
        >
          {stats ? (
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 28,
                fontWeight: 700,
                color: "var(--gold)",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {formatCount(stats[tile.key])}
            </span>
          ) : (
            <span
              className="animate-pulse"
              style={{
                width: 48, height: 28, borderRadius: 6,
                background: "var(--bg-elevated)",
              }}
            />
          )}
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              textAlign: "center",
            }}
          >
            {tile.label}
          </span>
        </div>
      ))}
    </div>
  );
}

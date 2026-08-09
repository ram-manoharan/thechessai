"use client";
import React, { useEffect, useRef, useState } from "react";
import { useGameStore } from "@/lib/store";
import { clfConfig } from "@/lib/chess-utils";
import { playSound, sanToSound } from "@/lib/sounds";

const ERROR_CLASSES = ["Blunder", "Mistake", "Miss"];

function evalBar(accuracyScore: number | undefined): React.ReactNode {
  if (accuracyScore == null) return null;
  const pct = Math.max(0, Math.min(100, accuracyScore));
  let color: string;
  if (pct >= 90)      color = "var(--clr-best)";
  else if (pct >= 70) color = "var(--clr-good)";
  else if (pct >= 50) color = "var(--clr-inaccuracy)";
  else                color = "var(--clr-blunder)";

  return (
    <span
      title={`${pct.toFixed(0)}% accuracy`}
      style={{
        display: "inline-block",
        marginLeft: 4,
        width: 24,
        height: 4,
        borderRadius: 2,
        background: "var(--bg-elevated)",
        verticalAlign: "middle",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          display: "block",
          width: `${pct}%`,
          height: "100%",
          background: color,
          borderRadius: 2,
        }}
      />
    </span>
  );
}

export function MoveList({ innerClassName, fillHeight, seamless }: {
  innerClassName?: string;
  fillHeight?: boolean;
  seamless?: boolean;
}) {
  const movesData    = useGameStore(s => s.movesData);
  const currentIdx   = useGameStore(s => s.currentIdx);
  const soundEnabled = useGameStore(s => s.soundEnabled);
  const navigateTo   = useGameStore(s => s.navigateTo);
  const activeRef    = useRef<HTMLTableCellElement>(null);
  const [filterErrors, setFilterErrors] = useState(false);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentIdx]);

  if (!movesData.length) return null;

  const errorCount = movesData.filter(m => ERROR_CLASSES.some(k => m.classification?.includes(k))).length;

  type Row = { num: number; white: typeof movesData[0]; wi: number; black?: typeof movesData[0]; bi?: number };
  const allRows: Row[] = [];
  for (let i = 0; i < movesData.length; i += 2) {
    allRows.push({ num: Math.floor(i / 2) + 1, white: movesData[i], wi: i, black: movesData[i + 1], bi: i + 1 });
  }

  // When filtered, include rows where either white or black is an error
  const rows = filterErrors
    ? allRows.filter(r =>
        ERROR_CLASSES.some(k => r.white?.classification?.includes(k)) ||
        (r.black && ERROR_CLASSES.some(k => r.black!.classification?.includes(k)))
      )
    : allRows;

  function handleClick(idx: number, san: string) {
    navigateTo(idx);
    if (soundEnabled) playSound(sanToSound(san));
  }

  return (
    <div
      style={{
        background: "var(--bg-surface)",
        ...(seamless ? {} : { border: "1px solid var(--border)" }),
        ...(fillHeight ? { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 } : {}),
      }}
      className={seamless ? "overflow-hidden" : "rounded-xl overflow-hidden"}
    >
      <div
        style={{
          color: "var(--text-secondary)",
          borderBottom: "1px solid var(--border)",
          ...(fillHeight ? { flexShrink: 0 } : {}),
        }}
        className="px-3 py-2 text-xs font-medium flex items-center justify-between"
      >
        <span>Moves</span>
        {errorCount > 0 && (
          <button
            onClick={() => setFilterErrors(f => !f)}
            style={{
              background: filterErrors ? "rgba(224,82,82,0.12)" : "var(--bg-elevated)",
              border: `1px solid ${filterErrors ? "rgba(224,82,82,0.35)" : "var(--border)"}`,
              color: filterErrors ? "var(--clr-blunder)" : "var(--text-muted)",
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {filterErrors ? "All moves" : `Errors only (${errorCount})`}
          </button>
        )}
      </div>
      <div
        className={fillHeight ? "" : (innerClassName ?? "h-[300px]")}
        style={{
          overflowY: "auto",
          ...(fillHeight ? { flex: 1, minHeight: 0 } : {}),
        }}
      >
        <table className="w-full border-collapse text-sm">
          <tbody>
            {rows.map(({ num, white, black, wi, bi }) => (
              <tr
                key={num}
                style={{ background: num % 2 === 0 ? "var(--bg-elevated)" : "var(--bg-surface)" }}
              >
                <td
                  className="px-2 py-1.5 text-xs w-8 select-none"
                  style={{ color: "var(--text-muted)" }}
                >
                  {num}
                </td>
                <MoveCell
                  move={white}
                  idx={wi}
                  active={wi === currentIdx}
                  onClick={handleClick}
                  ref={wi === currentIdx ? activeRef : undefined}
                />
                {black && bi !== undefined
                  ? <MoveCell
                      move={black}
                      idx={bi}
                      active={bi === currentIdx}
                      onClick={handleClick}
                      ref={bi === currentIdx ? activeRef : undefined}
                    />
                  : <td />
                }
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const MoveCell = React.forwardRef<
  HTMLTableCellElement,
  {
    move: ReturnType<typeof useGameStore.getState>["movesData"][0];
    idx: number;
    active: boolean;
    onClick: (idx: number, san: string) => void;
  }
>(({ move, idx, active, onClick }, ref) => {
  const cfg = clfConfig(move.classification ?? "");
  const bg = active
    ? cfg?.color ? `${cfg.color}28` : "rgba(79,142,247,0.18)"
    : cfg?.color ? `${cfg.color}0e` : "transparent";

  const isError = ERROR_CLASSES.some(k => move.classification?.includes(k));
  const cpLoss  = move.cp_loss;

  return (
    <td
      ref={ref}
      onClick={() => onClick(idx, move.san)}
      className="px-2 py-1.5 cursor-pointer transition-all select-none"
      style={{
        background: bg,
        outline: active ? `2px solid ${cfg?.color ?? "var(--accent-blue)"}` : "none",
        outlineOffset: "-2px",
        fontWeight: active ? 700 : 400,
        color: active && cfg?.color ? cfg.color : "var(--text-primary)",
        borderRadius: "2px",
      }}
    >
      <span>{move.san}</span>
      {cfg?.badge && (
        <span className="ml-1 text-[11px] font-black" style={{ color: cfg.color }}>
          {cfg.badge}
        </span>
      )}
      {isError && cpLoss > 0 && (
        <span
          title={`Lost ${cpLoss} centipawns`}
          style={{
            marginLeft: 3,
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            color: cfg?.color ?? "var(--clr-blunder)",
            opacity: 0.75,
            verticalAlign: "middle",
          }}
        >
          −{cpLoss}
        </span>
      )}
      {evalBar(move.accuracy_score)}
    </td>
  );
});
MoveCell.displayName = "MoveCell";

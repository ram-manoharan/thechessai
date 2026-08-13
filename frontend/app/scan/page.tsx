"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  scanScoresheet,
  validateScoresheetMoves,
  type ScoresheetMove,
  type ScoresheetResult,
} from "@/lib/api";
import { useGameStore } from "@/lib/store";

const Chessboard = dynamic(
  () => import("react-chessboard").then(m => m.Chessboard),
  { ssr: false },
);

type Step = "upload" | "scanning" | "review" | "confirm";

interface Meta {
  white_name: string;
  black_name: string;
  date: string;
  result: string;
  event: string;
}

const DEFAULT_META: Meta = {
  white_name: "",
  black_name: "",
  date: "",
  result: "*",
  event: "Handwritten Game",
};

export default function ScanPage() {
  const router = useRouter();
  const reset = useGameStore(s => s.reset);
  const setPgn = useGameStore(s => s.setPgn);

  const [step, setStep] = useState<Step>("upload");
  const [dragOver, setDragOver] = useState(false);
  const [moves, setMoves] = useState<ScoresheetMove[]>([]);
  const [hasErrors, setHasErrors] = useState(false);
  const [validPgn, setValidPgn] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [meta, setMeta] = useState<Meta>(DEFAULT_META);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [editSan, setEditSan] = useState("");
  const [validating, setValidating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyResult = useCallback(
    (
      result: Pick<ScoresheetResult, "moves" | "errors" | "has_errors" | "valid_pgn"> &
        Partial<ScoresheetResult>,
    ) => {
      setMoves(result.moves);
      setHasErrors(result.has_errors);
      setValidPgn(result.valid_pgn);
      if ("notes" in result) setNotes(result.notes ?? "");
      if ("white_name" in result) {
        setMeta(m => ({
          ...m,
          white_name: result.white_name || m.white_name,
          black_name: result.black_name || m.black_name,
          date: result.date || m.date,
          result: result.result || m.result,
        }));
      }
    },
    [],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setScanError(null);
      setStep("scanning");
      try {
        const result = await scanScoresheet(file);
        applyResult(result);
        setSelectedIdx(null);
        setStep("review");
      } catch (e: unknown) {
        setScanError(
          e instanceof Error ? e.message : "Scan failed. Please try again.",
        );
        setStep("upload");
      }
    },
    [applyResult],
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const revalidate = useCallback(
    async (overrideSans?: string[]) => {
      const sans = overrideSans ?? moves.map(m => m.san);
      setValidating(true);
      try {
        const result = await validateScoresheetMoves(sans, {
          white_name: meta.white_name,
          black_name: meta.black_name,
          date: meta.date,
          result: meta.result,
          event: meta.event,
        });
        setMoves(result.moves);
        setHasErrors(result.has_errors);
        setValidPgn(result.valid_pgn);
      } finally {
        setValidating(false);
      }
    },
    [moves, meta],
  );

  const applyEdit = async () => {
    if (selectedIdx === null) return;
    const newSans = moves.map((m, i) =>
      i === selectedIdx ? editSan.trim() : m.san,
    );
    setSelectedIdx(null);
    await revalidate(newSans);
  };

  const handleAnalyse = () => {
    if (!validPgn) return;
    reset();
    setPgn(validPgn);
    router.push("/analyze");
  };

  // Group flat move list into per-move-number pairs for the table
  const pairs: Array<{
    num: number;
    white?: ScoresheetMove;
    black?: ScoresheetMove;
  }> = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({
      num: moves[i].move_num,
      white: moves[i],
      black: moves[i + 1],
    });
  }

  const errorCount = moves.filter(m => !m.valid).length;
  const selectedMove = selectedIdx !== null ? moves[selectedIdx] : null;

  // ── Upload step ─────────────────────────────────────────────────────────────
  if (step === "upload" || step === "scanning") {
    return (
      <div
        style={{
          minHeight: "calc(100vh - 56px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 20px",
        }}
      >
        <div style={{ maxWidth: 520, width: "100%" }}>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <h1
              style={{
                fontSize: 26,
                fontWeight: 700,
                color: "var(--text-primary)",
                margin: 0,
              }}
            >
              Scan Scoresheet
            </h1>
            <p
              style={{
                fontSize: 14,
                color: "var(--text-muted)",
                marginTop: 8,
                lineHeight: 1.6,
              }}
            >
              Upload a photo of your handwritten scoresheet. The AI reads the
              moves, validates them, and sends the game straight to analysis.
            </p>
          </div>

          {/* Error banner */}
          {scanError && (
            <div
              style={{
                background: "rgba(234,82,82,0.12)",
                border: "1px solid rgba(234,82,82,0.3)",
                borderRadius: 10,
                padding: "12px 16px",
                marginBottom: 20,
                fontSize: 13,
                color: "var(--clr-blunder)",
              }}
            >
              {scanError}
            </div>
          )}

          {/* Drop zone */}
          {step === "scanning" ? (
            <div
              style={{
                border: "1px dashed var(--border)",
                borderRadius: 14,
                background: "var(--bg-surface)",
                padding: "64px 32px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  border: "3px solid var(--gold)",
                  borderTopColor: "transparent",
                  borderRadius: "50%",
                  animation: "scan-spin 0.8s linear infinite",
                  margin: "0 auto 20px",
                }}
              />
              <p
                style={{
                  fontSize: 15,
                  color: "var(--text-secondary)",
                  margin: 0,
                }}
              >
                Reading your scoresheet…
              </p>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  marginTop: 6,
                }}
              >
                This takes 10–20 seconds
              </p>
            </div>
          ) : (
            <div
              onDragOver={e => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? "var(--gold)" : "var(--border-strong)"}`,
                borderRadius: 14,
                background: dragOver
                  ? "rgba(201,162,68,0.06)"
                  : "var(--bg-surface)",
                padding: "52px 32px",
                textAlign: "center",
                cursor: "pointer",
                transition: "all 0.18s",
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 14 }}>⬆</div>
              <p
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  margin: "0 0 6px",
                }}
              >
                Drop your photo here
              </p>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--text-muted)",
                  margin: "0 0 20px",
                }}
              >
                or click to browse
              </p>
              <span
                style={{
                  display: "inline-block",
                  padding: "8px 20px",
                  borderRadius: 8,
                  background: "var(--gold)",
                  color: "#000",
                  fontSize: 13,
                  fontWeight: 700,
                  pointerEvents: "none",
                }}
              >
                Choose Photo
              </span>
              <p
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginTop: 16,
                  marginBottom: 0,
                }}
              >
                JPEG · PNG · WebP · HEIC · up to 10 MB
              </p>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            style={{ display: "none" }}
            onChange={onFileChange}
          />

          {/* Tips */}
          {step !== "scanning" && (
            <div
              style={{
                marginTop: 24,
                padding: "16px 18px",
                background: "var(--bg-elevated)",
                borderRadius: 10,
                border: "1px solid var(--border)",
              }}
            >
              <p
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  margin: "0 0 10px",
                }}
              >
                Tips for best results
              </p>
              <ul
                style={{
                  fontSize: 12.5,
                  color: "var(--text-secondary)",
                  lineHeight: 1.8,
                  margin: 0,
                  paddingLeft: 18,
                }}
              >
                <li>Lay the scoresheet flat and photograph straight-on</li>
                <li>Good lighting — avoid shadows across the notation columns</li>
                <li>Both columns (White + Black) should be fully visible</li>
                <li>Higher contrast between ink and paper works best</li>
              </ul>
            </div>
          )}
        </div>

        <style dangerouslySetInnerHTML={{ __html: "@keyframes scan-spin { to { transform: rotate(360deg); } }" }} />
      </div>
    );
  }

  // ── Review step ─────────────────────────────────────────────────────────────
  if (step === "review") {
    return (
      <div
        style={{
          minHeight: "calc(100vh - 56px)",
          padding: "32px 20px 60px",
          maxWidth: 860,
          margin: "0 auto",
        }}
      >
        {/* Page header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 24,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "var(--text-primary)",
                margin: 0,
              }}
            >
              Review Moves
            </h1>
            <p
              style={{
                fontSize: 13,
                color: "var(--text-muted)",
                marginTop: 4,
              }}
            >
              {moves.length} move{moves.length !== 1 ? "s" : ""} read
              {errorCount > 0 ? (
                <span style={{ color: "var(--clr-blunder)", marginLeft: 6 }}>
                  · {errorCount} need{errorCount === 1 ? "s" : ""} correction
                </span>
              ) : (
                <span style={{ color: "var(--clr-good)", marginLeft: 6 }}>
                  · all valid ✓
                </span>
              )}
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => {
                setStep("upload");
                setScanError(null);
              }}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid var(--border-strong)",
                background: "var(--bg-elevated)",
                color: "var(--text-secondary)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Re-scan
            </button>
            <button
              onClick={() => setStep("confirm")}
              disabled={hasErrors}
              style={{
                padding: "8px 18px",
                borderRadius: 8,
                border: "none",
                background: hasErrors ? "var(--bg-elevated)" : "var(--gold)",
                color: hasErrors ? "var(--text-muted)" : "#000",
                fontSize: 13,
                fontWeight: 700,
                cursor: hasErrors ? "not-allowed" : "pointer",
              }}
            >
              Continue →
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: selectedMove ? "1fr 300px" : "1fr",
            gap: 20,
            alignItems: "start",
          }}
        >
          {/* Move table */}
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {/* Table header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "44px 1fr 1fr",
                padding: "10px 16px",
                background: "var(--bg-elevated)",
                borderBottom: "1px solid var(--border)",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: "var(--text-muted)",
                textTransform: "uppercase",
              }}
            >
              <span>#</span>
              <span>White</span>
              <span>Black</span>
            </div>

            {/* Rows */}
            <div style={{ maxHeight: 480, overflowY: "auto" }}>
              {pairs.map(pair => (
                <div
                  key={pair.num}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "44px 1fr 1fr",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {/* Move number */}
                  <div
                    style={{
                      padding: "9px 16px",
                      fontSize: 12,
                      color: "var(--text-muted)",
                      fontVariantNumeric: "tabular-nums",
                      borderRight: "1px solid var(--border)",
                    }}
                  >
                    {pair.num}
                  </div>

                  {/* White move */}
                  <MoveCell
                    move={pair.white}
                    selectedIdx={selectedIdx}
                    onSelect={m => {
                      if (!m.valid) {
                        setSelectedIdx(m.idx);
                        setEditSan(m.san);
                      }
                    }}
                  />

                  {/* Black move */}
                  <MoveCell
                    move={pair.black}
                    selectedIdx={selectedIdx}
                    onSelect={m => {
                      if (!m.valid) {
                        setSelectedIdx(m.idx);
                        setEditSan(m.san);
                      }
                    }}
                    borderLeft
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Correction panel */}
          {selectedMove && (
            <div
              style={{
                background: "var(--bg-surface)",
                border: "1px solid rgba(234,82,82,0.35)",
                borderRadius: 12,
                overflow: "hidden",
                position: "sticky",
                top: 76,
              }}
            >
              <div
                style={{
                  padding: "12px 14px",
                  background: "rgba(234,82,82,0.08)",
                  borderBottom: "1px solid rgba(234,82,82,0.2)",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    color: "var(--clr-blunder)",
                    textTransform: "uppercase",
                    marginBottom: 2,
                  }}
                >
                  Correct move {selectedMove.move_num}
                  {selectedMove.side === "Black" ? "…" : "."}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Position before this move
                </div>
              </div>

              {/* Mini board */}
              <div style={{ padding: 12 }}>
                <Chessboard
                  options={{
                    position: selectedMove.fen_before,
                    boardStyle: { borderRadius: 8 },
                  }}
                />
              </div>

              {/* Edit field */}
              <div style={{ padding: "0 12px 12px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginBottom: 5,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Move notation (SAN)
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    autoFocus
                    value={editSan}
                    onChange={e => setEditSan(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && applyEdit()}
                    placeholder="e.g. Nf3, O-O, exd5"
                    style={{
                      flex: 1,
                      padding: "8px 10px",
                      borderRadius: 7,
                      border: "1px solid var(--border-strong)",
                      background: "var(--bg-elevated)",
                      color: "var(--text-primary)",
                      fontSize: 13,
                      fontFamily: "monospace",
                    }}
                  />
                  <button
                    onClick={applyEdit}
                    disabled={validating || !editSan.trim()}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 7,
                      border: "none",
                      background:
                        validating || !editSan.trim()
                          ? "var(--bg-elevated)"
                          : "var(--gold)",
                      color:
                        validating || !editSan.trim()
                          ? "var(--text-muted)"
                          : "#000",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor:
                        validating || !editSan.trim() ? "not-allowed" : "pointer",
                    }}
                  >
                    {validating ? "…" : "Apply"}
                  </button>
                </div>
                <button
                  onClick={() => setSelectedIdx(null)}
                  style={{
                    marginTop: 8,
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    fontSize: 12,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* OCR notes */}
        {notes && (
          <div
            style={{
              marginTop: 16,
              padding: "12px 14px",
              background: "var(--bg-elevated)",
              borderRadius: 10,
              border: "1px solid var(--border)",
              fontSize: 12.5,
              color: "var(--text-muted)",
              lineHeight: 1.6,
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
              AI notes:{" "}
            </span>
            {notes}
          </div>
        )}

        {/* Validation hint */}
        {hasErrors && (
          <div
            style={{
              marginTop: 16,
              padding: "12px 14px",
              background: "rgba(234,82,82,0.08)",
              borderRadius: 10,
              border: "1px solid rgba(234,82,82,0.2)",
              fontSize: 13,
              color: "var(--text-secondary)",
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: "var(--clr-blunder)" }}>
              {errorCount} invalid move{errorCount !== 1 ? "s" : ""}
            </strong>{" "}
            — click a red move to correct it. All moves must be valid before you
            can continue.
          </div>
        )}
      </div>
    );
  }

  // ── Confirm step ────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        minHeight: "calc(100vh - 56px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: 460, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>✓</div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            {moves.length} moves verified
          </h1>
          <p
            style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}
          >
            Confirm the game details, then analyse.
          </p>
        </div>

        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            padding: "24px",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
            }}
          >
            <label style={labelStyle}>
              <span style={labelText}>White</span>
              <input
                style={inputStyle}
                value={meta.white_name}
                onChange={e =>
                  setMeta(m => ({ ...m, white_name: e.target.value }))
                }
                placeholder="Player name"
              />
            </label>
            <label style={labelStyle}>
              <span style={labelText}>Black</span>
              <input
                style={inputStyle}
                value={meta.black_name}
                onChange={e =>
                  setMeta(m => ({ ...m, black_name: e.target.value }))
                }
                placeholder="Player name"
              />
            </label>
            <label style={labelStyle}>
              <span style={labelText}>Date</span>
              <input
                type="date"
                style={inputStyle}
                value={meta.date}
                onChange={e => setMeta(m => ({ ...m, date: e.target.value }))}
              />
            </label>
            <label style={labelStyle}>
              <span style={labelText}>Result</span>
              <select
                style={{ ...inputStyle, cursor: "pointer" }}
                value={meta.result}
                onChange={e =>
                  setMeta(m => ({ ...m, result: e.target.value }))
                }
              >
                <option value="*">In progress / Unknown</option>
                <option value="1-0">White wins (1-0)</option>
                <option value="0-1">Black wins (0-1)</option>
                <option value="1/2-1/2">Draw (½-½)</option>
              </select>
            </label>
          </div>
          <label style={{ ...labelStyle, marginTop: 14 }}>
            <span style={labelText}>Event</span>
            <input
              style={inputStyle}
              value={meta.event}
              onChange={e => setMeta(m => ({ ...m, event: e.target.value }))}
              placeholder="e.g. Club Championship 2024"
            />
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button
            onClick={() => setStep("review")}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 10,
              border: "1px solid var(--border-strong)",
              background: "var(--bg-elevated)",
              color: "var(--text-secondary)",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            ← Back
          </button>
          <button
            onClick={handleAnalyse}
            style={{
              flex: 2,
              padding: "12px",
              borderRadius: 10,
              border: "none",
              background: "var(--gold)",
              color: "#000",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: "0.02em",
            }}
          >
            Analyse Game →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function MoveCell({
  move,
  selectedIdx,
  onSelect,
  borderLeft,
}: {
  move?: ScoresheetMove;
  selectedIdx: number | null;
  onSelect: (m: ScoresheetMove) => void;
  borderLeft?: boolean;
}) {
  if (!move) {
    return (
      <div
        style={{
          padding: "9px 14px",
          borderLeft: borderLeft ? "1px solid var(--border)" : undefined,
        }}
      />
    );
  }

  const isSelected = selectedIdx === move.idx;
  const isError = !move.valid;

  return (
    <div
      onClick={() => onSelect(move)}
      style={{
        padding: "9px 14px",
        fontSize: 13,
        fontFamily: "monospace",
        cursor: isError ? "pointer" : "default",
        background: isSelected
          ? "rgba(234,82,82,0.15)"
          : isError
            ? "rgba(234,82,82,0.06)"
            : "transparent",
        color: isError ? "var(--clr-blunder)" : "var(--text-primary)",
        borderLeft: borderLeft ? "1px solid var(--border)" : undefined,
        transition: "background 0.14s",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
      title={isError ? move.san + " — click to correct" : undefined}
    >
      {isError && (
        <span
          style={{
            fontSize: 10,
            background: "var(--clr-blunder)",
            color: "#fff",
            borderRadius: 3,
            padding: "1px 4px",
            fontFamily: "sans-serif",
            flexShrink: 0,
          }}
        >
          !
        </span>
      )}
      {move.san || <span style={{ opacity: 0.3 }}>–</span>}
    </div>
  );
}

// ── Shared style tokens ────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
};

const labelText: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const inputStyle: React.CSSProperties = {
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
  fontSize: 13,
  width: "100%",
};

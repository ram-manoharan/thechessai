"use client";
import { useEffect, useRef, useState, useCallback, useMemo, Suspense } from "react";
import dynamic from "next/dynamic";
import { Chess } from "chess.js";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Navbar } from "@/components/Navbar";
import { ImportPanel } from "@/components/ImportPanel";
import { Board } from "@/components/Board";
import { MoveList } from "@/components/MoveList";
import { EvalBar } from "@/components/EvalBar";
import { NavControls } from "@/components/NavControls";
import { EvalGraph } from "@/components/EvalGraph";
import { ClockChart } from "@/components/ClockChart";
import { OpeningBadge } from "@/components/OpeningBadge";
import { StudyPanel } from "@/components/GameStudy";
import { ReplayModal } from "@/components/ReplayModal";
import { useGameStore } from "@/lib/store";
import {
  streamAnalysis, fetchAnnotatedPgn, downloadAnnotatedPgn, explainPosition, fetchPositionPeers,
  saveAnalyzedGame, getAnalyzedGame, fetchPuzzles,
} from "@/lib/api";
import type { TopMove, PeerStats } from "@/lib/api";
import { clfConfig, computeAccuracy, accuracyColor, countQuality, CLF_CONFIG } from "@/lib/chess-utils";

/* ── Toast ─────────────────────────────────────────────────────────────────── */
function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-strong)",
        color: "var(--text-primary)",
        padding: "10px 18px",
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 500,
        boxShadow: "var(--shadow-lg)",
        zIndex: 9999,
        animation: "slide-up 0.2s ease",
      }}
    >
      {"✓ "}{message}
    </div>
  );
}

/* ── Engine lines panel ─────────────────────────────────────────────────────── */
const ERROR_CLASSES = ["Blunder", "Mistake", "Miss"];

function fmtCp(cp: number): string {
  if (Math.abs(cp) >= 9000) return cp > 0 ? "M" : "-M";
  const v = cp / 100;
  return cp > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
}

function buildContinuation(
  san: string,
  continuation: string[],
  fullMoveNum: number,
  isWhiteTurn: boolean,
): string {
  const parts: string[] = [isWhiteTurn ? `${fullMoveNum}.` : `${fullMoveNum}...`, san];
  let curIsWhite = !isWhiteTurn;
  let curMoveNum = isWhiteTurn ? fullMoveNum : fullMoveNum + 1;
  for (const s of continuation.slice(0, 4)) {
    if (curIsWhite) parts.push(`${curMoveNum}.`);
    parts.push(s);
    if (!curIsWhite) curMoveNum++;
    curIsWhite = !curIsWhite;
  }
  return parts.join(" ");
}

function ScoreTag({ cp }: { cp: number }) {
  const label = fmtCp(cp);
  const pos   = cp > 50;
  const neg   = cp < -50;
  return (
    <span style={{
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      fontWeight: 700,
      color:      pos ? "var(--clr-best)" : neg ? "var(--clr-blunder)" : "var(--text-muted)",
      background: pos ? "rgba(76,175,130,0.12)" : neg ? "rgba(224,82,82,0.12)" : "rgba(128,128,128,0.08)",
      border:     `1px solid ${pos ? "rgba(76,175,130,0.25)" : neg ? "rgba(224,82,82,0.22)" : "rgba(128,128,128,0.12)"}`,
      padding:    "1px 6px",
      borderRadius: 4,
      flexShrink: 0,
      minWidth:   36,
      textAlign:  "center" as const,
      display:    "inline-block",
    }}>
      {label}
    </span>
  );
}

/* ── Mini board preview ("Show Line" — see where a continuation ends up) ─────
 * Uses the same Chessboard component as the real board (not hand-drawn glyphs
 * — unicode chess symbols render thin/inconsistent across fonts and were the
 * reason this was hard to see) so piece rendering is identical and crisp,
 * just smaller. Read-only: no drag handlers, no interaction. */
const MiniChessboard = dynamic(
  () => import("react-chessboard").then(m => m.Chessboard),
  { ssr: false }
);

function MiniBoardPreview({ fen, flipped }: { fen: string; flipped: boolean }) {
  const valid = useMemo(() => { try { new Chess(fen); return true; } catch { return false; } }, [fen]);
  if (!valid) return null;

  return (
    <div style={{ width: 176, borderRadius: 8, overflow: "hidden", boxShadow: "var(--shadow-lg)" }}>
      <MiniChessboard
        options={{
          position: fen,
          boardOrientation: flipped ? "black" : "white",
          allowDragging: false,
          boardStyle: { borderRadius: 8 },
        }}
      />
    </div>
  );
}

function EngineLinesPanel() {
  const movesData    = useGameStore(s => s.movesData);
  const currentIdx   = useGameStore(s => s.currentIdx);
  const move         = useGameStore(s => s.currentMove());
  const currentFen   = useGameStore(s => s.currentFen());
  const flipped      = useGameStore(s => s.flipped);
  const playerColor  = useGameStore(s => s.playerColor);
  const metadata     = useGameStore(s => s.metadata);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);

  const engineMoves: TopMove[] = movesData[currentIdx + 1]?.top_moves ?? [];

  if (!movesData.length || !engineMoves.length) return null;

  const halfMoves   = currentIdx + 1;
  const fullMoveNum = Math.floor(halfMoves / 2) + 1;
  const isWhiteTurn = halfMoves % 2 === 0;

  const isError = move && ERROR_CLASSES.some(k => move.classification?.includes(k));
  const cfg     = move ? clfConfig(move.classification ?? "") : null;
  const playerColorWord: "White" | "Black" = playerColor === "white" ? "White" : "Black";
  const isOwnError = isError && move?.color === playerColorWord;
  const opponentColorWord: "White" | "Black" = playerColorWord === "White" ? "Black" : "White";
  const opponentName = (opponentColorWord === "White" ? metadata.White : metadata.Black) || "your opponent";

  // Resulting FEN after playing a line's best move + its continuation, for
  // the "Show Line" mini-board preview.
  const previewFen = (() => {
    if (previewIdx == null) return null;
    const tm = engineMoves[previewIdx];
    if (!tm) return null;
    try {
      const chess = new Chess(currentFen);
      chess.move(tm.san);
      for (const san of tm.continuation ?? []) chess.move(san);
      return chess.fen();
    } catch {
      return null;
    }
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* Classification row — only on errors */}
      {isError && cfg && move && (
        <div style={{
          background: `${cfg.color}12`,
          border:     `1px solid ${cfg.color}35`,
          borderRadius: 10,
          padding:    "7px 12px",
          display:    "flex",
          alignItems: "center",
          gap:        10,
          fontSize:   12,
          flexWrap:   "wrap",
        }}>
          <span style={{ color: cfg.color, fontWeight: 700 }}>{cfg.badge} {cfg.label}</span>
          <span style={{ color: "var(--text-muted)" }}>{"·"}</span>
          <span style={{ color: "var(--text-secondary)" }}>
            {"Best: "}
            <strong style={{ color: "var(--clr-best)", fontFamily: "var(--font-mono)" }}>
              {move.best_move_san}
            </strong>
          </span>
          {move.cp_loss > 0 && (
            <>
              <span style={{ color: "var(--text-muted)" }}>{"·"}</span>
              <span style={{ color: cfg.color, fontFamily: "var(--font-mono)", fontSize: 11 }}>
                {"−"}{move.cp_loss}{" cp"}
              </span>
            </>
          )}
        </div>
      )}

      {/* "What if?" replay CTA — only on the player's own error moves, right
          where their attention already is: the position they just blundered.
          Pulses/glows so it reads as a live prompt to act, not just another
          static info row next to the classification badge above it. */}
      {isOwnError && cfg && (
        <button
          onClick={() => setReplayOpen(true)}
          className="replay-cta-pulse"
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
            background: "linear-gradient(90deg, rgba(201,162,68,0.14), rgba(201,162,68,0.06))",
            border: "1.5px solid var(--gold-border)",
            borderRadius: 10, padding: "11px 14px", cursor: "pointer", textAlign: "left",
            width: "100%",
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" }}>
            {"🧪 Face an AI version of "}{opponentName}{" — could you have avoided this?"}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--gold)", flexShrink: 0 }}>
            {"Play it out →"}
          </span>
        </button>
      )}
      {replayOpen && (
        <ReplayModal startPly={currentIdx} onClose={() => setReplayOpen(false)} />
      )}

      {/* Engine lines */}
      <div style={{
        background:   "var(--bg-surface)",
        border:       "1px solid var(--border)",
        borderRadius: 10,
        padding:      "8px 12px",
        display:      "flex",
        flexDirection: "column",
        gap:          5,
      }}>
        <span style={{
          color: "var(--text-muted)", fontSize: 9, fontWeight: 700,
          letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3,
          display: "block",
        }}>
          {"Engine"}
        </span>
        {engineMoves.slice(0, 3).map((tm, i) => {
          const line = buildContinuation(tm.san, tm.continuation ?? [], fullMoveNum, isWhiteTurn);
          // Split: first two tokens are move-prefix + best move, rest is continuation
          const tokens = line.split(" ");
          const bestPrefix = tokens[0];  // e.g. "1." or "1..."
          const bestSan    = tokens[1];  // e.g. "e4"
          const contPart   = tokens.slice(2).join(" ");

          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, minWidth: 0 }}>
              <ScoreTag cp={tm.score_cp} />
              <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                {bestPrefix}
              </span>
              <span style={{
                fontFamily: "var(--font-mono)", fontWeight: 700, flexShrink: 0,
                color: i === 0 ? "var(--clr-best)" : "var(--text-primary)",
              }}>
                {bestSan}
              </span>
              {tm.practical === false && (
                <span
                  title="Computer-only line — dramatically better than the alternatives, but requires precise engine-level calculation. A simpler practical move may be easier to convert."
                  style={{
                    fontSize: 9, fontWeight: 700, color: "var(--gold)",
                    background: "rgba(201,162,68,0.12)", border: "1px solid var(--gold-border)",
                    borderRadius: 4, padding: "1px 5px", flexShrink: 0, cursor: "help",
                  }}
                >
                  {"⚙ engine-only"}
                </span>
              )}
              {contPart && (
                <span style={{
                  fontFamily: "var(--font-mono)", color: "var(--text-muted)", fontSize: 10,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
                  flex: 1,
                }}>
                  {contPart}
                </span>
              )}
              {(tm.continuation?.length ?? 0) > 0 && (
                <button
                  onClick={() => setPreviewIdx(previewIdx === i ? null : i)}
                  title="Show where this line ends up"
                  style={{
                    fontSize: 10, color: previewIdx === i ? "var(--gold)" : "var(--text-muted)",
                    background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: "0 2px",
                  }}
                >
                  {previewIdx === i ? "▼" : "▶"}
                </button>
              )}
            </div>
          );
        })}
        {previewFen && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 6, marginTop: 2, borderTop: "1px solid var(--border)" }}>
            <MiniBoardPreview fen={previewFen} flipped={flipped} />
            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{"Position after this line"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Peer benchmark ("players near your rating play X% here") ────────────────── */
// Only meaningful once a player has enough tactical fluency to compare
// choices, not for the beginner/novice bands (ANALYSIS_STRATEGY.md section 4)
// — and gracefully renders nothing if the backend has no Lichess explorer
// token configured (LICHESS_EXPLORER_TOKEN is optional, see AUTH_SETUP.md).
const PEER_ELO_CUTOFF = 1200;

function eloToPeerTier(elo: number | null): string {
  if (elo == null) return "intermediate";
  if (elo < 1600) return "intermediate";
  if (elo < 2000) return "advanced";
  return "expert";
}

function PeerBenchmarkWidget() {
  const fen         = useGameStore(s => s.currentFen());
  const estimatedElo = useGameStore(s => s.estimatedElo);
  const [peers, setPeers] = useState<PeerStats | null>(null);

  const eligible = estimatedElo == null || estimatedElo >= PEER_ELO_CUTOFF;

  useEffect(() => {
    if (!eligible || !fen) { setPeers(null); return; }
    let cancelled = false;
    fetchPositionPeers(fen, eloToPeerTier(estimatedElo)).then(r => {
      if (!cancelled) setPeers(r);
    });
    return () => { cancelled = true; };
  }, [fen, estimatedElo, eligible]);

  if (!eligible || !peers || peers.total_games < 20 || !peers.moves.length) return null;

  return (
    <div style={{
      background:   "var(--bg-surface)",
      border:       "1px solid var(--border)",
      borderRadius: 10,
      padding:      "8px 12px",
      display:      "flex",
      flexDirection: "column",
      gap:          4,
    }}>
      <span style={{
        color: "var(--text-muted)", fontSize: 9, fontWeight: 700,
        letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2,
        display: "block",
      }}>
        {"Players near your rating"}
      </span>
      {peers.moves.slice(0, 3).map((m, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text-primary)", width: 42, flexShrink: 0 }}>
            {m.san}
          </span>
          <div style={{ flex: 1, height: 5, background: "var(--bg-elevated)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${m.pct}%`, height: "100%", background: "var(--accent-blue)" }} />
          </div>
          <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", width: 34, textAlign: "right", flexShrink: 0 }}>
            {m.pct}%
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Game metadata strip ────────────────────────────────────────────────────── */
function GameMeta() {
  const metadata = useGameStore(s => s.metadata);
  const w = metadata["White"] ?? "";
  const b = metadata["Black"] ?? "";
  const d = (metadata["Date"] ?? "").slice(0, 10);
  const tc = metadata["TimeControl"] ?? "";
  const event = metadata["Event"] ?? "";

  const tcLabel = (() => {
    if (!tc || tc === "-" || tc === "?") return "";
    const secs = parseInt(tc.split("+")[0] ?? "0");
    if (isNaN(secs)) return "";
    if (secs < 180) return "Bullet";
    if (secs < 480) return "Blitz";
    if (secs < 1500) return "Rapid";
    return "Classical";
  })();

  if (!w && !b) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>
        {w || "?"} <span style={{ color: "var(--text-muted)" }}>vs</span> {b || "?"}
      </span>
      {d && <span style={{ color: "var(--border)" }}>{"·"}</span>}
      {d && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{d}</span>}
      {tcLabel && <span style={{ color: "var(--border)" }}>{"·"}</span>}
      {tcLabel && (
        <span style={{
          fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
          background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)",
        }}>
          {tcLabel}
        </span>
      )}
      {event && event !== "?" && event !== "Rated game" && event !== "Casual game" && (
        <>
          <span style={{ color: "var(--border)" }}>{"·"}</span>
          <span style={{ fontSize: 10, color: "var(--text-muted)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {event}
          </span>
        </>
      )}
    </div>
  );
}

/* ── Compact accuracy bar (replaces large AccuracyBanner rings) ─────────────── */
function CompactAccuracy() {
  const movesData   = useGameStore(s => s.movesData);
  const metadata    = useGameStore(s => s.metadata);
  const playerColor = useGameStore(s => s.playerColor);
  const { white, black } = useMemo(() => computeAccuracy(movesData), [movesData]);

  if (!movesData.length) {
    return (
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "center", borderBottom: "1px solid var(--border)", flexShrink: 0, background: "var(--bg-elevated)" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{"Waiting for analysis…"}</span>
      </div>
    );
  }

  const whiteIsPlayer = playerColor === "white";
  const playerAcc  = whiteIsPlayer ? white : black;
  const oppAcc     = whiteIsPlayer ? black : white;
  const playerName = whiteIsPlayer ? (metadata["White"] ?? "White") : (metadata["Black"] ?? "Black");
  const oppName    = whiteIsPlayer ? (metadata["Black"] ?? "Black") : (metadata["White"] ?? "White");
  const diff = playerAcc - oppAcc;

  return (
    <div style={{ padding: "9px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--border)", flexShrink: 0, background: "var(--bg-elevated)" }}>
      <span style={{ color: "var(--text-secondary)", fontSize: 11, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
        {playerName}
        <span style={{ color: "var(--gold)", fontSize: 9, fontWeight: 700, marginLeft: 4 }}>{"(you)"}</span>
      </span>
      <span style={{ color: accuracyColor(playerAcc), fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
        {Math.round(playerAcc)}
        <span style={{ fontSize: 10, fontWeight: 600 }}>%</span>
      </span>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, gap: 2 }}>
        <span style={{ color: "var(--text-muted)", fontSize: 9 }}>{"vs"}</span>
        {Math.abs(diff) > 0.4 && (
          <span style={{ color: diff > 0 ? "var(--clr-best)" : "var(--clr-blunder)", fontSize: 9, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {diff > 0 ? "+" : ""}{diff.toFixed(1)}
          </span>
        )}
      </div>
      <span style={{ color: accuracyColor(oppAcc), fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
        {Math.round(oppAcc)}
        <span style={{ fontSize: 10, fontWeight: 600 }}>%</span>
      </span>
      <span style={{ color: "var(--text-muted)", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right", minWidth: 0 }}>
        {oppName}
      </span>
    </div>
  );
}

/* ── Mini move-quality strip (replaces large StatsRow) ──────────────────────── */
const QUALITY_PILLS = [
  { key: "brilliant",  ...CLF_CONFIG["Brilliant"]  },
  { key: "best",       ...CLF_CONFIG["Best"]        },
  { key: "excellent",  ...CLF_CONFIG["Excellent"]   },
  { key: "inaccuracy", ...CLF_CONFIG["Inaccuracy"]  },
  { key: "mistake",    ...CLF_CONFIG["Mistake"]     },
  { key: "blunder",    ...CLF_CONFIG["Blunder"]     },
];

function MiniStatsStrip() {
  const movesData   = useGameStore(s => s.movesData);
  const playerColor = useGameStore(s => s.playerColor);
  const counts = useMemo(
    () => countQuality(movesData, playerColor === "white" ? "White" : "Black"),
    [movesData, playerColor],
  );
  if (!movesData.length) return null;

  const visible = QUALITY_PILLS.filter(p => (counts[p.key as keyof typeof counts] ?? 0) > 0);
  if (!visible.length) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 12px", flexShrink: 0, background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
      <span style={{ color: "var(--text-muted)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0 }}>{"Your moves"}</span>
      <span style={{ color: "var(--border)", fontSize: 11 }}>{"·"}</span>
      {visible.map(p => (
        <span key={p.key} style={{ color: p.color, fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
          {p.badge} {counts[p.key as keyof typeof counts]}
        </span>
      ))}
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────────────── */
function AnalyzePageContent() {
  const pgn          = useGameStore(s => s.pgn);
  const analysisKey  = useGameStore(s => s.analysisKey);
  const playerColor  = useGameStore(s => s.playerColor);
  const kidMode      = useGameStore(s => s.kidMode);
  const analyzing    = useGameStore(s => s.analyzing);
  const error        = useGameStore(s => s.error);
  const movesData    = useGameStore(s => s.movesData);
  const positions    = useGameStore(s => s.positions);
  const aiReport     = useGameStore(s => s.aiReport);
  const metadata     = useGameStore(s => s.metadata);
  const setAnalyzing = useGameStore(s => s.setAnalyzing);
  const setResult    = useGameStore(s => s.setResult);
  const setPgn              = useGameStore(s => s.setPgn);
  const setPlayerColor      = useGameStore(s => s.setPlayerColor);
  const setAiReport         = useGameStore(s => s.setAiReport);
  const setKidCommentaries  = useGameStore(s => s.setKidCommentaries);
  const setError            = useGameStore(s => s.setError);
  const resetGame           = useGameStore(s => s.reset);
  const { status: sessionStatus } = useSession();
  const searchParams = useSearchParams();
  const router        = useRouter();

  const stopRef  = useRef<(() => void) | null>(null);
  const [exporting, setExporting]   = useState(false);
  const [toast, setToast]           = useState("");
  const [rightTab, setRightTab]     = useState<"moves" | "eval" | "time" | "study">("moves");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const hasClock = useMemo(() => movesData.some(m => m.clock_remaining != null), [movesData]);

  // Opening a game from /dashboard (?gameId=123) — pure hydration from the
  // saved payload, no Stockfish/AI recompute. Mutually exclusive with
  // ?fresh=1 in practice (dashboard links never carry both).
  //
  // Reads via next/navigation's useSearchParams() (reactive to Next's
  // router) rather than a one-time window.location.search read — a plain
  // useRef-at-mount read never re-fires on a client-side Link navigation
  // between routes, since Next can reuse/update the existing render tree
  // without a fresh mount. The handledGameIdRef guard (not the URL) is what
  // actually prevents double-fetching once handled.
  const handledGameIdRef = useRef<string | null>(null);
  useEffect(() => {
    const gameId = searchParams.get("gameId");
    if (!gameId || handledGameIdRef.current === gameId) return;
    handledGameIdRef.current = gameId;
    router.replace("/analyze");
    setLoadingHistory(true);
    getAnalyzedGame(Number(gameId))
      .then(detail => {
        resetGame();
        setPgn(detail.pgn);
        setPlayerColor(detail.player_color === "black" ? "black" : "white");
        setResult({
          movesData: detail.payload.moves_data,
          positions: detail.payload.positions,
          opening: detail.payload.opening,
          metadata: detail.payload.metadata,
          estimatedElo: detail.payload.estimated_elo,
        });
        if (detail.payload.ai_report) setAiReport(detail.payload.ai_report);
      })
      .catch(() => setError("Couldn't load that saved game."))
      .finally(() => setLoadingHistory(false));
  }, [searchParams, router, resetGame, setPgn, setPlayerColor, setResult, setAiReport, setError]);

  // A just-logged-in landing (see app/login/page.tsx and HeroCTA) carries
  // ?fresh=1 so this page always starts blank instead of resuming whatever
  // game happens to be sitting in localStorage from a previous session.
  // zustand's persisted `pgn` may not be rehydrated yet on the very first
  // render, so this stays "armed" until it has actually seen — and cleared —
  // a non-empty pgn once, then never fires again this page load, so
  // importing a new game right after login can't be wiped out by this check.
  const freshHandledRef = useRef(false);
  useEffect(() => {
    if (searchParams.get("fresh") !== "1" || freshHandledRef.current || !pgn) return;
    freshHandledRef.current = true;
    resetGame();
    router.replace("/analyze");
  }, [searchParams, pgn, resetGame, router]);

  const clearToast = useCallback(() => setToast(""), []);

  useEffect(() => {
    if (!pgn) return;
    // Only run when startAnalysis() or ImportPanel explicitly triggered analysis this session.
    // Cold page loads (analysisKey === 0) never auto-analyze — they just show stored results.
    if (analysisKey === 0) return;

    setAnalyzing(true);
    setError(null);

    stopRef.current = streamAnalysis(
      pgn,
      playerColor,
      (r) => {
        setResult({
          movesData: r.moves_data,
          positions: r.positions,
          opening:   r.opening,
          metadata:  r.metadata,
          estimatedElo: r.estimated_elo,
        });
      },
      (text) => { setAiReport(text); },
      () => {
        setAnalyzing(false);
        // Best-effort save for history/dashboard — read fresh state directly
        // rather than the closed-over values above, since this fires after
        // setResult/setAiReport have already landed. Never blocks or surfaces
        // errors to the UI; the game is already fully usable either way.
        if (sessionStatus === "authenticated") {
          const s = useGameStore.getState();
          if (s.movesData.length > 0) {
            const acc = computeAccuracy(s.movesData);
            saveAnalyzedGame({
              pgn: s.pgn,
              white: s.metadata["White"], black: s.metadata["Black"],
              game_date: s.metadata["Date"], result: s.metadata["Result"], event: s.metadata["Event"],
              player_color: playerColor,
              opening_name: s.opening?.name, opening_eco: s.opening?.eco,
              estimated_elo: s.estimatedElo,
              accuracy_white: acc.white, accuracy_black: acc.black,
              payload: {
                metadata: s.metadata, positions: s.positions,
                opening: s.opening ?? { name: "", eco: "" },
                moves_data: s.movesData, ai_report: s.aiReport, estimated_elo: s.estimatedElo,
              },
            }).catch(() => {});
            // Extract and save puzzles to the daily practice queue (background, fire-and-forget)
            fetchPuzzles(s.pgn, playerColor).catch(() => {});
          }
        }
      },
      (msg) => { setError(msg); setAnalyzing(false); },
      kidMode,
      (data) => { setKidCommentaries(data); },
    );

    return () => stopRef.current?.();
  }, [pgn, analysisKey]); // eslint-disable-line

  function handleNewGame() {
    stopRef.current?.();
    resetGame();
  }

  async function handleExportPgn() {
    if (!pgn || !movesData.length || exporting) return;
    setExporting(true);
    try {
      let keyMoments: object[] = [];
      if (aiReport) {
        try { keyMoments = JSON.parse(aiReport)?.key_moments ?? []; } catch { /* no-op */ }
      }
      const { pgn: annotated } = await fetchAnnotatedPgn(pgn, movesData, keyMoments);
      downloadAnnotatedPgn(annotated, "thechessai-analysis.pgn");
      setToast("AI-annotated PGN downloaded");
    } catch {
      downloadAnnotatedPgn(pgn);
      setToast("PGN downloaded");
    } finally {
      setExporting(false);
    }
  }

  /* ── Empty state — the authenticated workspace entry point ── */
  if (!pgn) {
    return (
      <>
        <Navbar />
        <main style={{ background: "var(--bg-base)", minHeight: "calc(100vh - 56px)", padding: "48px 16px 64px" }}>
          <div style={{ maxWidth: 480, width: "100%", margin: "0 auto", textAlign: "center" }}>
            {loadingHistory ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "60px 0" }}>
                <div style={{ width: 24, height: 24, border: "2px solid var(--border)", borderTopColor: "var(--gold)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading your saved game…</div>
              </div>
            ) : (
              <>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 18, background: "var(--gold-subtle)", border: "1px solid var(--gold-border)", borderRadius: 6, padding: "4px 12px" }}>
                  <span style={{ width: 5, height: 5, background: "var(--gold)", borderRadius: "50%", display: "inline-block", animation: "ai-ready-pulse 2s ease-in-out infinite" }} />
                  <span style={{ color: "var(--gold)", fontSize: 9, fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase" }}>{"✦ AI Chess Analysis"}</span>
                </div>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(22px, 3vw, 32px)", fontWeight: 700, color: "var(--text-primary)", marginBottom: 12, lineHeight: 1.2, letterSpacing: "-0.02em" }}>
                  Import a game<br />to begin analysis.
                </h2>
                <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.65, marginBottom: 30 }}>
                  Paste a PGN or fetch from Lichess and Chess.com. Stockfish evaluates every move, then AI writes your personal coaching report and an interactive Study.
                </p>
                <ImportPanel />
              </>
            )}
          </div>
        </main>
        <style dangerouslySetInnerHTML={{ __html: "@keyframes ai-ready-pulse { 0%,100% { opacity: 0.5; transform: scale(1); } 50% { opacity: 1; transform: scale(1.3); } } @keyframes spin { to { transform: rotate(360deg); } }" }} />
      </>
    );
  }

  /* ── Analysis view ── */
  return (
    <>
      <Navbar />
      <main
        style={{ background: "var(--bg-base)" }}
        className="min-h-screen pt-4 pb-12 px-4"
      >
        {/* ── Status bar ─────────────────────────────────────────────────── */}
        <div className="max-w-7xl mx-auto mb-3 flex items-center gap-2 flex-wrap min-w-0">
          <Link
            href="/"
            style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" }}
            className="hover:text-[var(--gold)] transition-colors shrink-0"
          >
            {"← Home"}
          </Link>
          {/* Opening + meta: hidden on small phones to avoid pushing buttons off-screen */}
          <span className="hidden sm:inline" style={{ color: "var(--border)" }}>|</span>
          <span className="hidden sm:contents"><OpeningBadge /></span>
          <span className="hidden sm:inline" style={{ color: "var(--border)" }}>|</span>
          <span className="hidden sm:contents"><GameMeta /></span>

          {/* Toolbar — wraps on small screens; Puzzles + Export hidden on mobile */}
          <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end min-w-0">
            {analyzing && (
              <div style={{ display: "flex", alignItems: "center", gap: 7,
                background: movesData.length > 0 ? "rgba(201,162,68,0.08)" : "rgba(91,142,245,0.08)",
                border: "1px solid " + (movesData.length > 0 ? "rgba(201,162,68,0.25)" : "rgba(91,142,245,0.25)"),
                borderRadius: 8, padding: "4px 8px",
              }}>
                <div style={{ position: "relative", width: 14, height: 14, flexShrink: 0 }}>
                  <div style={{ width: 14, height: 14, border: "1.5px solid " + (movesData.length > 0 ? "rgba(201,162,68,0.25)" : "rgba(91,142,245,0.25)"),
                    borderTopColor: movesData.length > 0 ? "var(--gold)" : "var(--accent-blue)",
                    borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  <div style={{ position: "absolute", inset: 3, border: "1px solid " + (movesData.length > 0 ? "rgba(201,162,68,0.2)" : "rgba(91,142,245,0.2)"),
                    borderBottomColor: movesData.length > 0 ? "rgba(201,162,68,0.7)" : "rgba(91,142,245,0.7)",
                    borderRadius: "50%", animation: "spin 1.4s linear infinite reverse" }} />
                </div>
                <span style={{
                  color: movesData.length > 0 ? "var(--gold)" : "var(--accent-blue)",
                  fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", whiteSpace: "nowrap",
                }}>
                  <span className="hidden sm:inline">{movesData.length > 0 ? "AI writing report…" : "Stockfish evaluating…"}</span>
                  <span className="sm:hidden">{movesData.length > 0 ? "AI…" : "♞…"}</span>
                </span>
              </div>
            )}

            {movesData.length > 0 && rightTab !== "study" && (
              <button
                onClick={() => setRightTab("study")}
                title={aiReport ? "Your coaching report is ready" : "Coaching report is being written"}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: aiReport ? "var(--gold-subtle)" : "var(--bg-elevated)",
                  border: "1px solid " + (aiReport ? "var(--gold-border)" : "var(--border)"),
                  color: aiReport ? "var(--gold)" : "var(--text-muted)",
                  fontSize: 11, fontWeight: 700, padding: "5px 10px", borderRadius: 8,
                  cursor: "pointer", letterSpacing: "0.04em", transition: "all 0.2s",
                }}
                className="hover:opacity-90 transition-opacity"
              >
                <span>{"◈"}</span>
                {"Study"}
                {aiReport && (
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%", background: "var(--gold)",
                    animation: "report-dot-btn 1s ease-in-out infinite",
                  }} />
                )}
              </button>
            )}

            <button
              onClick={handleNewGame}
              title="Start analysing a different game"
              style={{
                background: "var(--gold-subtle)", border: "1px solid var(--gold-border)",
                color: "var(--gold)", fontSize: 11, fontWeight: 700,
                padding: "5px 10px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap",
              }}
              className="hover:opacity-80 transition-opacity"
            >
              {"+ New"}
            </button>

            {movesData.length > 0 && (
              <>
                <Link
                  href="/puzzles"
                  style={{
                    background: "var(--bg-elevated)", border: "1px solid var(--border)",
                    color: "var(--text-secondary)", fontSize: 11, fontWeight: 500,
                    padding: "5px 10px", borderRadius: 8, textDecoration: "none", whiteSpace: "nowrap",
                  }}
                  className="hidden sm:inline-flex items-center hover:opacity-80 transition-opacity"
                >
                  {"◉ Puzzles"}
                </Link>
                <button
                  onClick={handleExportPgn}
                  disabled={exporting}
                  style={{
                    background: "var(--bg-elevated)", border: "1px solid var(--border)",
                    color: "var(--text-secondary)", fontSize: 11, fontWeight: 500,
                    padding: "5px 10px", borderRadius: 8,
                    opacity: exporting ? 0.5 : 1,
                    cursor: exporting ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                  }}
                  className={`hidden sm:inline-flex items-center hover:opacity-80 transition-opacity${movesData.length > 0 && aiReport && !exporting ? " pgn-export-ready" : ""}`}
                >
                  {exporting ? "Exporting…" : "⬇ Export PGN"}
                  {movesData.length > 0 && aiReport && !exporting && (
                    <span style={{
                      display: "inline-block", width: 5, height: 5, borderRadius: "50%",
                      background: "var(--gold)", marginLeft: 5, verticalAlign: "middle",
                      animation: "pgn-dot 1.6s ease-in-out infinite",
                    }} />
                  )}
                </button>
              </>
            )}
          </div>
        </div>

        {error && (
          <div
            style={{ background: "rgba(224,82,82,0.12)", border: "1px solid rgba(224,82,82,0.35)", color: "var(--clr-blunder)" }}
            className="max-w-7xl mx-auto mb-4 px-4 py-3 rounded-xl text-sm"
          >
            {error}
          </div>
        )}

        {/* ── Main layout: stacked on phones, two-column on tablets/desktop ── */}
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 md:gap-6 items-start">

          {/* ── LEFT: eval bar + board + nav controls ────────────────────── */}
          <div className="flex flex-col gap-3 w-full md:max-w-[380px] lg:max-w-[480px] md:sticky md:top-4 analyze-board-wrap">
            <div className="flex gap-2 items-stretch">
              <EvalBar />
              <div className="flex-1">
                <Board />
              </div>
            </div>
            <NavControls />
            <EngineLinesPanel />
            <PeerBenchmarkWidget />
          </div>

          {/* ── RIGHT: tabbed analysis panel — fixed height on md+, auto on mobile */}
          <div className="analysis-right-panel">
            {/* Compact accuracy header */}
            <CompactAccuracy />

            {/* Tab bar */}
            <div style={{ display: "flex", background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)", flexShrink: 0, padding: "0 4px" }}>
              {([
                { id: "moves", label: "♟ Moves" },
                { id: "study", label: "◈ Study" },
                { id: "eval",  label: "∿ Eval" },
                ...(hasClock ? [{ id: "time", label: "⏱ Time" }] : []),
              ] as { id: "moves" | "study" | "eval" | "time"; label: string }[]).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setRightTab(tab.id)}
                  className={tab.id === "study" && aiReport && rightTab !== "study" ? "study-tab-ready" : undefined}
                  style={{
                    padding: "9px 14px",
                    fontSize: 11,
                    fontWeight: 700,
                    border: "none",
                    borderBottom: rightTab === tab.id
                      ? tab.id === "study"
                        ? "2px solid #5b8ef5"
                        : "2px solid var(--gold)"
                      : "2px solid transparent",
                    background: "transparent",
                    color: rightTab === tab.id ? "var(--text-primary)" : "var(--text-muted)",
                    cursor: "pointer",
                    letterSpacing: "0.04em",
                    transition: "color 0.15s, background 0.15s",
                    whiteSpace: "nowrap",
                    position: "relative" as const,
                    borderRadius: "6px 6px 0 0",
                  }}
                >
                  {tab.label}
                  {/* Dot when AI report is ready and we're not on study tab */}
                  {tab.id === "study" && aiReport && rightTab !== "study" && (
                    <span
                      style={{
                        position: "absolute", top: 6, right: 4,
                        width: 5, height: 5, borderRadius: "50%",
                        background: "#5b8ef5",
                        animation: "report-dot-btn 1s ease-in-out infinite",
                      }}
                    />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content — fills all remaining height */}
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {rightTab === "moves" && (
                <>
                  <MiniStatsStrip />
                  <MoveList fillHeight seamless />
                </>
              )}
              {rightTab === "study" && (
                <StudyPanel
                  aiReport={aiReport}
                  movesData={movesData}
                  positions={positions}
                  playerColor={playerColor}
                  analyzing={analyzing}
                  explainPositionFn={explainPosition}
                  metadata={metadata}
                />
              )}
              {rightTab === "eval" && (
                <div style={{ flex: 1, overflowY: "auto", padding: 14, scrollbarWidth: "thin" }}>
                  <EvalGraph />
                </div>
              )}
              {rightTab === "time" && (
                <div style={{ flex: 1, overflowY: "auto", padding: 14, scrollbarWidth: "thin" }}>
                  <ClockChart />
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {toast && <Toast message={toast} onDone={clearToast} />}

      <style dangerouslySetInnerHTML={{ __html: "@keyframes slide-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } } @keyframes spin { to { transform: rotate(360deg); } } @keyframes report-dot-btn { 0%,100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 1; transform: scale(1.4); } } @keyframes study-tab-glow { 0%,100% { background: rgba(91,142,245,0.05); } 50% { background: rgba(91,142,245,0.18); } } .study-tab-ready { animation: study-tab-glow 1.6s ease-in-out infinite; } @keyframes pgn-export-glow { 0%,100% { background: rgba(201,162,68,0.06); border-color: rgba(201,162,68,0.18); color: var(--gold); } 50% { background: rgba(201,162,68,0.18); border-color: rgba(201,162,68,0.45); color: var(--gold-light); } } .pgn-export-ready { animation: pgn-export-glow 1.6s ease-in-out infinite; } @keyframes pgn-dot { 0%,100% { opacity: 0.4; transform: scale(1); } 50% { opacity: 1; transform: scale(1.4); } }" }} />
    </>
  );
}

// useSearchParams() requires a Suspense boundary above it (Next.js opts the
// page out of static rendering otherwise) — this page is fully client/dynamic
// already, so the fallback never really shows in practice.
export default function AnalyzePage() {
  return (
    <Suspense fallback={null}>
      <AnalyzePageContent />
    </Suspense>
  );
}

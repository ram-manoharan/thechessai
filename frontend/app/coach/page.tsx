"use client";
import { useEffect, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { CoachBoard } from "@/components/coach/CoachBoard";
import { CoachEvalBar } from "@/components/coach/CoachEvalBar";
import { MoveRecommendations } from "@/components/coach/MoveRecommendations";
import { FenInputPanel } from "@/components/coach/FenInputPanel";
import { GameImportPanel } from "@/components/coach/GameImportPanel";
import { GameStepper } from "@/components/coach/GameStepper";
import { BoardEditor } from "@/components/coach/BoardEditor";
import { CoachChat } from "@/components/coach/CoachChat";
import { useCoachVoice } from "@/lib/useCoachVoice";
import { evaluateCandidateMoves, discussPosition, type CandidateMove, type ChatMessage } from "@/lib/api";

type Stage =
  | { kind: "choose" }
  | { kind: "fen-input" }
  | { kind: "game-input" }
  | { kind: "game-step"; pgn: string }
  | { kind: "setup" }
  | {
      kind: "discussing";
      // positions[0] is the anchor position the user loaded; each entry
      // after that is one move played on the board during the chat.
      // exploredSans tracks the SAN for each of those (positions.length
      // === exploredSans.length + 1 always). originalMoveHistory is the
      // move list from the game-load path (undefined for FEN/setup), kept
      // separate from exploredSans so "reset to original position" can
      // restore exactly the pre-exploration state.
      positions: string[];
      exploredSans: string[];
      originalMoveHistory?: string[];
    };

/** Mate scores from analyze_position are relative to the side to move —
 * flip to a White-POV cp-like magnitude (±9999, matching the existing
 * ≥9000-is-mate convention EvalBar/cpToWhitePct already use elsewhere). */
function matePovCp(value: number, sideToMove: "w" | "b"): number {
  const sideToMoveWinning = value > 0;
  const whiteWinning = sideToMove === "b" ? !sideToMoveWinning : sideToMoveWinning;
  return whiteWinning ? 9999 : -9999;
}

const smallBtn: React.CSSProperties = {
  padding: "7px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 500, cursor: "pointer",
  background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)",
};

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ maxWidth: 460, margin: "0 auto 14px" }}>
      <button onClick={onBack} style={{ ...smallBtn, background: "none", border: "none", padding: 0, color: "var(--text-muted)" }}>
        {"← Choose a different way to load a position"}
      </button>
    </div>
  );
}

function LoadMethodPicker({ onPick }: { onPick: (kind: "fen-input" | "game-input" | "setup") => void }) {
  const options: Array<{ kind: "fen-input" | "game-input" | "setup"; icon: string; title: string; desc: string }> = [
    { kind: "fen-input", icon: "◈", title: "Paste a FEN", desc: "Bring a position from a book, database, or analysis you're already looking at." },
    { kind: "game-input", icon: "♞", title: "Load a Game", desc: "Fetch from Lichess or Chess.com, or paste a PGN, then pick the exact position." },
    { kind: "setup", icon: "⚙", title: "Set Up a Position", desc: "Place pieces on an empty board yourself, like a chess.com/lichess board editor." },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
      {options.map(o => (
        <button
          key={o.kind}
          onClick={() => onPick(o.kind)}
          className="card card-hover"
          style={{ padding: 22, textAlign: "left", cursor: "pointer" }}
        >
          <div style={{ fontSize: 22, color: "var(--gold)", marginBottom: 10 }}>{o.icon}</div>
          <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>{o.title}</p>
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>{o.desc}</p>
        </button>
      ))}
    </div>
  );
}

export default function CoachPage() {
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [engine, setEngine] = useState<{ cp: number | null; topMoves: CandidateMove[] } | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  const fen = stage.kind === "discussing" ? stage.positions[stage.positions.length - 1] : null;
  const sideToMove: "w" | "b" = fen?.split(" ")[1] === "b" ? "b" : "w";
  const fullMoveHistory = stage.kind === "discussing"
    ? [...(stage.originalMoveHistory ?? []), ...stage.exploredSans]
    : undefined;

  // Speaks the latest coach reply aloud, and tracks which move it's
  // currently talking about so the board can point at it — see
  // lib/useCoachVoice.ts. Derived straight from the message list rather
  // than e.g. messages.length: this self-resets to "" the instant a new
  // question is sent (before the reply arrives), correctly cutting off
  // stale speech from the previous answer.
  const lastMsg = messages[messages.length - 1];
  const spokenText = lastMsg?.role === "assistant" ? lastMsg.content : "";
  const { activeMove } = useCoachVoice(spokenText, fen ?? "", voiceEnabled);

  // Re-fetches whenever the discussed FEN changes — loading a new position,
  // or playing/undoing a move on the board, always means a fresh
  // evaluation, never a stale carried-over one.
  useEffect(() => {
    if (!fen) { setEngine(null); return; }
    let cancelled = false;
    setEngine(null);
    evaluateCandidateMoves(fen, 3)
      .then(({ top_moves }) => {
        if (cancelled) return;
        const ev = top_moves[0]?.Evaluation;
        const cp = !ev ? null
          : ev.type === "mate" ? matePovCp(ev.value, sideToMove)
          : (sideToMove === "b" ? -ev.value : ev.value);
        setEngine({ cp, topMoves: top_moves });
      })
      .catch(() => setEngine({ cp: null, topMoves: [] }));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]);

  function startDiscussing(newFen: string, originalMoveHistory?: string[]) {
    setMessages([]);
    setStage({ kind: "discussing", positions: [newFen], exploredSans: [], originalMoveHistory });
  }

  /** Shared by manual chat input and the auto-prompt fired when a move is
   * played on the board — both are just "say this to the coach, using the
   * given position/history for grounding." */
  async function sendToCoach(text: string, atFen: string, historyForGrounding?: string[]) {
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setChatLoading(true);
    try {
      const { reply } = await discussPosition({
        fen: atFen,
        history: next,
        move_history_so_far: historyForGrounding,
      });
      setMessages(m => [...m, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages(m => [...m, { role: "assistant", content: `Sorry, something went wrong: ${(e as Error).message}` }]);
    } finally {
      setChatLoading(false);
    }
  }

  function handleSend(text: string) {
    if (stage.kind !== "discussing") return;
    sendToCoach(text, stage.positions[stage.positions.length - 1], fullMoveHistory);
  }

  /** The core of the redesign: moving a piece on the board isn't a dead
   * end that just changes what's displayed — it immediately asks the coach
   * about the position that results, the same way a coach sitting next to
   * you would react as you move. */
  function handleBoardMove(newFen: string, san: string) {
    if (stage.kind !== "discussing") return;
    const positions = [...stage.positions, newFen];
    const exploredSans = [...stage.exploredSans, san];
    setStage({ kind: "discussing", positions, exploredSans, originalMoveHistory: stage.originalMoveHistory });
    const newHistory = [...(stage.originalMoveHistory ?? []), ...exploredSans];
    sendToCoach(`I just played ${san}. What do you think?`, newFen, newHistory);
  }

  function undoMove() {
    if (stage.kind !== "discussing" || stage.exploredSans.length === 0) return;
    setStage({
      kind: "discussing",
      positions: stage.positions.slice(0, -1),
      exploredSans: stage.exploredSans.slice(0, -1),
      originalMoveHistory: stage.originalMoveHistory,
    });
  }

  function resetToOriginal() {
    if (stage.kind !== "discussing" || stage.exploredSans.length === 0) return;
    setStage({
      kind: "discussing",
      positions: [stage.positions[0]],
      exploredSans: [],
      originalMoveHistory: stage.originalMoveHistory,
    });
  }

  const hasExplored = stage.kind === "discussing" && stage.exploredSans.length > 0;

  return (
    <>
      <Navbar />
      <main style={{ background: "var(--bg-base)" }} className="min-h-screen pt-6 pb-16 px-4">
        <div className="max-w-6xl mx-auto">
          <div style={{ marginBottom: 28, textAlign: "center" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 12, background: "var(--gold-subtle)", border: "1px solid var(--gold-border)", borderRadius: 6, padding: "4px 12px" }}>
              <span style={{ color: "var(--gold)", fontSize: 9, fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                {"✍ Ask the AI Coach"}
              </span>
            </div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(24px, 3.5vw, 34px)", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
              Bring any position. Talk it through.
            </h1>
            {stage.kind === "choose" && (
              <p style={{ color: "var(--text-secondary)", fontSize: 14, maxWidth: 560, margin: "0 auto" }}>
                Paste a FEN, load a game, or set up a board yourself — then discuss it in depth with the coach, grounded in real engine evaluation.
              </p>
            )}
          </div>

          {stage.kind === "choose" && <LoadMethodPicker onPick={kind => setStage({ kind })} />}

          {stage.kind === "fen-input" && (
            <>
              <BackButton onBack={() => setStage({ kind: "choose" })} />
              <FenInputPanel onLoad={f => startDiscussing(f)} />
            </>
          )}

          {stage.kind === "game-input" && (
            <>
              <BackButton onBack={() => setStage({ kind: "choose" })} />
              <GameImportPanel onGameLoaded={pgn => setStage({ kind: "game-step", pgn })} />
            </>
          )}

          {stage.kind === "game-step" && (
            <>
              <BackButton onBack={() => setStage({ kind: "choose" })} />
              <GameStepper pgn={stage.pgn} onConfirm={(f, sans) => startDiscussing(f, sans)} />
            </>
          )}

          {stage.kind === "setup" && (
            <>
              <BackButton onBack={() => setStage({ kind: "choose" })} />
              <BoardEditor onConfirm={f => startDiscussing(f)} />
            </>
          )}

          {stage.kind === "discussing" && (
            <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_380px] gap-6 items-start">
              <div className="hidden lg:flex justify-center">
                <CoachEvalBar cp={engine?.cp ?? null} flipped={flipped} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="flex lg:hidden justify-center">
                  <CoachEvalBar cp={engine?.cp ?? null} flipped={flipped} />
                </div>
                <CoachBoard
                  fen={stage.positions[stage.positions.length - 1]}
                  flipped={flipped}
                  onMove={handleBoardMove}
                  interactive={!chatLoading}
                  arrowMove={activeMove}
                />
                <p style={{ textAlign: "center", fontSize: 11.5, color: "var(--text-muted)", margin: 0 }}>
                  {hasExplored
                    ? `Exploring: ${stage.exploredSans.join(" ")}`
                    : "Drag or click a piece to try a move — the coach will react to it."}
                </p>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  <button onClick={() => setFlipped(f => !f)} style={smallBtn}>{"⟲ Flip Board"}</button>
                  <button
                    onClick={() => setVoiceEnabled(v => !v)}
                    title={voiceEnabled ? "Mute coach voice" : "Enable coach voice"}
                    style={{
                      width: 36, height: 36, borderRadius: 8, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
                      background: voiceEnabled ? "rgba(79,142,247,0.12)" : "var(--bg-elevated)",
                      border: `1px solid ${voiceEnabled ? "rgba(79,142,247,0.35)" : "var(--border)"}`,
                      color: voiceEnabled ? "var(--accent-blue)" : "var(--text-muted)",
                    }}
                  >
                    {voiceEnabled ? "🔊" : "🔇"}
                  </button>
                  {hasExplored && (
                    <>
                      <button onClick={undoMove} style={smallBtn}>{"↩ Undo Move"}</button>
                      <button onClick={resetToOriginal} style={smallBtn}>{"⟲ Reset to Original Position"}</button>
                    </>
                  )}
                  <button onClick={() => setStage({ kind: "choose" })} style={smallBtn}>Load a different position</button>
                </div>
                <MoveRecommendations topMoves={engine?.topMoves ?? []} sideToMove={sideToMove} />
              </div>
              <CoachChat messages={messages} loading={chatLoading} onSend={handleSend} />
            </div>
          )}
        </div>
      </main>
    </>
  );
}

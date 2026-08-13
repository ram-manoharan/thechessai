"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { fetchLichessGames, fetchChessdotcomGames, splitPgn, getMe, type Me } from "@/lib/api";
import { useGameStore } from "@/lib/store";

const SAMPLE_PGN = `[Event "Immortal Game"]
[Site "London"]
[Date "1851.06.21"]
[White "Anderssen, Adolf"]
[Black "Kieseritzky, Lionel"]
[Result "1-0"]

1. e4 e5 2. f4 exf4 3. Bc4 Qh4+ 4. Kf1 b5 5. Bxb5 Nf6 6. Nf3 Qh6
7. d3 Nh5 8. Nh4 Qg5 9. Nf5 c6 10. g4 Nf6 11. Rg1 cxb5 12. h4 Qg6
13. h5 Qg5 14. Qf3 Ng8 15. Bxf4 Qf6 16. Nc3 Bc5 17. Nd5 Qxb2
18. Bd6 Bxg1 19. e5 Qxa1+ 20. Ke2 Na6 21. Nxg7+ Kd8 22. Qf6+ Nxf6
23. Be7# 1-0`;

type Platform = "lichess" | "chessdotcom";
type Tab = "import" | "paste" | "upload";

const inputBase: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-strong)",
  color: "var(--text-primary)",
  borderRadius: 10,
  padding: "11px 14px",
  fontSize: 14,
  width: "100%",
  outline: "none",
  transition: "border-color 0.2s, box-shadow 0.2s",
};

/* ── PGN header parsers ─────────────────────────────────────────────────────── */
function header(pgn: string, tag: string): string {
  return pgn.match(new RegExp(`\\[${tag} "(.+?)"\\]`))?.[1] ?? "";
}

function timeControlLabel(tc: string): string {
  if (!tc || tc === "-" || tc === "?") return "";
  const secs = parseInt(tc.split("+")[0] ?? "0");
  if (isNaN(secs)) return "";
  if (secs < 180)  return "Bullet";
  if (secs < 480)  return "Blitz";
  if (secs < 1500) return "Rapid";
  return "Classical";
}

function resultDisplay(r: string): { label: string; color: string; bg: string } {
  if (r === "1-0")       return { label: "1-0",  color: "var(--clr-best)",    bg: "rgba(34,197,94,0.12)"  };
  if (r === "0-1")       return { label: "0-1",  color: "var(--clr-blunder)", bg: "rgba(224,82,82,0.12)"  };
  if (r === "1/2-1/2")   return { label: "½-½",  color: "var(--text-muted)",  bg: "var(--bg-elevated)"    };
  return                          { label: "?",    color: "var(--text-muted)",  bg: "var(--bg-elevated)"    };
}

type GameInfo = { pgn: string; white: string; black: string; date: string; result: string; timeControl: string };

function parseGame(pgn: string): GameInfo {
  return {
    pgn,
    white:       header(pgn, "White"),
    black:       header(pgn, "Black"),
    date:        header(pgn, "Date").slice(0, 7),
    result:      header(pgn, "Result"),
    timeControl: timeControlLabel(header(pgn, "TimeControl")),
  };
}

export function ImportPanel() {
  const router         = useRouter();
  const { status: sessionStatus } = useSession();
  const startAnalysis  = useGameStore(s => s.startAnalysis);
  const setPlayerColor = useGameStore(s => s.setPlayerColor);
  const setKidMode     = useGameStore(s => s.setKidMode);

  const [tab, setTab]              = useState<Tab>("import");
  const [platform, setPlatform]    = useState<Platform>("lichess");
  const [username, setUsername]    = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [me, setMe]                = useState<Me | null>(null);
  const [loading, setLoading]      = useState(false);
  const [error, setError]          = useState("");
  const [games, setGames]          = useState<GameInfo[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [color, setColor]          = useState<"white" | "black">("white");
  const [pgnText, setPgnText]      = useState("");
  const [dragging, setDragging]    = useState(false);
  const [kidMode, setKidModeLocal] = useState(false);
  const [showChips, setShowChips]  = useState(false);
  const fileInputRef               = useRef<HTMLInputElement>(null);

  // Prefill from the signed-in user's linked Chess.com/Lichess username
  // (set via the onboarding prompt or the profile page) so they don't have
  // to retype it every time they import a game.
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    getMe().then(setMe).catch(() => {});
  }, [sessionStatus]);

  const savedUsername = platform === "lichess" ? me?.lichess_username : me?.chesscom_username;
  // Derived rather than synced via effect: shows the linked username until
  // the person edits the field, with no extra render/effect round-trip.
  const effectiveUsername = !usernameTouched && savedUsername ? savedUsername : username;

  const OUTPUT_CHIPS = [
    { label: "◈ Move grades", bg: "rgba(91,142,245,0.1)",  border: "1px solid rgba(91,142,245,0.25)",  color: "var(--accent-blue)" },
    { label: "◎ Accuracy",    bg: "rgba(76,175,130,0.1)",  border: "1px solid rgba(76,175,130,0.25)",  color: "var(--clr-best)" },
    { label: "✦ AI Report",   bg: "var(--gold-subtle)",    border: "1px solid var(--gold-border)",     color: "var(--gold)" },
    { label: "◇ Puzzles",     bg: "rgba(156,107,204,0.1)", border: "1px solid rgba(156,107,204,0.25)", color: "#9C6BCC" },
  ];

  const handleAnalyze = (pgn: string, c: "white" | "black" = color) => {
    setPlayerColor(c);
    setKidMode(kidMode);
    startAnalysis(pgn);
    router.push("/analyze");
  };

  const doFetch = async () => {
    if (!effectiveUsername.trim()) { setError("Enter a username."); return; }
    setLoading(true); setError(""); setGames([]);
    try {
      const fn = platform === "lichess" ? fetchLichessGames : fetchChessdotcomGames;
      const { pgn } = await fn(effectiveUsername.trim());
      const list = splitPgn(pgn).map(parseGame);
      if (!list.length) throw new Error("No games found.");
      setGames(list); setSelectedIdx(0);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const readFile = (file: File) => {
    if (!file.name.endsWith(".pgn") && file.type !== "text/plain") {
      setError("Please upload a .pgn file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = e => { setPgnText(e.target?.result as string ?? ""); setTab("paste"); };
    reader.readAsText(file);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  }, []); // eslint-disable-line

  return (
    <div
      className="card"
      style={{ width: "100%", maxWidth: 440, margin: "0 auto", padding: 24, boxShadow: "var(--shadow-lg)" }}
    >
      {/* ── Tab bar ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 4, background: "var(--bg-elevated)", borderRadius: 10, padding: 4, marginBottom: 20 }}>
        {(["import", "paste", "upload"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setError(""); }}
            style={{
              flex: 1, padding: "7px 0", borderRadius: 7, fontSize: 12,
              fontWeight: tab === t ? 600 : 400,
              background: tab === t ? "var(--bg-surface)" : "transparent",
              color: tab === t ? "var(--text-primary)" : "var(--text-muted)",
              border: tab === t ? "1px solid var(--border-strong)" : "1px solid transparent",
              cursor: "pointer", transition: "all 0.15s", letterSpacing: "0.02em",
            }}
          >
            {{ import: "Import", paste: "PGN", upload: "Upload" }[t]}
          </button>
        ))}
      </div>

      {/* ── Import tab ──────────────────────────────────────────────── */}
      {tab === "import" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {(["lichess", "chessdotcom"] as Platform[]).map(p => (
              <button
                key={p}
                onClick={() => { setPlatform(p); setGames([]); setError(""); setUsername(""); setUsernameTouched(false); }}
                style={{
                  flex: 1, padding: "9px 12px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer",
                  transition: "all 0.15s",
                  background: platform === p ? "var(--gold-subtle)" : "var(--bg-elevated)",
                  color: platform === p ? "var(--gold-light)" : "var(--text-secondary)",
                  border: platform === p ? "1px solid var(--gold-border)" : "1px solid var(--border)",
                }}
              >
                {p === "lichess" ? "♞ Lichess" : "♟ Chess.com"}
              </button>
            ))}
          </div>

          <input
            style={inputBase}
            list="import-panel-saved-usernames"
            placeholder={platform === "lichess" ? "Lichess username" : "Chess.com username"}
            value={effectiveUsername}
            onChange={e => { setUsername(e.target.value); setUsernameTouched(true); }}
            onKeyDown={e => e.key === "Enter" && doFetch()}
            onFocus={e => {
              e.currentTarget.style.borderColor = "var(--gold-border)";
              e.currentTarget.style.boxShadow = "0 0 0 3px var(--gold-subtle)";
              setShowChips(true);
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = "var(--border-strong)";
              e.currentTarget.style.boxShadow = "none";
              setTimeout(() => setShowChips(false), 120);
            }}
          />
          {savedUsername && (
            <datalist id="import-panel-saved-usernames">
              <option value={savedUsername} />
            </datalist>
          )}
          {savedUsername && effectiveUsername === savedUsername && (
            <p style={{ color: "var(--text-muted)", fontSize: 11, margin: "-6px 0 0" }}>
              {"🔗 Using your linked "}{platform === "lichess" ? "Lichess" : "Chess.com"}{" username — "}
              <button
                type="button"
                onClick={() => { setUsername(""); setUsernameTouched(true); }}
                style={{ background: "none", border: "none", padding: 0, color: "var(--gold)", fontSize: 11, cursor: "pointer", textDecoration: "underline" }}
              >
                use a different one
              </button>
            </p>
          )}

          <button
            onClick={doFetch}
            disabled={loading}
            className="btn-gold"
            style={{ padding: "11px 0", fontSize: 14, borderRadius: 10, width: "100%" }}
          >
            {loading ? "Fetching…" : "Fetch Recent Games"}
          </button>

          {/* Output preview chips — appear on focus */}
          {showChips && !games.length && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {OUTPUT_CHIPS.map((chip, i) => (
                <span key={i} style={{
                  background: chip.bg, border: chip.border,
                  borderRadius: 20, padding: "3px 10px",
                  fontSize: 10, fontWeight: 700, color: chip.color,
                  letterSpacing: "0.04em",
                }}>{chip.label}</span>
              ))}
            </div>
          )}

          {error && <p style={{ color: "var(--clr-blunder)", fontSize: 12, margin: 0 }}>{error}</p>}

          {games.length > 0 && (
            <>
              {/* Game list cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
                {games.map((g, i) => {
                  const res = resultDisplay(g.result);
                  const isSelected = i === selectedIdx;
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedIdx(i)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "9px 12px", borderRadius: 9, textAlign: "left", cursor: "pointer",
                        background: isSelected ? "var(--gold-subtle)" : "var(--bg-elevated)",
                        border: `1px solid ${isSelected ? "var(--gold-border)" : "var(--border)"}`,
                        transition: "all 0.12s",
                      }}
                    >
                      {/* Result badge */}
                      <span style={{
                        flexShrink: 0, fontSize: 10, fontWeight: 700, padding: "2px 6px",
                        borderRadius: 4, background: res.bg, color: res.color,
                        fontFamily: "var(--font-mono)", minWidth: 28, textAlign: "center",
                      }}>
                        {res.label}
                      </span>

                      {/* Players */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12, fontWeight: 500, color: "var(--text-primary)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {g.white || "?"} vs {g.black || "?"}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                          {g.date}{g.timeControl ? ` · ${g.timeControl}` : ""}
                        </div>
                      </div>

                      {isSelected && (
                        <span style={{ flexShrink: 0, color: "var(--gold)", fontSize: 12 }}>✓</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <ColorPicker value={color} onChange={setColor} />
              <KidModeToggle value={kidMode} onChange={setKidModeLocal} />
              <button
                onClick={() => handleAnalyze(games[selectedIdx].pgn)}
                className="btn-gold"
                style={{ padding: "12px 0", fontSize: 14, borderRadius: 10, width: "100%" }}
              >
                Analyse Game →
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Paste / PGN tab ─────────────────────────────────────────── */}
      {tab === "paste" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            onClick={() => setPgnText(SAMPLE_PGN)}
            style={{ ...inputBase, padding: "9px 12px", textAlign: "left", cursor: "pointer", color: "var(--text-secondary)", fontSize: 13 }}
          >
            Try the Immortal Game (1851)
          </button>
          <textarea
            style={{ ...inputBase, padding: "11px 14px", fontSize: 12, resize: "none", height: 172, fontFamily: "var(--font-mono)", lineHeight: 1.5 }}
            placeholder={'[Event "..."]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 2. Nf3 ...'}
            value={pgnText}
            onChange={e => setPgnText(e.target.value)}
            onFocus={() => setShowChips(true)}
            onBlur={() => setTimeout(() => setShowChips(false), 120)}
          />
          {showChips && !pgnText.trim() && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {OUTPUT_CHIPS.map((chip, i) => (
                <span key={i} style={{
                  background: chip.bg, border: chip.border,
                  borderRadius: 20, padding: "3px 10px",
                  fontSize: 10, fontWeight: 700, color: chip.color,
                  letterSpacing: "0.04em",
                }}>{chip.label}</span>
              ))}
            </div>
          )}
          <ColorPicker value={color} onChange={setColor} />
          <KidModeToggle value={kidMode} onChange={setKidModeLocal} />
          <button
            onClick={() => pgnText.trim() && handleAnalyze(pgnText.trim())}
            disabled={!pgnText.trim()}
            className="btn-gold"
            style={{ padding: "12px 0", fontSize: 14, borderRadius: 10, width: "100%" }}
          >
            Analyse Game →
          </button>
        </div>
      )}

      {/* ── Upload tab ──────────────────────────────────────────────── */}
      {tab === "upload" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `1.5px dashed ${dragging ? "var(--gold)" : "var(--border-strong)"}`,
              background: dragging ? "var(--gold-subtle)" : "var(--bg-elevated)",
              borderRadius: 12, height: 152,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 8, cursor: "pointer", transition: "all 0.2s",
            }}
          >
            <span style={{ fontSize: 28, opacity: dragging ? 1 : 0.5 }}>♟</span>
            <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
              Drop a <span style={{ color: "var(--gold)" }}>.pgn file</span> or click to browse
            </span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pgn,.txt"
            style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); }}
          />
          {error && <p style={{ color: "var(--clr-blunder)", fontSize: 12, margin: 0 }}>{error}</p>}
        </div>
      )}
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: "white" | "black"; onChange: (c: "white" | "black") => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: "var(--text-muted)", fontSize: 12, flexShrink: 0 }}>I played as</span>
      {(["white", "black"] as const).map(c => (
        <button
          key={c}
          onClick={() => onChange(c)}
          style={{
            flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 13,
            fontWeight: value === c ? 600 : 400, cursor: "pointer", transition: "all 0.15s",
            background: value === c ? "var(--gold-subtle)" : "var(--bg-elevated)",
            color: value === c ? "var(--gold-light)" : "var(--text-secondary)",
            border: value === c ? "1px solid var(--gold-border)" : "1px solid var(--border)",
          }}
        >
          {c === "white" ? "♔ White" : "♚ Black"}
        </button>
      ))}
    </div>
  );
}

function KidModeToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        background: value ? "rgba(251,191,36,0.08)" : "var(--bg-elevated)",
        border: `1px solid ${value ? "rgba(251,191,36,0.3)" : "var(--border)"}`,
        color: value ? "#fbbf24" : "var(--text-muted)",
        borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 500,
        width: "100%", textAlign: "left", cursor: "pointer", transition: "all 0.2s",
      }}
    >
      {value ? "★ Kid Mode ON — Coach Spark report" : "Kid Mode · fun coaching for ages 7–14"}
    </button>
  );
}

"use client";
import { useState } from "react";
import { fetchLichessGames, fetchChessdotcomGames, splitPgn, pgnLabel } from "@/lib/api";

type Platform = "lichess" | "chessdotcom";
type Tab = "import" | "paste";

const inputBase: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-strong)",
  color: "var(--text-primary)",
  borderRadius: 10,
  padding: "11px 14px",
  fontSize: 14,
  width: "100%",
  outline: "none",
};

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

/** Mirrors ImportPanel.tsx's Import/Paste tabs and inputBase styling, but
 * with zero Zustand/router coupling — this just hands a raw PGN string up
 * to /coach's page, which steps through it client-side (GameStepper), not
 * the full Stockfish game-analysis pipeline /analyze uses. */
export function GameImportPanel({ onGameLoaded }: { onGameLoaded: (pgn: string) => void }) {
  const [tab, setTab]           = useState<Tab>("import");
  const [platform, setPlatform] = useState<Platform>("lichess");
  const [username, setUsername] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [games, setGames]       = useState<string[]>([]);
  const [pgnText, setPgnText]   = useState("");

  const doFetch = async () => {
    if (!username.trim()) { setError("Enter a username."); return; }
    setLoading(true); setError(""); setGames([]);
    try {
      const fn = platform === "lichess" ? fetchLichessGames : fetchChessdotcomGames;
      const { pgn } = await fn(username.trim());
      const list = splitPgn(pgn);
      if (!list.length) throw new Error("No games found.");
      setGames(list);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ width: "100%", maxWidth: 440, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", gap: 4, background: "var(--bg-elevated)", borderRadius: 10, padding: 4, marginBottom: 20 }}>
        {(["import", "paste"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setError(""); }}
            style={{
              flex: 1, padding: "7px 0", borderRadius: 7, fontSize: 12,
              fontWeight: tab === t ? 600 : 400,
              background: tab === t ? "var(--bg-surface)" : "transparent",
              color: tab === t ? "var(--text-primary)" : "var(--text-muted)",
              border: tab === t ? "1px solid var(--border-strong)" : "1px solid transparent",
              cursor: "pointer",
            }}
          >
            {t === "import" ? "Import" : "Paste PGN"}
          </button>
        ))}
      </div>

      {tab === "import" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {(["lichess", "chessdotcom"] as Platform[]).map(p => (
              <button
                key={p}
                onClick={() => { setPlatform(p); setGames([]); setError(""); }}
                style={{
                  flex: 1, padding: "9px 12px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer",
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
            placeholder={platform === "lichess" ? "Lichess username" : "Chess.com username"}
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === "Enter" && doFetch()}
          />

          <button
            onClick={doFetch}
            disabled={loading}
            className="btn-gold"
            style={{ padding: "11px 0", fontSize: 14, borderRadius: 10, width: "100%" }}
          >
            {loading ? "Fetching…" : "Fetch Recent Games"}
          </button>

          {error && <p style={{ color: "var(--clr-blunder)", fontSize: 12, margin: 0 }}>{error}</p>}

          {games.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
              {games.map((pgn, i) => (
                <button
                  key={i}
                  onClick={() => onGameLoaded(pgn)}
                  style={{
                    padding: "9px 12px", borderRadius: 9, textAlign: "left", cursor: "pointer",
                    background: "var(--bg-elevated)", border: "1px solid var(--border)",
                    fontSize: 12.5, color: "var(--text-primary)",
                  }}
                >
                  {pgnLabel(pgn, i)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "paste" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            onClick={() => setPgnText(SAMPLE_PGN)}
            style={{ ...inputBase, padding: "9px 12px", textAlign: "left", cursor: "pointer", color: "var(--text-secondary)", fontSize: 13 }}
          >
            Try the Immortal Game (1851)
          </button>
          <textarea
            style={{ ...inputBase, fontSize: 12, resize: "none", height: 172, fontFamily: "var(--font-mono)", lineHeight: 1.5 }}
            placeholder={'[Event "..."]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 2. Nf3 ...'}
            value={pgnText}
            onChange={e => setPgnText(e.target.value)}
          />
          <button
            onClick={() => pgnText.trim() && onGameLoaded(pgnText.trim())}
            disabled={!pgnText.trim()}
            className="btn-gold"
            style={{ padding: "12px 0", fontSize: 14, borderRadius: 10, width: "100%" }}
          >
            Step Through This Game →
          </button>
        </div>
      )}
    </div>
  );
}

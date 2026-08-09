"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Navbar } from "@/components/Navbar";
import {
  getDashboardSummary, getAnalyzedGames, getSavedProfiles,
  deleteAnalyzedGame, deleteSavedProfile,
  type DashboardSummary, type SavedGameSummary, type SavedProfileSummary,
} from "@/lib/api";

function resultColor(result: string | null): string {
  if (result === "1-0" || result === "0-1") return "var(--clr-best)";
  if (result === "1/2-1/2") return "var(--text-muted)";
  return "var(--text-muted)";
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function StatCard({ icon, value, label, accent }: { icon: string; value: string | number; label: string; accent: string }) {
  return (
    <div className="card" style={{ padding: "16px 18px", flex: "1 1 140px", display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ fontSize: 22, color: accent, flexShrink: 0 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text-primary)", fontFamily: "var(--font-display)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {value}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 3 }}>
          {label}
        </div>
      </div>
    </div>
  );
}

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  return (
    <button
      onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
      title="Remove from history"
      style={{
        position: "absolute", top: 8, right: 8,
        width: 22, height: 22, borderRadius: 6,
        background: "var(--bg-elevated)", border: "1px solid var(--border)",
        color: "var(--text-muted)", fontSize: 12, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: 0, transition: "opacity 0.15s",
      }}
      className="dashboard-card-delete"
    >
      ✕
    </button>
  );
}

function GameCard({ game, onDelete }: { game: SavedGameSummary; onDelete: () => void }) {
  return (
    <Link
      href={`/analyze?gameId=${game.id}`}
      className="card card-hover dashboard-card"
      style={{ position: "relative", padding: "14px 16px", textDecoration: "none", display: "block" }}
    >
      <DeleteButton onDelete={onDelete} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, paddingRight: 22 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {game.white || "?"} vs {game.black || "?"}
        </span>
        {game.result && (
          <span style={{ fontSize: 10, fontWeight: 700, color: resultColor(game.result), fontFamily: "var(--font-mono)", flexShrink: 0 }}>
            {game.result}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11, color: "var(--text-muted)" }}>
        {game.opening_name && <span>{game.opening_name}</span>}
        {game.opening_name && <span style={{ opacity: 0.4 }}>·</span>}
        <span>{fmtDate(game.created_at)}</span>
        {game.estimated_elo != null && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>~{game.estimated_elo} Elo</span>
          </>
        )}
      </div>
      {(game.accuracy_white != null || game.accuracy_black != null) && (
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          {game.accuracy_white != null && (
            <span style={{ fontSize: 11, color: "var(--accent-blue)", fontWeight: 700 }}>
              W {game.accuracy_white.toFixed(1)}%
            </span>
          )}
          {game.accuracy_black != null && (
            <span style={{ fontSize: 11, color: "var(--gold)", fontWeight: 700 }}>
              B {game.accuracy_black.toFixed(1)}%
            </span>
          )}
        </div>
      )}
    </Link>
  );
}

function ProfileCard({ profile, onDelete }: { profile: SavedProfileSummary; onDelete: () => void }) {
  const platformIcon = profile.provider === "lichess" ? "♞" : profile.provider === "chesscom" ? "♟" : "📄";
  const platformLabel = profile.provider === "lichess" ? "Lichess" : profile.provider === "chesscom" ? "Chess.com" : "Pasted PGN";
  return (
    <Link
      href={`/profile?profileId=${profile.id}`}
      className="card card-hover dashboard-card"
      style={{ position: "relative", padding: "14px 16px", textDecoration: "none", display: "block" }}
    >
      <DeleteButton onDelete={onDelete} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, paddingRight: 22 }}>
        <span style={{ fontSize: 15 }}>{platformIcon}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
          {profile.username || profile.player_name}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-muted)" }}>
        <span>{platformLabel}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>{profile.games_count} games</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>{fmtDate(profile.created_at)}</span>
      </div>
    </Link>
  );
}

function SectionEmpty({ icon, text, cta, href }: { icon: string; text: string; cta: string; href: string }) {
  return (
    <div className="card" style={{ padding: "28px 20px", textAlign: "center" }}>
      <div style={{ fontSize: 24, opacity: 0.5, marginBottom: 8 }}>{icon}</div>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 14 }}>{text}</p>
      <Link href={href} className="btn-gold" style={{ display: "inline-block", padding: "8px 18px", borderRadius: 8, fontSize: 12.5, textDecoration: "none" }}>
        {cta}
      </Link>
    </div>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [games, setGames] = useState<SavedGameSummary[] | null>(null);
  const [profiles, setProfiles] = useState<SavedProfileSummary[] | null>(null);
  const [loadError, setLoadError] = useState("");

  const refresh = useCallback(() => {
    getDashboardSummary().then(setSummary).catch(() => {});
    getAnalyzedGames(12).then(r => setGames(r.games)).catch(() => setLoadError("Couldn't load your history — try refreshing."));
    getSavedProfiles(12).then(r => setProfiles(r.profiles)).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleDeleteGame(id: number) {
    setGames(g => g?.filter(x => x.id !== id) ?? null);
    try { await deleteAnalyzedGame(id); } catch { refresh(); }
  }

  async function handleDeleteProfile(id: number) {
    setProfiles(p => p?.filter(x => x.id !== id) ?? null);
    try { await deleteSavedProfile(id); } catch { refresh(); }
  }

  return (
    <>
      <Navbar />
      <main style={{ background: "var(--bg-base)", minHeight: "100vh" }} className="px-6 py-8 max-w-[1200px] mx-auto">
        <div style={{ marginBottom: 28 }}>
          <p style={{ color: "var(--gold)", fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>
            Dashboard
          </p>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(26px, 3.5vw, 38px)", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
            Welcome back{session?.user?.name ? `, ${session.user.name.split(" ")[0]}` : ""}.
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 13.5, marginTop: 6 }}>
            Every game and profile you&apos;ve built, saved and ready to revisit instantly — no recomputing.
          </p>
        </div>

        {/* Summary stats */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 32 }}>
          <StatCard icon="◈" value={summary?.games_analyzed ?? "—"} label="Games Analyzed" accent="var(--accent-blue)" />
          <StatCard icon="◉" value={summary?.profiles_built ?? "—"} label="Profiles Built" accent="var(--gold)" />
          <StatCard icon="✓" value={summary?.puzzles_solved ?? "—"} label="Puzzles Solved" accent="var(--clr-best)" />
          <StatCard icon="🔥" value={summary?.best_streak ?? "—"} label="Best Streak" accent="var(--clr-mistake)" />
        </div>

        {summary?.top_mistake_theme && (
          <div
            style={{
              display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 32,
              background: "rgba(224,82,82,0.08)", border: "1px solid rgba(224,82,82,0.22)",
              borderRadius: 10, padding: "8px 14px",
            }}
          >
            <span style={{ fontSize: 14 }}>🧬</span>
            <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
              Your most costly recurring pattern is <strong style={{ color: "var(--clr-mistake)" }}>{summary.top_mistake_theme}</strong> —{" "}
              <Link href="/puzzles" style={{ color: "var(--gold)" }}>drill it in Puzzles →</Link>
            </span>
          </div>
        )}

        {loadError && (
          <p style={{ color: "var(--clr-blunder)", fontSize: 12.5, marginBottom: 20 }}>{loadError}</p>
        )}

        {/* Recently analyzed games */}
        <section style={{ marginBottom: 36 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Recently Analyzed Games</h2>
            <button
              onClick={() => router.push("/analyze")}
              style={{ background: "none", border: "none", color: "var(--gold)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
            >
              + New Game
            </button>
          </div>
          {games === null ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
          ) : games.length === 0 ? (
            <SectionEmpty icon="◈" text="No games analyzed yet." cta="Analyze your first game →" href="/analyze" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {games.map(g => <GameCard key={g.id} game={g} onDelete={() => handleDeleteGame(g.id)} />)}
            </div>
          )}
        </section>

        {/* Saved player profiles */}
        <section style={{ marginBottom: 36 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Your Player Profiles</h2>
            <button
              onClick={() => router.push("/profile")}
              style={{ background: "none", border: "none", color: "var(--gold)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
            >
              + Build Profile
            </button>
          </div>
          {profiles === null ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
          ) : profiles.length === 0 ? (
            <SectionEmpty icon="◉" text="No player profiles built yet." cta="Build your first profile →" href="/profile" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {profiles.map(p => <ProfileCard key={p.id} profile={p} onDelete={() => handleDeleteProfile(p.id)} />)}
            </div>
          )}
        </section>

        {/* Puzzle progress */}
        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Puzzle Progress</h2>
            <Link href="/puzzles" style={{ color: "var(--gold)", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
              Go practice →
            </Link>
          </div>
          <div className="card" style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 22 }}>🧩</span>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {summary && summary.puzzles_solved > 0 ? (
                <>You&apos;ve solved <strong style={{ color: "var(--text-primary)" }}>{summary.puzzles_solved}</strong> puzzle{summary.puzzles_solved === 1 ? "" : "s"} from your own games, with a best streak of <strong style={{ color: "var(--text-primary)" }}>{summary.best_streak}</strong>.</>
              ) : (
                <>No puzzles solved yet — they&apos;re generated automatically from mistakes in your analyzed games.</>
              )}
            </div>
          </div>
        </section>
      </main>

      <style dangerouslySetInnerHTML={{ __html: ".dashboard-card:hover .dashboard-card-delete { opacity: 1; } .dashboard-card-delete:hover { color: var(--clr-blunder); border-color: rgba(224,82,82,0.35); }" }} />
    </>
  );
}

"use client";
import { useEffect, useState } from "react";
import {
  getAdminOverview, getAdminFeedback, getAdminPageviews, getAdminUsers,
  type AdminOverview, type AdminFeedbackItem, type AdminPageviews, type AdminUser,
} from "@/lib/api";

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

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
      {title}
    </h2>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>No rating</span>;
  return (
    <span style={{ color: "var(--gold)", fontSize: 13, letterSpacing: 1 }}>
      {"★".repeat(rating)}
      <span style={{ color: "var(--border-strong)" }}>{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function FeedbackSection() {
  const [items, setItems] = useState<AdminFeedbackItem[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getAdminFeedback().then(r => setItems(r.feedback)).catch(e => setError(e.message));
  }, []);

  return (
    <section style={{ marginBottom: 36 }}>
      <SectionHeader title={`Feedback${items ? ` (${items.length})` : ""}`} />
      {error && <p style={{ color: "var(--clr-mistake)", fontSize: 13 }}>{error}</p>}
      {!items && !error && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</p>}
      {items && items.length === 0 && (
        <div className="card" style={{ padding: "24px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
          No feedback submitted yet.
        </div>
      )}
      {items && items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map(f => (
            <div key={f.id} className="card" style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                <Stars rating={f.rating} />
                <span style={{ color: "var(--text-muted)", fontSize: 11.5 }}>{relativeTime(f.created_at)}</span>
              </div>
              <p style={{ color: "var(--text-primary)", fontSize: 13.5, lineHeight: 1.55, marginBottom: 8 }}>{f.message}</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: "var(--text-muted)" }}>
                {f.page_path && <span>{f.page_path}</span>}
                {f.email && (
                  <>
                    <span style={{ opacity: 0.4 }}>·</span>
                    <span>{f.email}</span>
                  </>
                )}
                {!f.email && !f.user_id && (
                  <>
                    <span style={{ opacity: 0.4 }}>·</span>
                    <span>anonymous</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function UsersSection() {
  const [data, setData] = useState<{ total: number; users: AdminUser[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getAdminUsers().then(setData).catch(e => setError(e.message));
  }, []);

  return (
    <section style={{ marginBottom: 36 }}>
      <SectionHeader title={`Users${data ? ` (${data.total})` : ""}`} />
      {error && <p style={{ color: "var(--clr-mistake)", fontSize: 13 }}>{error}</p>}
      {!data && !error && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</p>}
      {data && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ maxHeight: 480, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--bg-elevated)", position: "sticky", top: 0 }}>
                  {["Name", "Username", "Email", "Sign-in", "Linked accounts", "Joined"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 14px", fontSize: 10.5, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.users.map(u => (
                  <tr key={u.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "9px 14px", color: "var(--text-primary)" }}>{u.name ?? "—"}</td>
                    <td style={{ padding: "9px 14px", color: "var(--text-secondary)" }}>{u.username ?? "—"}</td>
                    <td style={{ padding: "9px 14px", color: "var(--text-secondary)" }}>{u.email ?? "—"}</td>
                    <td style={{ padding: "9px 14px", color: "var(--text-muted)" }}>{u.sign_in_method}</td>
                    <td style={{ padding: "9px 14px", color: "var(--text-muted)", fontSize: 12 }}>
                      {[u.lichess_username && `Lichess: ${u.lichess_username}`, u.chesscom_username && `Chess.com: ${u.chesscom_username}`]
                        .filter(Boolean).join(", ") || "—"}
                    </td>
                    <td style={{ padding: "9px 14px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{relativeTime(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function PageviewsSection() {
  const [data, setData] = useState<AdminPageviews | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getAdminPageviews().then(setData).catch(e => setError(e.message));
  }, []);

  const maxDaily = data ? Math.max(1, ...data.daily.map(d => d.views)) : 1;

  return (
    <section style={{ marginBottom: 36 }}>
      <SectionHeader title="Site visits" />
      {error && <p style={{ color: "var(--clr-mistake)", fontSize: 13 }}>{error}</p>}
      {!data && !error && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</p>}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card" style={{ padding: "16px 18px" }}>
            <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
              Last 14 days
            </p>
            {data.daily.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No visits recorded yet.</p>
            ) : (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 90 }}>
                {data.daily.map(d => (
                  <div key={d.day} title={`${d.day}: ${d.views} views`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
                    <div
                      style={{
                        width: "100%", minHeight: 2,
                        height: `${(d.views / maxDaily) * 100}%`,
                        background: "linear-gradient(180deg, var(--gold), var(--accent-blue))",
                        borderRadius: "3px 3px 0 0",
                      }}
                    />
                    <span style={{ fontSize: 8.5, color: "var(--text-muted)" }}>{d.day.slice(5)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: "16px 18px" }}>
            <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
              Top pages (30 days)
            </p>
            {data.top_paths.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No visits recorded yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.top_paths.map(p => (
                  <div key={p.path} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.path}</span>
                    <span style={{ color: "var(--text-primary)", fontWeight: 700, fontVariantNumeric: "tabular-nums", flexShrink: 0, marginLeft: 12 }}>{p.views}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function AdminDashboard() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getAdminOverview().then(setOverview).catch(e => setError(e.message));
  }, []);

  return (
    <main style={{ background: "var(--bg-base)" }} className="min-h-screen px-6 py-8">
      <div className="max-w-[1200px] mx-auto">
        <div style={{ marginBottom: 28 }}>
          <p style={{ color: "var(--gold)", fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6 }}>
            Admin
          </p>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(26px, 3.5vw, 38px)", fontWeight: 700, color: "var(--text-primary)" }}>
            Site overview
          </h1>
        </div>

        {error && <p style={{ color: "var(--clr-mistake)", fontSize: 13, marginBottom: 16 }}>{error}</p>}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 36 }}>
          <StatCard icon="◈" value={overview?.games_analyzed ?? "—"} label="Games Analyzed" accent="var(--accent-blue)" />
          <StatCard icon="◉" value={overview?.profiles_generated ?? "—"} label="Profiles Built" accent="var(--gold)" />
          <StatCard icon="✓" value={overview?.puzzles_solved ?? "—"} label="Puzzles Solved" accent="var(--clr-best)" />
          <StatCard icon="💬" value={overview?.feedback_count ?? "—"} label="Feedback" accent="var(--accent-purple)" />
          <StatCard
            icon="★"
            value={overview?.feedback_avg_rating != null ? overview.feedback_avg_rating.toFixed(1) : "—"}
            label="Avg. Rating"
            accent="var(--accent-amber)"
          />
          <StatCard icon="👁" value={overview?.pageviews_today ?? "—"} label="Views Today" accent="var(--accent-green)" />
          <StatCard icon="📈" value={overview?.pageviews_7d ?? "—"} label="Views (7d)" accent="var(--accent-pink)" />
          <StatCard icon="Σ" value={overview?.pageviews_total ?? "—"} label="Views (All time)" accent="var(--text-muted)" />
        </div>

        <PageviewsSection />
        <FeedbackSection />
        <UsersSection />
      </div>
    </main>
  );
}

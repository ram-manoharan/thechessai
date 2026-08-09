"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { getMe, linkChessUsername } from "@/lib/api";

const DISMISS_KEY_PREFIX = "chessai_onboarding_dismissed_";

const inputStyle: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-strong)",
  color: "var(--text-primary)",
  borderRadius: 10,
  padding: "11px 14px",
  fontSize: 14,
  width: "100%",
  outline: "none",
};

/** Shown once for a signed-in user who has never linked a Lichess or
 * Chess.com username — prompts them (optionally) so the Analyze and Profile
 * flows can prefill/suggest it instead of asking every time. Dismissal is
 * remembered per-user in localStorage; linking successfully also permanently
 * suppresses it (checked via the same getMe() call next time). */
export function OnboardingPrompt() {
  const { data: session, status } = useSession();
  const identity = session?.user?.email ?? session?.user?.name ?? null;

  const [show, setShow] = useState(false);
  const [lichess, setLichess] = useState("");
  const [chesscom, setChesscom] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status !== "authenticated" || !identity) return;
    const dismissKey = DISMISS_KEY_PREFIX + identity;
    if (localStorage.getItem(dismissKey)) return;

    let cancelled = false;
    getMe()
      .then(me => {
        if (cancelled) return;
        if (!me.lichess_username && !me.chesscom_username) {
          setShow(true);
        } else {
          localStorage.setItem(dismissKey, "1");
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [status, identity]);

  function dismiss() {
    if (identity) localStorage.setItem(DISMISS_KEY_PREFIX + identity, "1");
    setShow(false);
  }

  async function handleSave() {
    if (!lichess.trim() && !chesscom.trim()) { dismiss(); return; }
    setSaving(true);
    setError("");
    try {
      await linkChessUsername({
        lichess_username: lichess.trim() || undefined,
        chesscom_username: chesscom.trim() || undefined,
      });
      dismiss();
    } catch (e) {
      setError((e as Error).message || "Couldn't verify that username — check the spelling and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!show) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onClick={e => e.target === e.currentTarget && dismiss()}
    >
      <div className="card" style={{ maxWidth: 420, width: "100%", padding: 28 }}>
        <div style={{ fontSize: 26, marginBottom: 10 }}>♟</div>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 22, color: "var(--text-primary)", marginBottom: 8 }}>
          One quick thing.
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 13.5, lineHeight: 1.65, marginBottom: 20 }}>
          Link your Chess.com and/or Lichess username — optional, but it saves you retyping it every
          time you import a game or build your player profile. You can always add or change this later
          from your profile.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          <input
            style={inputStyle}
            placeholder="Lichess username (optional)"
            value={lichess}
            onChange={e => setLichess(e.target.value)}
          />
          <input
            style={inputStyle}
            placeholder="Chess.com username (optional)"
            value={chesscom}
            onChange={e => setChesscom(e.target.value)}
          />
        </div>

        {error && (
          <p style={{ color: "var(--clr-blunder)", fontSize: 12.5, marginBottom: 14 }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={dismiss}
            disabled={saving}
            style={{
              flex: 1, padding: "11px 0", borderRadius: 10,
              background: "var(--bg-elevated)", border: "1px solid var(--border-strong)",
              color: "var(--text-secondary)", fontSize: 13.5, fontWeight: 600, cursor: "pointer",
            }}
          >
            Skip for now
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-gold"
            style={{ flex: 1, padding: "11px 0", borderRadius: 10, fontSize: 13.5 }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

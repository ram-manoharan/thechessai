"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { submitFeedback } from "@/lib/api";

const STARS = [1, 2, 3, 4, 5];

/** Site-wide floating feedback button + modal, mounted once in the root
 * layout so it's available on every page. Works signed-in or anonymous —
 * the backend attaches user identity server-side when a session exists.
 * Bottom-left, since the analyze page already has a toast at bottom-right
 * (see app/analyze/page.tsx) and this needs to coexist with it. */
export function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  function openModal() {
    setRating(null);
    setHoverRating(null);
    setMessage("");
    setError("");
    setSent(false);
    setOpen(true);
  }

  async function handleSubmit() {
    if (!message.trim()) {
      setError("Tell us a bit about what happened — even a sentence helps.");
      return;
    }
    setSending(true);
    setError("");
    try {
      await submitFeedback({
        message: message.trim(),
        rating: rating ?? undefined,
        page_path: pathname || undefined,
      });
      setSent(true);
      setTimeout(() => setOpen(false), 1600);
    } catch (e) {
      setError((e as Error).message || "Couldn't send that — try again in a moment.");
    } finally {
      setSending(false);
    }
  }

  const shownRating = hoverRating ?? rating;

  return (
    <>
      <button
        onClick={openModal}
        aria-label="Send feedback"
        style={{
          position: "fixed", bottom: 24, left: 24, zIndex: 9200,
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--bg-surface)", border: "1px solid var(--border-strong)",
          color: "var(--text-secondary)", borderRadius: 999,
          padding: "10px 16px", fontSize: 13, fontWeight: 600,
          boxShadow: "var(--shadow-lg)", cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 15 }}>💬</span> Feedback
      </button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9300,
            background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
          onClick={e => e.target === e.currentTarget && !sending && setOpen(false)}
        >
          <div className="card" style={{ maxWidth: 420, width: "100%", padding: 28 }}>
            {sent ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: 30, marginBottom: 10 }}>♟</div>
                <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 20, color: "var(--text-primary)" }}>
                  Thanks — got it.
                </h2>
                <p style={{ color: "var(--text-secondary)", fontSize: 13.5, marginTop: 6 }}>
                  This genuinely shapes what we build next.
                </p>
              </div>
            ) : (
              <>
                <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 22, color: "var(--text-primary)", marginBottom: 8 }}>
                  Got a thought?
                </h2>
                <p style={{ color: "var(--text-secondary)", fontSize: 13.5, lineHeight: 1.65, marginBottom: 20 }}>
                  Bug, confusing moment, feature you wish existed — tell us. We read every one of these.
                </p>

                <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                  {STARS.map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRating(n === rating ? null : n)}
                      onMouseEnter={() => setHoverRating(n)}
                      onMouseLeave={() => setHoverRating(null)}
                      aria-label={`Rate ${n} out of 5`}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        fontSize: 24, lineHeight: 1, padding: 2,
                        color: shownRating !== null && n <= shownRating ? "var(--gold)" : "var(--border-strong)",
                        transition: "color 0.12s ease",
                      }}
                    >
                      ★
                    </button>
                  ))}
                </div>

                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="What's on your mind?"
                  rows={4}
                  style={{
                    background: "var(--bg-elevated)", border: "1px solid var(--border-strong)",
                    color: "var(--text-primary)", borderRadius: 10, padding: "11px 14px",
                    fontSize: 14, width: "100%", outline: "none", resize: "vertical",
                    fontFamily: "inherit", marginBottom: 12,
                  }}
                />

                {error && (
                  <p style={{ color: "var(--clr-blunder)", fontSize: 12.5, marginBottom: 14 }}>{error}</p>
                )}

                <p style={{ color: "var(--text-muted)", fontSize: 11.5, marginBottom: 16 }}>
                  Prefer email? Write to{" "}
                  <a href="mailto:feedback@thechess.ai" style={{ color: "var(--text-muted)", textDecoration: "underline" }}>
                    feedback@thechess.ai
                  </a>.
                </p>

                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={() => setOpen(false)}
                    disabled={sending}
                    style={{
                      flex: 1, padding: "11px 0", borderRadius: 10,
                      background: "var(--bg-elevated)", border: "1px solid var(--border-strong)",
                      color: "var(--text-secondary)", fontSize: 13.5, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={sending}
                    className="btn-gold"
                    style={{ flex: 1, padding: "11px 0", borderRadius: 10, fontSize: 13.5 }}
                  >
                    {sending ? "Sending…" : "Send feedback"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

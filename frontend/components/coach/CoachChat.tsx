"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/api";

/** Presentational chat panel — history/loading state live in app/coach/page.tsx
 * (so switching to a new position can reset it cleanly), this just renders
 * it and reports sends upward. Bubble styling matches GameStudy.tsx's
 * existing position-chat convention. */
export function CoachChat({
  messages, loading, onSend,
}: {
  messages: ChatMessage[];
  loading: boolean;
  onSend: (text: string) => void;
}) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const send = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    onSend(text);
  };

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 380 }}>
      <p style={{ color: "var(--gold)", fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>
        Ask the coach
      </p>

      <div ref={listRef} style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, overflowY: "auto", minHeight: 220 }}>
        {messages.length === 0 && !loading && (
          <p style={{ color: "var(--text-muted)", fontSize: 12.5, fontStyle: "italic" }}>
            Ask anything — &ldquo;what&apos;s the best move here?&rdquo;, &ldquo;what if I play Nf3?&rdquo;, &ldquo;what&apos;s White&apos;s plan?&rdquo;
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "88%",
              background: m.role === "user" ? "var(--gold-subtle)" : "var(--bg-elevated)",
              border: `1px solid ${m.role === "user" ? "var(--gold-border)" : "var(--border)"}`,
              borderRadius: 10,
              padding: "9px 13px",
              fontSize: 13,
              color: "var(--text-secondary)",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
            }}
          >
            {m.content}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: "flex-start", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
            Thinking…
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") send(); }}
          placeholder="Ask about this position…"
          disabled={loading}
          style={{
            flex: 1, background: "var(--bg-elevated)", border: "1px solid var(--border-strong)",
            color: "var(--text-primary)", borderRadius: 8, padding: "9px 13px", fontSize: 13,
          }}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="btn-gold"
          style={{ padding: "9px 16px", fontSize: 13, borderRadius: 8, opacity: (loading || !input.trim()) ? 0.5 : 1 }}
        >
          Ask
        </button>
      </div>
    </div>
  );
}

"use client";
import { useGameStore } from "@/lib/store";

export function KidMoveCard() {
  const kidMode        = useGameStore(s => s.kidMode);
  const currentIdx     = useGameStore(s => s.currentIdx);
  const commentaries   = useGameStore(s => s.kidCommentaries);

  if (!kidMode || currentIdx < 0) return null;
  const card = commentaries[currentIdx];
  if (!card) return null;

  const isMistake = card.kind === "mistake";

  const accentColor = isMistake ? "var(--clr-mistake)" : "var(--clr-best)";
  const bgColor     = isMistake ? "rgba(255,150,0,0.07)" : "rgba(34,197,94,0.07)";
  const borderColor = isMistake ? "rgba(255,150,0,0.3)"  : "rgba(34,197,94,0.25)";

  return (
    <div
      className="animate-fade-in"
      style={{
        background:   bgColor,
        border:       `1px solid ${borderColor}`,
        borderRadius: 14,
        padding:      "16px 18px",
        position:     "relative",
        overflow:     "hidden",
      }}
    >
      {/* Coach Spark label */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 22 }}>{card.emoji}</span>
        <div>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.12em",
            textTransform: "uppercase", color: accentColor,
          }}>
            Coach Spark
          </span>
          <p style={{
            color: "var(--text-primary)", fontWeight: 700, fontSize: 15, lineHeight: 1.25,
            marginTop: 1,
          }}>
            {card.headline}
          </p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* What happened */}
        <Row icon="🔍" label="What happened" text={card.what} />

        {/* Why it matters */}
        <Row icon="💡" label="Why it hurts" text={card.why} />

        {/* Better move — mistakes only */}
        {isMistake && card.better && (
          <Row icon="✅" label="Better move" text={card.better} highlight />
        )}

        {/* What's next */}
        {card.followup && (
          <Row icon="⚡" label="What's next" text={card.followup} />
        )}
      </div>
    </div>
  );
}

function Row({
  icon, label, text, highlight = false,
}: {
  icon: string; label: string; text: string; highlight?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div>
        <span style={{
          display: "block", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
          textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 2,
        }}>
          {label}
        </span>
        <span style={{
          color: highlight ? "var(--accent-green)" : "var(--text-secondary)",
          fontSize: 13, lineHeight: 1.5,
          fontWeight: highlight ? 600 : 400,
        }}>
          {text}
        </span>
      </div>
    </div>
  );
}

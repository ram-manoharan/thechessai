"use client";
import React, { useState, useRef, useCallback, useEffect, useMemo, Suspense } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Chess } from "chess.js";
import type { PieceDropHandlerArgs } from "react-chessboard";
import { Navbar } from "@/components/Navbar";
import { useCurrentTheme } from "@/lib/theme";
import {
  fetchLichessGames, fetchChessdotcomGames, fetchLichessRatingHistory,
  streamProfile, getMe, linkChessUsername, saveProfile, getSavedProfile,
  type ProfileStats, type RatingHistoryEntry, type Me,
} from "@/lib/api";

const ProfileChessboard = dynamic(
  () => import("react-chessboard").then(m => m.Chessboard),
  { ssr: false, loading: () => <div style={{ aspectRatio: "1/1", background: "var(--bg-elevated)", borderRadius: 8 }} /> }
);

type Platform   = "lichess" | "chessdotcom";
type Phase      = "idle" | "fetching" | "analyzing" | "done" | "error";
type SidebarSection = "summary" | "skills" | "openings" | "middlegame" | "endgame" | "psychology" | "blunders" | "coach";
type InputMode  = "platform" | "pgn";

const PHASE_LABELS: Record<string, string> = {
  "Opening (moves 1-15)":     "Opening",
  "Middlegame (moves 16-35)": "Middlegame",
  "Endgame (moves 36+)":      "Endgame",
};

const STAGGER = ["0s","0.06s","0.12s","0.18s","0.24s","0.30s","0.36s","0.42s"];

// ── Style fingerprint ─────────────────────────────────────────────────────────

function deriveStyleTag(s: ProfileStats): { tag: string; sub: string; color: string; bg: string; border: string; icon: string } {
  if (s.precision_rate > 65 && s.avg_cp_loss < 25)
    return { tag: "Precision Machine",    sub: "Consistently clean, low error rate across all phases",       color: "var(--clr-best)",    bg: "var(--tint-green)", border: "var(--border-green)", icon: "◎" };
  if (s.winning_error_rate > 25)
    return { tag: "Clutch Challenger",    sub: "Strong play that breaks down converting winning positions",   color: "var(--clr-mistake)", bg: "var(--tint-gold)",  border: "var(--border-gold)",  icon: "△" };
  if (s.weakest_phase.includes("Endgame"))
    return { tag: "Opening Specialist",   sub: "Sharp preparation, endgame technique needs focused study",   color: "var(--gold)",        bg: "var(--tint-gold)",  border: "var(--border-gold)",  icon: "◈" };
  if (s.weakest_phase.includes("Opening"))
    return { tag: "Endgame Grinder",      sub: "Long-game technique is a strength, opening prep to build",  color: "var(--accent-blue)", bg: "var(--tint-blue)",  border: "var(--border-blue)",  icon: "◉" };
  if ((s.white_score_pct ?? 0) > (s.black_score_pct ?? 0) + 12)
    return { tag: "White Specialist",     sub: "Dominant with initiative, inconsistent with Black",          color: "var(--gold)",        bg: "var(--tint-gold)",  border: "var(--border-gold)",  icon: "◆" };
  if (s.win_rate > 55)
    return { tag: "Solid Performer",      sub: "Consistent and reliable across openings and time controls",  color: "var(--clr-best)",   bg: "var(--tint-green)", border: "var(--border-green)", icon: "✓" };
  return   { tag: "Developing Tactician", sub: "Building pattern recognition, calculation and endgame skills", color: "var(--accent-blue)", bg: "var(--tint-blue)", border: "var(--border-blue)",  icon: "✦" };
}

// ── Shared 4-tier score coloring (Exceptional/Excellent/Needs Work/Urgent) ─────

function tierColor(score: number): { label: string; color: string; bg: string; border: string } {
  if (score >= 80) return { label: "Exceptional", color: "var(--clr-best)",    bg: "var(--tint-green)", border: "var(--border-green)" };
  if (score >= 60) return { label: "Excellent",    color: "var(--accent-blue)", bg: "var(--tint-blue)",  border: "var(--border-blue)" };
  if (score >= 40) return { label: "Needs Work",   color: "var(--accent-amber)", bg: "var(--tint-gold)", border: "var(--border-gold)" };
  return            { label: "Urgent",             color: "var(--clr-blunder)", bg: "var(--tint-red)",   border: "var(--border-red)" };
}

// ── Performance Radar ─────────────────────────────────────────────────────────

function PerfRadar({ stats }: { stats: ProfileStats }) {
  const openingScore = stats.top_openings.length > 0
    ? (() => {
        const scored = stats.top_openings.slice(0, 5).map(([, d]) => {
          const w = d.wins ?? 0, dr = d.draws ?? 0;
          return d.count > 0 ? ((w + dr * 0.5) / d.count) * 100 : 50;
        });
        return scored.reduce((a, b) => a + b, 0) / scored.length;
      })()
    : 50;

  const axes = [
    { label: "Win Rate",    value: Math.min(stats.win_rate * 1.4, 100) },
    { label: "Precision",   value: Math.min(stats.precision_rate, 100) },
    { label: "Opening",     value: Math.min(openingScore, 100) },
    { label: "Endgame",     value: Math.max(0, 100 - (stats.phase_error_rate["Endgame (moves 36+)"] ?? 0.2) * 300) },
    { label: "Endurance",   value: Math.max(0, 100 - stats.winning_error_rate * 2) },
    { label: "Consistency", value: Math.min(stats.clean_game_rate * 1.4, 100) },
  ];

  const n = axes.length;
  const cx = 90, cy = 90, R = 65;
  const angle = (i: number) => ((i / n) * 2 * Math.PI) - Math.PI / 2;
  const pt = (i: number, r: number) => ({
    x: cx + r * Math.cos(angle(i)),
    y: cy + r * Math.sin(angle(i)),
  });
  const polyPts = (r: number) => axes.map((_, i) => `${pt(i, r).x.toFixed(1)},${pt(i, r).y.toFixed(1)}`).join(" ");
  const valuePts = axes.map((a, i) => {
    const p = pt(i, (a.value / 100) * R);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(" ");

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <p style={{ color: "var(--text-muted)", fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>Performance Radar</p>
      <svg width="180" height="180" viewBox="0 0 180 180">
        {[0.25, 0.5, 0.75, 1].map(f => (
          <polygon key={f} points={polyPts(R * f)} fill="none" stroke="var(--border)" strokeWidth={f === 1 ? 1 : 0.7} />
        ))}
        {axes.map((_, i) => {
          const end = pt(i, R);
          return <line key={i} x1={cx} y1={cy} x2={end.x.toFixed(1)} y2={end.y.toFixed(1)} stroke="var(--border)" strokeWidth={0.8} />;
        })}
        <polygon points={valuePts} fill="rgba(201,162,68,0.12)" stroke="var(--gold)" strokeWidth={1.5} />
        {axes.map((a, i) => {
          const { x, y } = pt(i, (a.value / 100) * R);
          return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={3} fill="var(--gold)" />;
        })}
        {axes.map((a, i) => {
          const labelR = R + 16;
          const { x, y } = pt(i, labelR);
          return (
            <text key={i} x={x.toFixed(1)} y={y.toFixed(1)} textAnchor="middle" dominantBaseline="middle"
              fill="var(--text-secondary)" fontSize={8} fontWeight={700} fontFamily="inherit">
              {a.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ── Section banner (consistent header for every dashboard tab) ───────────────

function SectionBanner({ icon, title, desc, iconColor }: {
  icon: string; title: string; desc: string; iconColor: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: `color-mix(in srgb, ${iconColor} 5%, transparent)`, border: `1px solid color-mix(in srgb, ${iconColor} 16%, transparent)`, borderRadius: 14 }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: `color-mix(in srgb, ${iconColor} 9%, transparent)`, border: `1px solid color-mix(in srgb, ${iconColor} 21%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0, color: iconColor }}>{icon}</div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1.2 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3, lineHeight: 1.4 }}>{desc}</div>
      </div>
    </div>
  );
}

// ── Sidebar score ring (SVG arc) ─────────────────────────────────────────────

function SidebarScoreRing({ value, color }: { value: number; color: string }) {
  const r = 17, circ = 2 * Math.PI * r;
  const [dash, setDash] = useState(`0 ${circ}`);
  useEffect(() => {
    const t = setTimeout(() => {
      const filled = (Math.min(value, 100) / 100) * circ;
      setDash(`${filled} ${circ - filled}`);
    }, 120);
    return () => clearTimeout(t);
  }, [value, circ]);
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" style={{ flexShrink: 0 }}>
      <circle cx="20" cy="20" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4.5" />
      <circle cx="20" cy="20" r={r} fill="none" stroke={color} strokeWidth="4.5"
        strokeDasharray={dash} strokeDashoffset={circ * 0.25} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1)" }} />
      <text x="20" y="20" textAnchor="middle" dominantBaseline="central"
        fill={color} fontSize="9" fontWeight="800" fontFamily="inherit"
        style={{ fontVariantNumeric: "tabular-nums" } as React.CSSProperties}>{value}</text>
    </svg>
  );
}

// ── 8-Dimension Canvas Radar ─────────────────────────────────────────────────

function RadarChart8D({ axes }: { axes: { label: string; score: number }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useCurrentTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dark = theme !== "light";
    const tierCol = (s: number) => s >= 80 ? (dark ? "#4ade80" : "#0c6e2c") : s >= 60 ? (dark ? "#5b8ef5" : "#2563eb") : s >= 40 ? (dark ? "#f59e0b" : "#9c4a0a") : (dark ? "#ef4444" : "#b41e1e");
    const gridStrong = dark ? "rgba(255,255,255,0.1)"  : "rgba(0,0,0,0.14)";
    const gridWeak   = dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)";
    const ringLabel  = dark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.32)";
    const spokeCol   = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.09)";
    const dotStroke  = dark ? "#0C1009" : "#faf7f1";
    const labelCol   = dark ? "rgba(220,230,218,0.7)" : "rgba(26,20,16,0.72)";

    const dpr = window.devicePixelRatio || 1;
    const size = 248;
    canvas.width  = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width  = size + "px";
    canvas.style.height = size + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    const cx = size / 2, cy = size / 2, R = 84;
    const n = axes.length;
    const stepA = (2 * Math.PI) / n;
    const off = -Math.PI / 2;
    const pt = (i: number, r: number) => ({ x: cx + r * Math.cos(off + i * stepA), y: cy + r * Math.sin(off + i * stepA) });

    // Grid rings
    [0.25, 0.5, 0.75, 1].forEach(f => {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const { x, y } = pt(i, R * f);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = f === 1 ? gridStrong : gridWeak;
      ctx.lineWidth = f === 1 ? 1 : 0.7;
      ctx.stroke();
      if (f === 0.5 || f === 0.75) {
        const { x, y } = pt(0, R * f);
        ctx.fillStyle = ringLabel;
        ctx.font = "500 7px system-ui";
        ctx.textAlign = "left";
        ctx.fillText(`${f * 100 | 0}`, x + 3, y - 2);
      }
    });

    // Spokes
    for (let i = 0; i < n; i++) {
      const end = pt(i, R);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = spokeCol; ctx.lineWidth = 1; ctx.stroke();
    }

    // Player polygon fill
    const pts = axes.map((a, i) => pt(i, (a.score / 100) * R));
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fillStyle = "rgba(201,162,68,0.10)";
    ctx.fill();
    ctx.strokeStyle = "rgba(201,162,68,0.75)";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Axis dots
    pts.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = tierCol(axes[i].score);
      ctx.fill();
      ctx.strokeStyle = dotStroke; ctx.lineWidth = 1.5; ctx.stroke();
    });

    // Labels
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let i = 0; i < n; i++) {
      const { x, y } = pt(i, R + 22);
      const lines = axes[i].label.split("\n");
      ctx.fillStyle = labelCol;
      ctx.font = "600 8px system-ui";
      lines.forEach((line, li) => {
        ctx.fillText(line, x, y + (li - (lines.length - 1) / 2) * 11);
      });
    }
  }, [axes.map(a => a.score).join(","), theme]);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

// ── Psychology arc dial ───────────────────────────────────────────────────────

function PsychDial({ value, color, size = 88 }: { value: number; color: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const h = size * 0.58;
    canvas.width  = size * dpr; canvas.height = h * dpr;
    canvas.style.width  = size + "px"; canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    const cx = size / 2, cy = h - 4, Rv = size / 2 - 8;
    // track
    ctx.beginPath(); ctx.arc(cx, cy, Rv, Math.PI, 0, false);
    ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 9; ctx.lineCap = "round"; ctx.stroke();
    // fill
    const endA = Math.PI + (Math.min(value, 100) / 100) * Math.PI;
    ctx.beginPath(); ctx.arc(cx, cy, Rv, Math.PI, endA, false);
    ctx.strokeStyle = color; ctx.lineWidth = 9; ctx.lineCap = "round"; ctx.stroke();
    // center dot
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
  }, [value, color, size]);
  return <canvas ref={canvasRef} />;
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function HeroSparkline({ history }: { history: RatingHistoryEntry[] }) {
  const preferOrder = ["Rapid", "Blitz", "Classical", "Bullet"];
  const best = history.filter(h => h.points.length > 0)
    .sort((a, b) => {
      const ai = preferOrder.indexOf(a.name), bi = preferOrder.indexOf(b.name);
      if (ai !== -1 && bi !== -1 && ai !== bi) return ai - bi;
      return b.points.length - a.points.length;
    })[0];
  if (!best || best.points.length < 3) return null;
  const pts = best.points.slice(-40);
  const ratings = pts.map(p => p.rating);
  const minR = Math.min(...ratings), maxR = Math.max(...ratings);
  const rangeR = maxR - minR || 1;
  const W = 240, H = 52, PAD = 4;
  const coords = pts.map((p, i) => ({
    x: PAD + (i / (pts.length - 1)) * (W - PAD * 2),
    y: PAD + (1 - (p.rating - minR) / rangeR) * (H - PAD * 2),
  }));
  const linePath = coords.map((c, i) => (i === 0 ? "M" : "L") + " " + c.x.toFixed(1) + " " + c.y.toFixed(1)).join(" ");
  const fillPath = linePath + " L " + coords[coords.length - 1].x.toFixed(1) + " " + (H - PAD) + " L " + coords[0].x.toFixed(1) + " " + (H - PAD) + " Z";
  const current = pts[pts.length - 1];
  const diff = current.rating - pts[0].rating;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span style={{ color: "var(--gold-light)", fontWeight: 800, fontSize: 24, fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums" }}>{current.rating}</span>
        <span style={{ color: diff > 0 ? "var(--clr-best)" : "var(--clr-blunder)", fontWeight: 600, fontSize: 12 }}>{diff > 0 ? "+" : ""}{diff}</span>
        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{best.name}</span>
      </div>
      <svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", maxWidth: 220, height: H, display: "block" }}>
        <defs>
          <linearGradient id="hsg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="rgba(201,162,68,0.28)" />
            <stop offset="100%" stopColor="rgba(201,162,68,0.01)" />
          </linearGradient>
        </defs>
        <path d={fillPath} fill="url(#hsg)" />
        <path d={linePath} fill="none" stroke="rgba(201,162,68,0.9)" strokeWidth={2} strokeLinejoin="round"
          strokeDasharray="800" style={{ animation: "draw-path 2s ease forwards" }} />
        <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y}
          r={3} fill="var(--gold)" stroke="var(--bg-surface)" strokeWidth={2} />
      </svg>
    </div>
  );
}

// ── Color bar ─────────────────────────────────────────────────────────────────

function ColorBar({ label, wins, draws, losses, score, total }: {
  label: string; wins: number; draws: number; losses: number; score: number; total: number;
}) {
  const wPct = total > 0 ? (wins / total) * 100 : 0;
  const dPct = total > 0 ? (draws / total) * 100 : 0;
  const lPct = total > 0 ? (losses / total) * 100 : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: 13 }}>{label}</span>
        <span style={{ color: score >= 50 ? "var(--clr-best)" : "var(--clr-blunder)", fontWeight: 700, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{score}{"%"}</span>
      </div>
      <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", height: 8, gap: 1 }}>
        <div style={{ width: wPct + "%", background: "var(--clr-best)",    transition: "width 1s ease" }} />
        <div style={{ width: dPct + "%", background: "var(--border-strong)", transition: "width 1s ease" }} />
        <div style={{ width: lPct + "%", background: "var(--clr-blunder)", transition: "width 1s ease" }} />
      </div>
      <div style={{ display: "flex", gap: 10, fontSize: 13, color: "var(--text-secondary)" }}>
        <span><span style={{ color: "var(--clr-best)" }}>■</span>{" "}{wins}W</span>
        <span><span style={{ color: "var(--border-strong)" }}>■</span>{" "}{draws}D</span>
        <span><span style={{ color: "var(--clr-blunder)" }}>■</span>{" "}{losses}L</span>
        <span style={{ marginLeft: "auto" }}>{total} games</span>
      </div>
    </div>
  );
}

// ── Opening card ──────────────────────────────────────────────────────────────

function OpeningCard({ name, data, idx, isBest }: {
  name: string;
  data: { count: number; wins?: number; draws?: number; losses?: number; avg_cp_theory?: number };
  idx: number; isBest: boolean;
}) {
  const w = data.wins ?? 0, d = data.draws ?? 0, l = data.losses ?? 0;
  const total = data.count;
  const wPct = total > 0 ? (w / total) * 100 : 0;
  const dPct = total > 0 ? (d / total) * 100 : 0;
  const lPct = total > 0 ? (l / total) * 100 : 0;
  const score = total > 0 ? Math.round((w + d * 0.5) / total * 100) : 0;
  return (
    <div style={{
      background: isBest ? "rgba(34,197,94,0.04)" : "var(--bg-elevated)",
      border: isBest ? "1px solid rgba(34,197,94,0.28)" : "1px solid var(--border)",
      borderRadius: 12, padding: "14px 16px", position: "relative",
      animation: "fade-slide-up 0.4s ease " + STAGGER[Math.min(idx, 7)] + " both",
    }}>
      {isBest && (
        <span style={{ position: "absolute", top: 10, right: 12, background: "rgba(34,197,94,0.15)", color: "var(--clr-best)", border: "1px solid rgba(34,197,94,0.3)", fontSize: 12, fontWeight: 800, padding: "2px 7px", borderRadius: 4, letterSpacing: "0.1em", textTransform: "uppercase" }}>BEST</span>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, paddingRight: isBest ? 48 : 0 }}>
        <div>
          <p style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>{name || "Unknown"}</p>
          <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 2 }}>{total} games</p>
        </div>
        <span style={{ color: score >= 50 ? "var(--clr-best)" : "var(--clr-blunder)", fontWeight: 800, fontSize: 20, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{score}%</span>
      </div>
      <div style={{ display: "flex", borderRadius: 4, overflow: "hidden", height: 5, marginBottom: 8, gap: 1 }}>
        <div style={{ width: wPct + "%", background: "var(--clr-best)", borderRadius: 2, transition: "width 1s ease 0.3s" }} />
        <div style={{ width: dPct + "%", background: "var(--border-strong)", borderRadius: 2, transition: "width 1s ease 0.3s" }} />
        <div style={{ width: lPct + "%", background: "var(--clr-blunder)", borderRadius: 2, transition: "width 1s ease 0.3s" }} />
      </div>
      <div style={{ display: "flex", gap: 10, fontSize: 13, color: "var(--text-muted)" }}>
        <span style={{ color: "var(--clr-best)" }}>{w}W</span>
        <span>{d}D</span>
        <span style={{ color: "var(--clr-blunder)" }}>{l}L</span>
        {data.avg_cp_theory != null && (
          <span style={{ marginLeft: "auto", color: data.avg_cp_theory > 40 ? "var(--clr-mistake)" : "var(--text-muted)" }}>{data.avg_cp_theory} cp avg</span>
        )}
      </div>
    </div>
  );
}

// ── Section keyword helpers ───────────────────────────────────────────────────

function matchSection(sections: ParsedSection[], ...keywords: string[]): ParsedSection | undefined {
  return sections.find(s => keywords.some(k => s.title.toLowerCase().includes(k)));
}
function firstQuote(section: ParsedSection | undefined): string {
  if (!section) return "";
  const body = section.body || section.subSections[0]?.body[0] || "";
  return stripBold(body.split(/\.\s/)[0] || "").trim();
}
function allBullets(section: ParsedSection | undefined): string[] {
  if (!section) return [];
  return [...section.bullets, ...section.subSections.flatMap(s => s.bullets)].filter(Boolean).map(stripBold);
}
function rawBullets(section: ParsedSection | undefined): string[] {
  if (!section) return [];
  return [...section.bullets, ...section.subSections.flatMap(s => s.bullets)].filter(Boolean);
}

// ── Parse markdown into structured sections ───────────────────────────────────

type ParsedSection = {
  title: string;
  body: string;
  bullets: string[];
  subSections: { title: string; bullets: string[]; body: string[] }[];
};

function parseMarkdown(text: string): ParsedSection[] {
  const rawSections = text.split(/\n(?=###\s)/);
  return rawSections.map(s => {
    const lines = s.split("\n");
    const title = lines[0].replace(/^###\s+\d+\.\s*/, "").replace(/^###\s*/, "").trim();
    const rest = lines.slice(1);

    const subSections: ParsedSection["subSections"] = [];
    const topBullets: string[] = [];
    const topBody: string[] = [];
    let currentSub: ParsedSection["subSections"][0] | null = null;

    for (const line of rest) {
      if (line.startsWith("#### ")) {
        if (currentSub) subSections.push(currentSub);
        currentSub = { title: line.replace(/^####\s*/, "").trim(), bullets: [], body: [] };
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        const bullet = line.slice(2).trim();
        if (currentSub) currentSub.bullets.push(bullet);
        else topBullets.push(bullet);
      } else if (line.trim() && line !== "---") {
        if (currentSub) currentSub.body.push(line.trim());
        else topBody.push(line.trim());
      }
    }
    if (currentSub) subSections.push(currentSub);

    return { title, body: topBody.join(" "), bullets: topBullets, subSections };
  }).filter(s => s.title);
}

// Strip markdown bold markers
function stripBold(text: string): string { return text.replace(/\*\*/g, ""); }

// Render bold inline
function renderBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i} style={{ color: "var(--text-primary)", fontWeight: 700 }}>{part.slice(2, -2)}</strong>
      : part
  );
}

// ── Checklist component ───────────────────────────────────────────────────────

function Checklist({ items }: { items: string[] }) {
  const [checked, setChecked] = useState<boolean[]>(() => items.map(() => false));
  const allDone = checked.every(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((q, i) => (
        <button key={i} onClick={() => setChecked(c => { const n = [...c]; n[i] = !n[i]; return n; })}
          style={{ background: checked[i] ? "rgba(94,166,100,0.08)" : "var(--bg-elevated)", border: `1px solid ${checked[i] ? "rgba(94,166,100,0.3)" : "var(--border)"}`, borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
          <span style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${checked[i] ? "var(--clr-best)" : "var(--border-strong)"}`, background: checked[i] ? "var(--clr-best)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1, transition: "all 0.15s" }}>
            {checked[i] && <span style={{ color: "#fff", fontSize: 12, fontWeight: 900, lineHeight: 1 }}>✓</span>}
          </span>
          <span style={{ color: checked[i] ? "var(--text-muted)" : "var(--text-secondary)", fontSize: 13, lineHeight: 1.5, textDecoration: checked[i] ? "line-through" : "none", flex: 1 }}>{stripBold(q)}</span>
        </button>
      ))}
      {allDone && items.length > 0 && (
        <div style={{ background: "rgba(94,166,100,0.1)", border: "1px solid rgba(94,166,100,0.3)", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <span style={{ color: "var(--clr-best)", fontSize: 14 }}>✓</span>
          <span style={{ color: "var(--clr-best)", fontSize: 13, fontWeight: 700 }}>All checked — you{"'"}re ready to play.</span>
        </div>
      )}
    </div>
  );
}

// ── Animated arc ring (concentric arcs for style ring) ───────────────────────

function AnimatedArc({ cx, cy, r, value, color, strokeWidth = 8, delay = 0 }: {
  cx: number; cy: number; r: number; value: number; color: string; strokeWidth?: number; delay?: number;
}) {
  const circ = 2 * Math.PI * r;
  const [dash, setDash] = useState(`0 ${circ}`);
  useEffect(() => {
    const t = setTimeout(() => {
      const filled = Math.min(value, 99.9) / 100 * circ;
      setDash(`${filled} ${circ - filled}`);
    }, delay);
    return () => clearTimeout(t);
  }, [value, circ, delay]);
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--ring-track)" strokeWidth={strokeWidth} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={dash} strokeDashoffset={circ * 0.25} strokeLinecap="round"
        style={{ transition: `stroke-dasharray 1.4s cubic-bezier(0.4,0,0.2,1) ${delay}ms` }} />
    </>
  );
}

// ── Trait bars (extracted so hooks aren't in a loop) ─────────────────────────

function TraitBars({ traits }: { traits: { label: string; value: number; color: string }[] }) {
  const [widths, setWidths] = useState(() => traits.map(() => 0));
  useEffect(() => {
    const timers = traits.map((t, i) =>
      setTimeout(() => setWidths(w => { const n = [...w]; n[i] = t.value; return n; }), 300 + i * 80)
    );
    return () => timers.forEach(clearTimeout);
  }, [traits.map(t => t.value).join(",")]);  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {traits.map((t, i) => (
        <div key={t.label}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <span style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 600 }}>{t.label}</span>
            <span style={{ color: t.color, fontWeight: 800, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{Math.round(t.value)}%</span>
          </div>
          <div style={{ height: 4, background: "var(--bg-elevated)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: widths[i] + "%", background: t.color, borderRadius: 3, transition: `width 0.9s cubic-bezier(0.4,0,0.2,1) ${i * 80}ms` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Style DNA: identity card with ring + trait bars ───────────────────────────

function StyleDNA({ stats, styleTag, styleQuote }: {
  stats: ProfileStats;
  styleTag: ReturnType<typeof deriveStyleTag>;
  styleQuote: string;
}) {
  const openingScore = stats.top_openings.length > 0
    ? (() => {
        const s = stats.top_openings.slice(0, 5).map(([, d]) =>
          d.count > 0 ? ((d.wins ?? 0) + (d.draws ?? 0) * 0.5) / d.count * 100 : 50
        );
        return s.reduce((a, b) => a + b, 0) / s.length;
      })()
    : 50;

  const traits = [
    { label: "Win Rate",    value: Math.min(stats.win_rate * 1.25, 100), color: "var(--gold)" },
    { label: "Precision",   value: Math.min(stats.precision_rate, 100),   color: "var(--accent-blue)" },
    { label: "Endurance",   value: Math.max(0, 100 - stats.winning_error_rate * 1.6), color: "var(--clr-best)" },
    { label: "Preparation", value: Math.min(openingScore, 100),           color: "var(--clr-brilliant)" },
    { label: "Consistency", value: Math.min(stats.clean_game_rate * 1.4, 100), color: "var(--clr-excellent)" },
  ];
  const overallScore = Math.round(traits.reduce((a, t) => a + t.value, 0) / traits.length);
  const cx = 70, cy = 70;

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "20px 22px", display: "grid", gridTemplateColumns: "140px 1fr", gap: 24, alignItems: "center", animation: "fade-slide-up 0.3s ease both" }}>
      {/* Ring */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <svg width="140" height="140" viewBox="0 0 140 140" style={{ overflow: "visible" }}>
          <AnimatedArc cx={cx} cy={cy} r={56} value={traits[0].value} color="var(--gold)"          strokeWidth={9}  delay={0} />
          <AnimatedArc cx={cx} cy={cy} r={42} value={traits[1].value} color="var(--accent-blue)"   strokeWidth={9}  delay={200} />
          <AnimatedArc cx={cx} cy={cy} r={28} value={traits[2].value} color="var(--clr-best)"      strokeWidth={9}  delay={400} />
          <text x={cx} y={cy - 7} textAnchor="middle" fill="var(--gold)" fontSize={26} fontWeight={900} fontFamily="inherit" style={{ fontVariantNumeric: "tabular-nums" } as React.CSSProperties}>{overallScore}</text>
          <text x={cx} y={cy + 10} textAnchor="middle" fill="var(--text-muted)" fontSize={8} fontWeight={800} fontFamily="inherit" letterSpacing="0.12em">SCORE</text>
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, alignSelf: "stretch" }}>
          {[
            { label: "Win Rate", color: "var(--gold)" },
            { label: "Precision", color: "var(--accent-blue)" },
            { label: "Endurance", color: "var(--clr-best)" },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
      {/* Identity + trait bars */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em" }}>Playing Identity</span>
        </div>
        <p style={{ color: styleTag.color, fontSize: 22, fontWeight: 900, lineHeight: 1.1, marginBottom: 6 }}>{styleTag.tag}</p>
        {styleQuote ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5, marginBottom: 14, fontStyle: "italic", borderLeft: `2px solid ${styleTag.border}`, paddingLeft: 10 }}>
            &ldquo;{styleQuote}.&rdquo;
          </p>
        ) : (
          <p style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>{styleTag.sub}</p>
        )}
        <TraitBars traits={traits} />
      </div>
    </div>
  );
}

// ── Priority cards ────────────────────────────────────────────────────────────

function PriorityCard({ rank, title, sub, metric, metricLabel, quote, color, accent, icon, idx }: {
  rank: "critical" | "focus" | "strength";
  title: string; sub: string; metric: string; metricLabel: string;
  quote: string; color: string; accent: string; icon: string; idx: number;
}) {
  const rankConfig = {
    critical:  { badge: "CRITICAL",  badgeColor: "var(--clr-blunder)",   badgeBg: "rgba(224,82,82,0.12)",   badgeBorder: "rgba(224,82,82,0.3)" },
    focus:     { badge: "NEXT FOCUS", badgeColor: "var(--gold)",          badgeBg: "rgba(201,162,68,0.1)",   badgeBorder: "rgba(201,162,68,0.3)" },
    strength:  { badge: "YOUR EDGE", badgeColor: "var(--clr-best)",      badgeBg: "rgba(94,166,100,0.1)",   badgeBorder: "rgba(94,166,100,0.3)" },
  }[rank];

  return (
    <div style={{ background: accent, border: `1px solid color-mix(in srgb, ${color} 16%, transparent)`, borderRadius: 14, padding: "16px 16px 14px", display: "flex", flexDirection: "column", gap: 10, animation: `fade-slide-up 0.35s ease ${STAGGER[idx]} both` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{ fontSize: 18, color }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: rankConfig.badgeColor, background: rankConfig.badgeBg, border: `1px solid ${rankConfig.badgeBorder}`, padding: "2px 7px", borderRadius: 4, letterSpacing: "0.1em" }}>{rankConfig.badge}</span>
      </div>
      <div>
        <p style={{ color: "var(--text-primary)", fontWeight: 900, fontSize: 17, lineHeight: 1.1 }}>{title}</p>
        <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 2 }}>{sub}</p>
      </div>
      <div style={{ background: "var(--bg-surface)", borderRadius: 8, padding: "8px 10px", display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ color, fontWeight: 900, fontSize: 22, fontVariantNumeric: "tabular-nums" }}>{metric}</span>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{metricLabel}</span>
      </div>
      {quote && (
        <p style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.5, borderTop: `1px solid color-mix(in srgb, ${color} 9%, transparent)`, paddingTop: 10, fontStyle: "italic" }}>
          &ldquo;{quote}&rdquo;
        </p>
      )}
    </div>
  );
}

// ── Weekly training grid ──────────────────────────────────────────────────────

type DayActivity = { icon: string; label: string; color: string; accent: string };

function assignWeeklyPlan(bullets: string[], weakestPhase: string): DayActivity[] {
  const phaseLabel = weakestPhase.includes("Endgame") ? "Endgame" : weakestPhase.includes("Opening") ? "Opening" : "Middlegame";
  // Activity type library
  const PUZZLE:   DayActivity = { icon: "◉", label: "Puzzles",       color: "var(--clr-brilliant)", accent: "rgba(138,93,245,0.1)" };
  const OPENING:  DayActivity = { icon: "◈", label: "Opening Study", color: "var(--accent-blue)",   accent: "rgba(91,142,245,0.1)" };
  const ENDGAME:  DayActivity = { icon: "♔", label: "Endgame Study", color: "var(--gold)",          accent: "rgba(201,162,68,0.1)" };
  const MIDGAME:  DayActivity = { icon: "∿", label: "Middlegame",    color: "var(--clr-inaccuracy)", accent: "rgba(230,168,23,0.1)" };
  const PRACTICE: DayActivity = { icon: "♜", label: "Practice",      color: "var(--clr-best)",      accent: "rgba(94,166,100,0.1)" };
  const REST:     DayActivity = { icon: "○", label: "Rest",          color: "var(--text-muted)",    accent: "var(--tint-subtle)" };
  const PHASE_ACT = phaseLabel === "Endgame" ? ENDGAME : phaseLabel === "Opening" ? OPENING : MIDGAME;

  // Try to infer activities from bullet keywords
  const infer = (b: string): DayActivity | null => {
    const t = b.toLowerCase();
    if (t.includes("puzzle") || t.includes("tactic")) return PUZZLE;
    if (t.includes("opening") || t.includes("repertoire") || t.includes("theory")) return OPENING;
    if (t.includes("endgame")) return ENDGAME;
    if (t.includes("middlegame") || t.includes("positional")) return MIDGAME;
    if (t.includes("practice") || t.includes("game") || t.includes("play")) return PRACTICE;
    return null;
  };

  const inferred = bullets.slice(0, 7).map(b => infer(b)).filter(Boolean) as DayActivity[];
  // Default week with weakest phase emphasized
  const defaults: DayActivity[] = [PUZZLE, PHASE_ACT, OPENING, PUZZLE, PHASE_ACT, PRACTICE, REST];
  const plan = defaults.map((d, i) => inferred[i] ?? d);
  return plan;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const ACTIVITY_TIPS: Record<string, string> = {
  "Puzzles":       "Sharpen pattern recognition with 15–20 tactics puzzles",
  "Opening Study": "Drill your main lines and learn key pawn structures",
  "Endgame Study": "Practice K+P, rook, and queen endgames with a board",
  "Middlegame":    "Study positional ideas and piece coordination plans",
  "Practice":      "Play long games and review every decision afterward",
  "Rest":          "Rest is essential — your brain consolidates patterns while you sleep",
};

function WeeklyGrid({ bullets, weakestPhase }: { bullets: string[]; weakestPhase: string }) {
  const plan = assignWeeklyPlan(bullets, weakestPhase);

  // Extract short tip from corresponding bullet if available
  const getTip = (i: number, act: DayActivity) =>
    bullets[i]
      ? stripBold(bullets[i]).replace(/^\*\*[^*]+\*\*:?\s*/, "").slice(0, 72)
      : ACTIVITY_TIPS[act.label] ?? "";

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden", animation: "fade-slide-up 0.35s ease 0.24s both" }}>
      {/* Header */}
      <div style={{ padding: "13px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--gold)", fontSize: 13 }}>◈</span>
        <span style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 13 }}>Training Blueprint</span>
        <span style={{ marginLeft: "auto", background: "var(--gold-subtle)", color: "var(--gold)", border: "1px solid var(--gold-border)", fontSize: 13, fontWeight: 800, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.1em" }}>7-DAY PLAN</span>
      </div>

      {/* Day cards — 4 + 3 responsive grid */}
      <div style={{ padding: "14px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(128px, 1fr))", gap: 10 }}>
        {DAYS.map((day, i) => {
          const act = plan[i];
          const isRest = act.label === "Rest";
          const tip = getTip(i, act);
          return (
            <div
              key={day}
              style={{
                borderRadius: 12,
                border: `1px solid color-mix(in srgb, ${act.color} 16%, transparent)`,
                borderLeft: `3px solid ${act.color}`,
                background: isRest ? "var(--tint-subtle)" : act.accent,
                padding: "11px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 7,
                animation: `fade-slide-up 0.28s ease ${STAGGER[i]} both`,
                opacity: isRest ? 0.72 : 1,
              }}
            >
              {/* Day badge + icon row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>{day}</span>
                <span style={{ fontSize: 14, color: act.color, lineHeight: 1 }}>{act.icon}</span>
              </div>

              {/* Activity name */}
              <span style={{ color: act.color, fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>{act.label}</span>

              {/* Tip text */}
              {tip && (
                <span style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5, marginTop: 1 }}>
                  {tip}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Visual insight bullet (styled action card for AI bullets) ────────────────

function InsightBullet({ text, icon = "▸", color = "var(--accent-blue)", accent = "rgba(91,142,245,0.06)", idx = 0 }: {
  text: string; icon?: string; color?: string; accent?: string; idx?: number;
}) {
  return (
    <div style={{ background: accent, border: `1px solid color-mix(in srgb, ${color} 13%, transparent)`, borderRadius: 9, padding: "9px 12px", display: "flex", gap: 8, alignItems: "flex-start", animation: `fade-slide-up 0.25s ease ${idx * 0.05}s both` }}>
      <span style={{ color, fontSize: 12, flexShrink: 0, marginTop: 2, fontWeight: 700 }}>{icon}</span>
      <span style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.65 }}>{renderBold(text)}</span>
    </div>
  );
}

// ── Visual coach section block ────────────────────────────────────────────────

function CoachBlock({ icon, title, badge, badgeColor = "var(--gold)", borderColor = "var(--border)", children, delay = "0s" }: {
  icon: string; title: string; badge?: string; badgeColor?: string;
  borderColor?: string; children: React.ReactNode; delay?: string;
}) {
  return (
    <div style={{ background: "var(--bg-surface)", border: `1px solid ${borderColor}`, borderRadius: 16, overflow: "hidden", animation: `fade-slide-up 0.3s ease ${delay} both` }}>
      <div style={{ background: `color-mix(in srgb, ${borderColor} 4%, transparent)`, borderBottom: `1px solid ${borderColor}`, padding: "13px 18px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: badgeColor, fontSize: 13 }}>{icon}</span>
        <span style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 13 }}>{title}</span>
        {badge && (
          <span style={{ marginLeft: "auto", background: `color-mix(in srgb, ${badgeColor} 9%, transparent)`, color: badgeColor, border: `1px solid color-mix(in srgb, ${badgeColor} 19%, transparent)`, fontSize: 13, fontWeight: 800, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.1em" }}>{badge}</span>
        )}
      </div>
      <div style={{ padding: "16px 18px" }}>
        {children}
      </div>
    </div>
  );
}

// ── Inline quote block (AI body paragraph rendered with bold) ─────────────────

function BodyInsight({ text, color }: { text: string; color: string }) {
  return (
    <div style={{ borderLeft: `3px solid color-mix(in srgb, ${color} 31%, transparent)`, background: `color-mix(in srgb, ${color} 2%, transparent)`, borderRadius: "0 8px 8px 0", padding: "10px 14px", marginBottom: 10 }}>
      <p style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.75 }}>{renderBold(text)}</p>
    </div>
  );
}

function SubSection({ sub, color, icon }: { sub: { title: string; bullets: string[]; body: string[] }; color: string; icon: string }) {
  if (sub.body.length === 0 && sub.bullets.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ color, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 7 }}>{sub.title}</p>
      {sub.body.map((b, j) => <BodyInsight key={j} text={b} color={color} />)}
      {sub.bullets.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: sub.body.length ? 6 : 0 }}>
          {sub.bullets.map((b, j) => <InsightBullet key={j} idx={j} text={b} icon={icon} color={color} accent={`color-mix(in srgb, ${color} 4%, transparent)`} />)}
        </div>
      )}
    </div>
  );
}

// ── Conversion Dashboard ─────────────────────────────────────────────────────

function ConversionDashboard({ stats }: { stats: ProfileStats }) {
  const convRate   = stats.conversion_rate   ?? 0;
  const squRate    = stats.squander_rate     ?? 0;
  const eqAdvRate  = stats.equal_to_advantage_rate ?? 0;
  const reached    = stats.games_reached_winning ?? 0;
  const squandered = stats.games_squandered ?? 0;

  if (reached === 0) return null;

  // Estimated Elo cost: each 10% squander ≈ 25-40 Elo
  const eloCost = Math.round(squRate / 10 * 30);

  const gauges = [
    {
      label: "Conversion Rate",
      sub: "Winning positions → actual wins",
      value: convRate,
      color: convRate >= 70 ? "var(--clr-best)" : convRate >= 50 ? "var(--gold)" : "var(--clr-blunder)",
      good: convRate >= 70,
    },
    {
      label: "Squander Rate",
      sub: "Winning positions lost or drawn",
      value: squRate,
      color: squRate <= 20 ? "var(--clr-best)" : squRate <= 40 ? "var(--gold)" : "var(--clr-blunder)",
      good: squRate <= 20,
      inverted: true,
    },
    {
      label: "Equal → Advantage",
      sub: "Creating winning chances from balance",
      value: eqAdvRate,
      color: eqAdvRate >= 40 ? "var(--clr-best)" : eqAdvRate >= 25 ? "var(--gold)" : "var(--clr-blunder)",
      good: eqAdvRate >= 40,
    },
  ];

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-red)", borderRadius: 16, overflow: "hidden", animation: "fade-slide-up 0.3s ease 0.05s both" }}>
      <div style={{ background: "var(--tint-red)", borderBottom: "1px solid var(--border-red)", padding: "13px 18px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: "var(--clr-blunder)", fontSize: 14 }}>⚡</span>
        <span style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 13 }}>Conversion Intelligence</span>
        <span style={{ marginLeft: "auto", background: "var(--tint-red-strong)", color: "var(--clr-blunder)", border: "1px solid var(--border-red)", fontSize: 13, fontWeight: 800, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.1em" }}>ELO KILLER ANALYSIS</span>
      </div>
      <div style={{ padding: "16px 18px" }}>
        {/* Elo cost banner */}
        {eloCost > 0 && (
          <div style={{ background: "var(--tint-red)", border: "1px solid var(--border-red)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "var(--clr-blunder)", fontWeight: 900, fontSize: 26, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>−{eloCost}</span>
            <div>
              <p style={{ color: "var(--clr-blunder)", fontWeight: 800, fontSize: 12, marginBottom: 1 }}>Estimated Elo leak per 100 games</p>
              <p style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.4 }}>
                You squandered {squandered} of {reached} winning positions. That{"'"}s {squRate}% of earned advantages handed back.
              </p>
            </div>
          </div>
        )}
        {/* 3 gauge cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {gauges.map((g, i) => {
            const displayVal = g.inverted ? (100 - g.value) : g.value;
            const arcR = 30;
            const circ = 2 * Math.PI * arcR;
            const filled = circ * Math.min(g.value, 100) / 100;
            return (
              <div key={i} style={{ background: "var(--bg-app)", border: `1px solid color-mix(in srgb, ${g.color} 16%, transparent)`, borderRadius: 12, padding: "14px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r={arcR} fill="none" stroke="var(--border)" strokeWidth={6} />
                  <circle
                    cx="40" cy="40" r={arcR}
                    fill="none" stroke={g.color} strokeWidth={6}
                    strokeDasharray={`${filled} ${circ}`}
                    strokeLinecap="round"
                    transform="rotate(-90 40 40)"
                    style={{ transition: "stroke-dasharray 1s ease" }}
                  />
                  <text x="40" y="43" textAnchor="middle" fill={g.color} fontSize={15} fontWeight={900} fontFamily="inherit" style={{ fontVariantNumeric: "tabular-nums" } as React.CSSProperties}>
                    {g.value.toFixed(0)}%
                  </text>
                </svg>
                <div style={{ textAlign: "center" }}>
                  <p style={{ color: g.color, fontWeight: 800, fontSize: 13, marginBottom: 2 }}>{g.label}</p>
                  <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.4 }}>{g.sub}</p>
                </div>
                <span style={{ fontSize: 13, fontWeight: 800, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.08em", background: g.good ? "rgba(94,166,100,0.12)" : "rgba(224,82,82,0.1)", color: g.good ? "var(--clr-best)" : "var(--clr-blunder)", border: `1px solid ${g.good ? "rgba(94,166,100,0.3)" : "rgba(224,82,82,0.2)"}` }}>
                  {g.good ? "✓ STRONG" : "↑ IMPROVE"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Move-Range Accuracy Chart ─────────────────────────────────────────────────

function MoveRangeChart({ stats }: { stats: ProfileStats }) {
  const mra = stats.move_range_accuracy;
  if (!mra) return null;

  const buckets = [
    { label: "Moves 1–15",  key: "1-15",  sub: "Opening / Early" },
    { label: "Moves 16–30", key: "16-30", sub: "Middlegame" },
    { label: "Moves 31–50", key: "31-50", sub: "Late Midgame" },
    { label: "Moves 50+",   key: "50+",   sub: "Endgame" },
  ];

  const values  = buckets.map(b => mra[b.key] ?? 0);
  const maxVal  = Math.max(...values, 1);
  const worstIdx = values.indexOf(Math.max(...values));

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", animation: "fade-slide-up 0.3s ease 0.08s both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ color: "var(--accent-blue)", fontSize: 12 }}>◎</span>
        <span style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 12 }}>Accuracy by Move Range</span>
        <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 12 }}>avg CP loss ↓ better</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {buckets.map((b, i) => {
          const val     = values[i];
          const pct     = Math.min((val / maxVal) * 100, 100);
          const isWorst = i === worstIdx;
          const barColor = isWorst ? "var(--clr-blunder)" : val < maxVal * 0.5 ? "var(--clr-best)" : "var(--gold)";
          return (
            <div key={b.key} style={{ display: "grid", gridTemplateColumns: "90px 1fr 44px", gap: 10, alignItems: "center" }}>
              <div>
                <p style={{ color: isWorst ? "var(--clr-blunder)" : "var(--text-primary)", fontSize: 13, fontWeight: isWorst ? 800 : 600 }}>{b.label}</p>
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{b.sub}</p>
              </div>
              <div style={{ background: "var(--bg-app)", borderRadius: 6, height: 10, overflow: "hidden", border: isWorst ? "1px solid rgba(224,82,82,0.3)" : "1px solid var(--border)" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 6, transition: "width 0.8s ease" }} />
              </div>
              <span style={{ color: barColor, fontWeight: 800, fontSize: 12, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                {val.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
      {worstIdx >= 0 && (
        <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10, lineHeight: 1.5 }}>
          <span style={{ color: "var(--clr-blunder)", fontWeight: 800 }}>Critical zone: {buckets[worstIdx].label}</span>
          {" — "}precision drops sharply here. Targeted drill work in this phase will have the highest Elo impact.
        </p>
      )}
    </div>
  );
}

// ── Opening Fitness Matrix ────────────────────────────────────────────────────

function OpeningFitnessMatrix({ stats }: { stats: ProfileStats }) {
  if (!stats.top_openings || stats.top_openings.length === 0) return null;

  const rows = stats.top_openings.slice(0, 6).map(([name, d]) => {
    const score  = d.count > 0 ? Math.round(((d.wins ?? 0) + (d.draws ?? 0) * 0.5) / d.count * 100) : 0;
    const exitEv = (d as Record<string, unknown>).avg_exit_eval as number | null | undefined;
    let verdict: "Keep" | "Deepen" | "Replace";
    if (score >= 60 && (exitEv == null || exitEv >= -30)) verdict = "Keep";
    else if (score >= 45 || (exitEv != null && exitEv > 0)) verdict = "Deepen";
    else verdict = "Replace";
    const verdictColor = verdict === "Keep" ? "var(--clr-best)" : verdict === "Deepen" ? "var(--gold)" : "var(--clr-blunder)";
    return { name: name.replace(/^[A-Z0-9]+\s*/, "").split(":")[0].slice(0, 28), score, exitEv, verdict, verdictColor, d };
  });

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-purple)", borderRadius: 14, overflow: "hidden", animation: "fade-slide-up 0.3s ease 0.11s both" }}>
      <div style={{ background: "var(--tint-purple)", borderBottom: "1px solid var(--border-purple)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--clr-brilliant)", fontSize: 12 }}>♟</span>
        <span style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 12 }}>Opening Fitness Matrix</span>
        <span style={{ marginLeft: "auto", background: "var(--tint-purple-strong)", color: "var(--clr-brilliant)", border: "1px solid var(--border-purple)", fontSize: 13, fontWeight: 800, padding: "2px 7px", borderRadius: 4, letterSpacing: "0.1em" }}>REPERTOIRE AUDIT</span>
      </div>
      <div style={{ padding: "0 0 6px" }}>
        {/* Header row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 52px 66px 64px", gap: 8, padding: "8px 16px 6px", borderBottom: "1px solid var(--border)" }}>
          {["Opening", "Score", "Exit Eval", "Verdict"].map(h => (
            <span key={h} style={{ color: "var(--text-muted)", fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em" }}>{h}</span>
          ))}
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 52px 66px 64px", gap: 8, padding: "9px 16px", borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none", alignItems: "center" }}>
            <div>
              <p style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>{r.name}</p>
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{r.d.count} games • {r.d.wins ?? 0}W {r.d.draws ?? 0}D {r.d.losses ?? 0}L</p>
            </div>
            <div style={{ textAlign: "center" }}>
              <span style={{ color: r.score >= 55 ? "var(--clr-best)" : r.score >= 40 ? "var(--gold)" : "var(--clr-blunder)", fontWeight: 800, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{r.score}%</span>
            </div>
            <div style={{ textAlign: "center" }}>
              {r.exitEv != null ? (
                <span style={{ color: r.exitEv >= 0 ? "var(--clr-best)" : r.exitEv >= -50 ? "var(--gold)" : "var(--clr-blunder)", fontWeight: 700, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                  {r.exitEv > 0 ? "+" : ""}{r.exitEv}cp
                </span>
              ) : (
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
              )}
            </div>
            <div>
              <span style={{ fontSize: 13, fontWeight: 800, padding: "3px 8px", borderRadius: 5, letterSpacing: "0.08em", color: r.verdictColor, background: `color-mix(in srgb, ${r.verdictColor} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${r.verdictColor} 19%, transparent)` }}>
                {r.verdict === "Keep" ? "✓ Keep" : r.verdict === "Deepen" ? "↑ Deepen" : "✕ Replace"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Weekly Schedule Cards ─────────────────────────────────────────────────────

const DAY_META: Record<string, { short: string; icon: string; color: string; accent: string }> = {
  MON: { short: "Mon", icon: "♟", color: "var(--accent-blue)",   accent: "rgba(91,142,245,0.08)"  },
  TUE: { short: "Tue", icon: "⚡", color: "var(--clr-blunder)",  accent: "rgba(224,82,82,0.07)"   },
  WED: { short: "Wed", icon: "◎", color: "var(--clr-brilliant)", accent: "rgba(138,93,245,0.07)"  },
  THU: { short: "Thu", icon: "◈", color: "var(--gold)",          accent: "rgba(201,162,68,0.07)"  },
  FRI: { short: "Fri", icon: "⚡", color: "var(--clr-blunder)",  accent: "rgba(224,82,82,0.07)"   },
  SAT: { short: "Sat", icon: "★", color: "var(--clr-best)",      accent: "rgba(94,166,100,0.07)"  },
  SUN: { short: "Sun", icon: "◆", color: "var(--clr-excellent)", accent: "rgba(94,200,180,0.07)"  },
};

function parseScheduleBullets(bullets: string[]): Array<{ day: string; focus: string; activity: string; resource: string; duration: string }> {
  const results: Array<{ day: string; focus: string; activity: string; resource: string; duration: string }> = [];
  const DAY_KEYS = Object.keys(DAY_META);
  for (const b of bullets) {
    // Format: MON | Focus Area | Activity | Resource | Duration
    const stripped = stripBold(b).trim();
    const parts = stripped.split("|").map(p => p.trim());
    const day = parts[0]?.toUpperCase().slice(0, 3);
    if (DAY_KEYS.includes(day)) {
      results.push({
        day,
        focus:    parts[1] || "",
        activity: parts[2] || "",
        resource: parts[3] || "",
        duration: parts[4] || "",
      });
    }
  }
  // Sort by day order
  const order = DAY_KEYS;
  return results.sort((a, b) => order.indexOf(a.day) - order.indexOf(b.day));
}

function WeeklyScheduleCards({ section }: { section: ReturnType<typeof matchSection> }) {
  const allBull = section ? [...(section.bullets || []), ...(section.subSections || []).flatMap(s => s.bullets)] : [];
  const parsed = parseScheduleBullets(allBull);

  // Fallback: if no structured bullets, render subsections plainly
  if (parsed.length === 0 && section) {
    return (
      <CoachBlock icon="📅" title="Weekly Study Schedule" badge="7-DAY PLAN" badgeColor="var(--clr-excellent)" borderColor="rgba(94,200,180,0.3)" delay="0.15s">
        {section.body && <BodyInsight text={section.body} color="var(--clr-excellent)" />}
        {section.subSections.map((sub, i) => <SubSection key={i} sub={sub} color="var(--clr-excellent)" icon="▸" />)}
        {section.bullets.map((b, i) => <InsightBullet key={i} idx={i} text={b} icon="▸" color="var(--clr-excellent)" accent="rgba(94,200,180,0.05)" />)}
      </CoachBlock>
    );
  }

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid rgba(94,200,180,0.3)", borderRadius: 16, overflow: "hidden", animation: "fade-slide-up 0.3s ease 0.15s both" }}>
      <div style={{ background: "rgba(94,200,180,0.04)", borderBottom: "1px solid rgba(94,200,180,0.2)", padding: "13px 18px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--clr-excellent)", fontSize: 13 }}>📅</span>
        <span style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 13 }}>Weekly Study Schedule</span>
        <span style={{ marginLeft: "auto", background: "rgba(94,200,180,0.1)", color: "var(--clr-excellent)", border: "1px solid rgba(94,200,180,0.3)", fontSize: 13, fontWeight: 800, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.1em" }}>7-DAY PLAN</span>
      </div>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        {parsed.map((d, i) => {
          const meta = DAY_META[d.day] || DAY_META.MON;
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "56px 1fr auto", gap: 12, alignItems: "center", background: meta.accent, border: `1px solid color-mix(in srgb, ${meta.color} 13%, transparent)`, borderRadius: 10, padding: "10px 12px", animation: `fade-slide-up 0.25s ease ${i * 0.04}s both` }}>
              {/* Day badge */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <span style={{ fontSize: 15, color: meta.color }}>{meta.icon}</span>
                <span style={{ color: meta.color, fontWeight: 900, fontSize: 12, letterSpacing: "0.08em" }}>{meta.short}</span>
              </div>
              {/* Content */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <span style={{ color: meta.color, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>{d.focus}</span>
                </div>
                <p style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.5, marginBottom: d.resource ? 5 : 0 }}>{d.activity}</p>
                {d.resource && (
                  <span style={{ display: "inline-block", background: "var(--bg-elevated)", border: `1px solid color-mix(in srgb, ${meta.color} 19%, transparent)`, borderRadius: 4, padding: "2px 7px", fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>
                    📚 {d.resource}
                  </span>
                )}
              </div>
              {/* Duration */}
              {d.duration && (
                <span style={{ color: meta.color, fontWeight: 800, fontSize: 13, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {d.duration}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Resource Library Cards ─────────────────────────────────────────────────────

const RESOURCE_CATS: Record<string, { icon: string; color: string; accent: string }> = {
  "OPENINGS":     { icon: "♟", color: "var(--clr-brilliant)", accent: "rgba(138,93,245,0.07)" },
  "TACTICS":      { icon: "⚡", color: "var(--clr-blunder)",  accent: "rgba(224,82,82,0.07)"  },
  "ENDGAMES":     { icon: "◈", color: "var(--gold)",          accent: "rgba(201,162,68,0.07)" },
  "MENTAL GAME":  { icon: "◎", color: "var(--accent-blue)",   accent: "rgba(91,142,245,0.07)" },
  "MASTER GAMES": { icon: "★", color: "var(--clr-best)",      accent: "rgba(94,166,100,0.07)" },
};

function ResourceLibraryCards({ section }: { section: ReturnType<typeof matchSection> }) {
  if (!section) return null;

  const cats = section.subSections.filter(s => s.bullets.length > 0 || s.body.length > 0);

  if (cats.length === 0) {
    // Fallback to plain rendering
    const bullets = [...(section.bullets || []), ...section.subSections.flatMap(s => s.bullets)];
    return (
      <CoachBlock icon="◆" title="Recommended Resources" badge="CURATED FOR YOU" badgeColor="var(--clr-excellent)" borderColor="rgba(94,200,180,0.3)" delay="0.17s">
        {section.body && <BodyInsight text={section.body} color="var(--clr-excellent)" />}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {bullets.map((b, i) => <InsightBullet key={i} idx={i} text={b} icon="◆" color="var(--clr-excellent)" accent="rgba(94,200,180,0.05)" />)}
        </div>
      </CoachBlock>
    );
  }

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid rgba(94,200,180,0.3)", borderRadius: 16, overflow: "hidden", animation: "fade-slide-up 0.3s ease 0.17s both" }}>
      <div style={{ background: "rgba(94,200,180,0.04)", borderBottom: "1px solid rgba(94,200,180,0.2)", padding: "13px 18px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--clr-excellent)", fontSize: 13 }}>◆</span>
        <span style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 13 }}>Resource Library</span>
        <span style={{ marginLeft: "auto", background: "rgba(94,200,180,0.1)", color: "var(--clr-excellent)", border: "1px solid rgba(94,200,180,0.3)", fontSize: 13, fontWeight: 800, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.1em" }}>CURATED FOR YOU</span>
      </div>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        {cats.map((cat, ci) => {
          const catKey = cat.title.toUpperCase().trim();
          const meta = RESOURCE_CATS[catKey] || RESOURCE_CATS["MASTER GAMES"];
          const allItems = [...cat.body, ...cat.bullets];
          return (
            <div key={ci}>
              {/* Category header */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: meta.color }}>{meta.icon}</span>
                <span style={{ color: meta.color, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em" }}>{cat.title}</span>
                <div style={{ flex: 1, height: 1, background: `color-mix(in srgb, ${meta.color} 15%, transparent)`, marginLeft: 6 }} />
              </div>
              {/* Resource cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {allItems.map((item, ii) => {
                  // Parse: **Title by Author** — Why relevant
                  const m = item.match(/^\*\*(.+?)\*\*\s*(?:—|--)?\s*(.*)$/);
                  const title = m ? m[1].trim() : stripBold(item).split("—")[0].trim();
                  const why   = m ? m[2].trim() : stripBold(item).split(/—|-/).slice(1).join("—").trim();
                  return (
                    <div key={ii} style={{ background: meta.accent, border: `1px solid color-mix(in srgb, ${meta.color} 13%, transparent)`, borderRadius: 9, padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{ color: meta.color, fontSize: 12, flexShrink: 0, marginTop: 2 }}>◆</span>
                      <div>
                        <p style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 12, lineHeight: 1.3, marginBottom: why ? 4 : 0 }}>{title}</p>
                        {why && <p style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.55 }}>{why}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Career Roadmap Timeline ────────────────────────────────────────────────────

const PHASE_META = [
  { key: "PHASE 1", label: "Foundation",    months: "Months 1–6",   color: "var(--accent-blue)",   accent: "rgba(91,142,245,0.07)",  icon: "①" },
  { key: "PHASE 2", label: "Specialisation", months: "Months 7–18",  color: "var(--gold)",           accent: "rgba(201,162,68,0.07)",  icon: "②" },
  { key: "PHASE 3", label: "Mastery",        months: "Months 19–36", color: "var(--clr-brilliant)",  accent: "rgba(138,93,245,0.07)", icon: "③" },
];

const PHASE_KEY_LABELS: Record<string, { icon: string; color: string }> = {
  "OBJECTIVE":    { icon: "▶", color: "var(--text-primary)" },
  "OPENING":      { icon: "♟", color: "var(--clr-brilliant)" },
  "TACTICS":      { icon: "⚡", color: "var(--clr-blunder)" },
  "ENDGAME":      { icon: "◈", color: "var(--gold)" },
  "STUDY":        { icon: "◎", color: "var(--accent-blue)" },
  "TOURNAMENT":   { icon: "🏆", color: "var(--clr-best)" },
  "RATING TARGET":{ icon: "📈", color: "var(--clr-best)" },
  "MILESTONE":    { icon: "★", color: "var(--gold)" },
  "NOVELTY":      { icon: "💡", color: "var(--clr-brilliant)" },
  "MENTAL":       { icon: "◎", color: "var(--accent-blue)" },
};

function parseCareerBullet(text: string): { key: string; value: string } | null {
  const stripped = stripBold(text).trim();
  const m = stripped.match(/^([A-Z][A-Z\s]+?):\s*(.+)$/);
  if (m) return { key: m[1].trim(), value: m[2].trim() };
  return null;
}

function CareerRoadmap({ section }: { section: ReturnType<typeof matchSection> }) {
  if (!section) return null;

  const phases = section.subSections.filter(s =>
    s.title.toUpperCase().includes("PHASE") || s.title.match(/\bFoundation\b|\bSpeciali/i) || s.title.match(/\bMastery\b/i)
  );

  if (phases.length === 0) {
    // Fallback
    return (
      <CoachBlock icon="◈" title="Career Development Plan" badge="3-YEAR ROADMAP" badgeColor="var(--gold)" borderColor="rgba(201,162,68,0.25)" delay="0.13s">
        {section.body && <BodyInsight text={section.body} color="var(--gold)" />}
        {section.subSections.map((sub, i) => (
          <div key={i} style={{ marginBottom: 14, border: "1px solid rgba(201,162,68,0.18)", borderRadius: 10, padding: "11px 13px", background: "rgba(201,162,68,0.03)" }}>
            <p style={{ color: "var(--gold)", fontSize: 13, fontWeight: 900, marginBottom: 8, letterSpacing: "0.04em" }}>{sub.title}</p>
            {sub.body.map((b, j) => <BodyInsight key={j} text={b} color="var(--gold)" />)}
            {sub.bullets.map((b, j) => <InsightBullet key={j} idx={j} text={b} icon="▸" color="var(--gold)" accent="rgba(201,162,68,0.05)" />)}
          </div>
        ))}
      </CoachBlock>
    );
  }

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid rgba(201,162,68,0.25)", borderRadius: 16, overflow: "hidden", animation: "fade-slide-up 0.3s ease 0.13s both" }}>
      <div style={{ background: "rgba(201,162,68,0.04)", borderBottom: "1px solid rgba(201,162,68,0.2)", padding: "13px 18px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--gold)", fontSize: 13 }}>◈</span>
        <span style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 13 }}>Career Development Plan</span>
        <span style={{ marginLeft: "auto", background: "rgba(201,162,68,0.1)", color: "var(--gold)", border: "1px solid rgba(201,162,68,0.3)", fontSize: 13, fontWeight: 800, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.1em" }}>3-YEAR ROADMAP</span>
      </div>
      <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 0 }}>
        {section.body && <BodyInsight text={section.body} color="var(--gold)" />}
        {phases.map((phase, pi) => {
          const pmeta = PHASE_META[pi] || PHASE_META[2];
          // Separate structured bullets (KEY: value) from plain bullets
          const structured: { key: string; value: string }[] = [];
          const plain: string[] = [];
          for (const b of phase.bullets) {
            const p = parseCareerBullet(b);
            if (p) structured.push(p);
            else plain.push(b);
          }
          // Also parse body lines for KEY: value
          for (const b of phase.body) {
            const p = parseCareerBullet(b);
            if (p) structured.push(p);
            else if (b.length > 10) plain.push(b);
          }
          // Extract milestone and rating for header badges
          const milestone = structured.find(s => s.key === "MILESTONE");
          const rating = structured.find(s => s.key === "RATING TARGET");
          const objective = structured.find(s => s.key === "OBJECTIVE");
          const rest = structured.filter(s => s.key !== "OBJECTIVE" && s.key !== "MILESTONE" && s.key !== "RATING TARGET");

          return (
            <div key={pi} style={{ position: "relative", paddingLeft: 28, paddingBottom: pi < phases.length - 1 ? 20 : 0 }}>
              {/* Timeline line */}
              {pi < phases.length - 1 && (
                <div style={{ position: "absolute", left: 11, top: 28, bottom: 0, width: 2, background: `linear-gradient(to bottom, color-mix(in srgb, ${pmeta.color} 38%, transparent), color-mix(in srgb, ${PHASE_META[pi+1]?.color ?? "var(--border)"} 19%, transparent))` }} />
              )}
              {/* Phase dot */}
              <div style={{ position: "absolute", left: 0, top: 14, width: 22, height: 22, borderRadius: "50%", background: pmeta.accent, border: `2px solid ${pmeta.color}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: pmeta.color, fontSize: 13, fontWeight: 900 }}>{pi + 1}</span>
              </div>
              {/* Phase card */}
              <div style={{ background: pmeta.accent, border: `1px solid color-mix(in srgb, ${pmeta.color} 16%, transparent)`, borderRadius: 12, overflow: "hidden" }}>
                {/* Phase header */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid color-mix(in srgb, ${pmeta.color} 13%, transparent)` }}>
                  <span style={{ color: pmeta.color, fontWeight: 900, fontSize: 12 }}>{pmeta.label}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 12 }}>·</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{pmeta.months}</span>
                  {rating && (
                    <span style={{ marginLeft: "auto", background: "rgba(94,166,100,0.12)", color: "var(--clr-best)", border: "1px solid rgba(94,166,100,0.3)", fontSize: 13, fontWeight: 800, padding: "2px 8px", borderRadius: 4 }}>
                      📈 {rating.value}
                    </span>
                  )}
                </div>
                {/* Phase body */}
                <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                  {objective && (
                    <div style={{ background: `color-mix(in srgb, ${pmeta.color} 7%, transparent)`, border: `1px solid color-mix(in srgb, ${pmeta.color} 19%, transparent)`, borderRadius: 8, padding: "8px 10px", marginBottom: 4 }}>
                      <p style={{ color: pmeta.color, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Objective</p>
                      <p style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.55 }}>{objective.value}</p>
                    </div>
                  )}
                  {rest.map((s, si) => {
                    const km = PHASE_KEY_LABELS[s.key] || { icon: "▸", color: pmeta.color };
                    return (
                      <div key={si} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <span style={{ color: km.color, fontSize: 13, flexShrink: 0, marginTop: 1 }}>{km.icon}</span>
                        <div>
                          <span style={{ color: km.color, fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.key}</span>
                          {" "}
                          <span style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.5 }}>{s.value}</span>
                        </div>
                      </div>
                    );
                  })}
                  {plain.length > 0 && (
                    <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                      {plain.map((b, bi) => (
                        <div key={bi} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                          <span style={{ color: pmeta.color, fontSize: 12, flexShrink: 0, marginTop: 2 }}>▸</span>
                          <span style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.5 }}>{renderBold(b)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {milestone && (
                    <div style={{ marginTop: 4, background: "rgba(201,162,68,0.06)", border: "1px solid rgba(201,162,68,0.2)", borderRadius: 7, padding: "6px 10px", display: "flex", gap: 6, alignItems: "flex-start" }}>
                      <span style={{ color: "var(--gold)", fontSize: 12, flexShrink: 0 }}>★</span>
                      <div>
                        <span style={{ color: "var(--gold)", fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>Milestone </span>
                        <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{milestone.value}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Opening Repertoire with verdict badges ────────────────────────────────────

function parseVerdictFromText(text: string): "KEEP" | "DEEPEN" | "REPLACE" | null {
  const upper = text.toUpperCase();
  if (upper.includes("[KEEP]") || upper.includes("VERDICT: KEEP")) return "KEEP";
  if (upper.includes("[DEEPEN]") || upper.includes("VERDICT: DEEPEN")) return "DEEPEN";
  if (upper.includes("[REPLACE]") || upper.includes("VERDICT: REPLACE")) return "REPLACE";
  return null;
}

const VERDICT_CONFIG = {
  KEEP:    { color: "var(--clr-best)",     bg: "rgba(94,166,100,0.1)",  border: "rgba(94,166,100,0.3)",  label: "✓ Keep" },
  DEEPEN:  { color: "var(--gold)",          bg: "rgba(201,162,68,0.1)",  border: "rgba(201,162,68,0.3)",  label: "↑ Deepen" },
  REPLACE: { color: "var(--clr-blunder)",  bg: "rgba(224,82,82,0.1)",   border: "rgba(224,82,82,0.3)",   label: "✕ Replace" },
};

function OpeningSubSection({ sub, color }: { sub: { title: string; bullets: string[]; body: string[] }; color: string }) {
  if (sub.body.length === 0 && sub.bullets.length === 0) return null;

  // Extract verdict from title or first bullet
  const allText = [sub.title, ...sub.body, ...sub.bullets].join(" ");
  const verdict = parseVerdictFromText(allText);
  const vconf = verdict ? VERDICT_CONFIG[verdict] : null;

  // Parse bullets into sections — look for ECO-prefixed opening entries
  const openingEntries: Array<{ header: string; verdict: "KEEP" | "DEEPEN" | "REPLACE" | null; bullets: string[] }> = [];
  let currentEntry: { header: string; verdict: "KEEP" | "DEEPEN" | "REPLACE" | null; bullets: string[] } | null = null;

  for (const b of sub.bullets) {
    const stripped = stripBold(b);
    // Detect opening header lines (bold with ECO code or "VERDICT:")
    const isHeader = b.includes("**") && (b.match(/\b[A-E][0-9][0-9]\b/) || b.match(/^\*\*[^*]+\*\*/));
    const bVerdict = parseVerdictFromText(stripped);
    if (bVerdict && currentEntry) { currentEntry.verdict = bVerdict; continue; }
    if (isHeader || (stripped.startsWith("[") && stripped.includes("]"))) {
      if (currentEntry) openingEntries.push(currentEntry);
      currentEntry = { header: stripBold(b).replace(/^—?\s*/, ""), verdict: null, bullets: [] };
    } else if (currentEntry) {
      currentEntry.bullets.push(b);
    }
  }
  if (currentEntry) openingEntries.push(currentEntry);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <p style={{ color, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em" }}>{sub.title.replace(/VERDICT:.*/, "").trim()}</p>
        {vconf && (
          <span style={{ fontSize: 13, fontWeight: 800, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.08em", color: vconf.color, background: vconf.bg, border: `1px solid ${vconf.border}` }}>{vconf.label}</span>
        )}
      </div>
      {sub.body.map((b, j) => <BodyInsight key={j} text={b} color={color} />)}
      {openingEntries.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {openingEntries.map((e, ei) => {
            const evc = e.verdict ? VERDICT_CONFIG[e.verdict] : null;
            return (
              <div key={ei} style={{ background: "var(--bg-app)", border: `1px solid color-mix(in srgb, ${color} 13%, transparent)`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: e.bullets.length ? 7 : 0 }}>
                  <p style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 12, lineHeight: 1.3, flex: 1 }}>
                    {renderBold(e.header.replace(/VERDICT:.*/i, "").trim())}
                  </p>
                  {evc && (
                    <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 800, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.08em", color: evc.color, background: evc.bg, border: `1px solid ${evc.border}` }}>{evc.label}</span>
                  )}
                </div>
                {e.bullets.map((b, bi) => (
                  <div key={bi} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 4 }}>
                    <span style={{ color, fontSize: 13, flexShrink: 0, marginTop: 3 }}>▸</span>
                    <span style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.55 }}>{renderBold(b)}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        sub.bullets.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {sub.bullets.map((b, j) => <InsightBullet key={j} idx={j} text={b} icon="♟" color={color} accent={`color-mix(in srgb, ${color} 4%, transparent)`} />)}
          </div>
        )
      )}
    </div>
  );
}

// ── Performance Analysis Block — visual + text hybrid ────────────────────────

function PerformanceAnalysisBlock({ stats, section }: { stats: ProfileStats; section: ReturnType<typeof matchSection> }) {
  const phaseEntries = Object.entries(stats.phase_error_rate);
  const bxp = stats.blunder_by_phase ?? {};
  const bxpEntries = Object.entries(bxp).filter(([, v]) => (v as number) > 0);
  const maxBxp = Math.max(1, ...bxpEntries.map(([, v]) => v as number));

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-blue)", borderRadius: 16, overflow: "hidden", animation: "fade-slide-up 0.3s ease 0.04s both" }}>
      {/* Header */}
      <div style={{ background: "var(--tint-blue)", borderBottom: "1px solid var(--border-blue)", padding: "13px 18px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--accent-blue)", fontSize: 13 }}>◎</span>
        <span style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 13 }}>Performance Analysis</span>
        <span style={{ marginLeft: "auto", background: "var(--tint-blue-strong)", color: "var(--accent-blue)", border: "1px solid var(--border-blue)", fontSize: 13, fontWeight: 800, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.1em" }}>YOUR STATS DECODED</span>
      </div>

      <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 18 }}>

        {/* Visual row 1: Colour performance + Phase error bars */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* Color performance mini */}
          <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: "12px 14px" }}>
            <p style={{ color: "var(--accent-blue)", fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>Colour Performance</p>
            {[
              { label: "White", wins: stats.white_wins, draws: stats.white_draws, losses: stats.as_white - stats.white_wins - stats.white_draws, score: stats.white_score_pct, total: stats.as_white },
              { label: "Black", wins: stats.black_wins, draws: stats.black_draws, losses: stats.as_black - stats.black_wins - stats.black_draws, score: stats.black_score_pct, total: stats.as_black },
            ].map(c => {
              const wPct = c.total > 0 ? (c.wins / c.total) * 100 : 0;
              const dPct = c.total > 0 ? (c.draws / c.total) * 100 : 0;
              const lPct = c.total > 0 ? (c.losses / c.total) * 100 : 0;
              return (
                <div key={c.label} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ color: "var(--text-secondary)", fontSize: 13, fontWeight: 600 }}>{c.label}</span>
                    <span style={{ color: c.score >= 50 ? "var(--clr-best)" : "var(--clr-blunder)", fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{c.score}%</span>
                  </div>
                  <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", height: 9 }}>
                    {wPct > 0 && <div style={{ width: wPct + "%", background: "var(--clr-best)", transition: "width 0.8s ease" }} />}
                    {dPct > 0 && <div style={{ width: dPct + "%", background: "var(--gold)" }} />}
                    {lPct > 0 && <div style={{ width: lPct + "%", background: "var(--clr-blunder)" }} />}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                    <span style={{ color: "var(--clr-best)", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{c.wins}W</span>
                    <span style={{ color: "var(--gold)", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{c.draws}D</span>
                    <span style={{ color: "var(--clr-blunder)", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{c.losses}L</span>
                    <span style={{ color: "var(--text-muted)", fontSize: 13, marginLeft: "auto" }}>{c.total} games</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Phase error mini bars */}
          <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: "12px 14px" }}>
            <p style={{ color: "var(--accent-blue)", fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>Error Rate by Phase</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {phaseEntries.map(([phaseKey, rate]) => {
                const label = PHASE_LABELS[phaseKey] ?? phaseKey;
                const isWorst = phaseKey === stats.weakest_phase;
                const pct = Math.min(rate * 100, 100);
                const color = isWorst ? "var(--clr-blunder)" : pct > 20 ? "var(--clr-mistake)" : "var(--clr-best)";
                return (
                  <div key={phaseKey}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ color: isWorst ? "var(--clr-blunder)" : "var(--text-secondary)", fontSize: 13, fontWeight: isWorst ? 800 : 500 }}>{label}{isWorst && " ⚠"}</span>
                      <span style={{ color, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{pct.toFixed(1)}%</span>
                    </div>
                    <div style={{ background: "var(--bg-app)", borderRadius: 4, height: 7, overflow: "hidden", border: isWorst ? "1px solid rgba(224,82,82,0.25)" : "none" }}>
                      <div style={{ width: pct + "%", background: color, height: "100%", borderRadius: 4, transition: "width 1s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Blunder by phase breakdown if available */}
        {bxpEntries.length > 0 && (
          <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: "12px 14px" }}>
            <p style={{ color: "var(--accent-blue)", fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>Where Games Are Decided (Blunder Distribution)</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {bxpEntries.map(([phase, count]) => {
                const pct = ((count as number) / maxBxp) * 100;
                const label = PHASE_LABELS[phase] ?? phase;
                const isHighest = (count as number) === maxBxp;
                return (
                  <div key={phase} style={{ display: "grid", gridTemplateColumns: "100px 1fr 32px", gap: 10, alignItems: "center" }}>
                    <span style={{ color: isHighest ? "var(--clr-blunder)" : "var(--text-secondary)", fontSize: 13, fontWeight: isHighest ? 800 : 500 }}>{label}</span>
                    <div style={{ background: "var(--bg-app)", borderRadius: 5, height: 8, overflow: "hidden" }}>
                      <div style={{ width: pct + "%", background: isHighest ? "var(--clr-blunder)" : "var(--clr-mistake)", height: "100%", borderRadius: 5, transition: "width 0.8s ease" }} />
                    </div>
                    <span style={{ color: isHighest ? "var(--clr-blunder)" : "var(--text-secondary)", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{count as number}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* AI narrative text */}
        {section && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            {section.body && <BodyInsight text={section.body} color="var(--accent-blue)" />}
            {section.subSections.map((sub, i) => <SubSection key={i} sub={sub} color="var(--accent-blue)" icon="▸" />)}
            {section.bullets.map((b, i) => <InsightBullet key={i} idx={i} text={b} icon="▸" color="var(--accent-blue)" accent="var(--tint-blue)" />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Technical Deep Dive — per-area cards ─────────────────────────────────────

function TechnicalDeepDiveSection({ stats, section }: { stats: ProfileStats; section: ReturnType<typeof matchSection> }) {
  const blunders  = stats.global_counts["Blunder"] ?? 0;
  const mistakes  = stats.global_counts["Mistake"] ?? 0;
  const totalErrors = blunders + mistakes;
  const mra = stats.move_range_accuracy ?? {};
  const endgameCP  = mra["31-50"] ?? 0;
  const lateCP     = mra["50+"]   ?? 0;
  const openingCP  = mra["1-15"]  ?? 0;
  const midCP      = mra["16-30"] ?? 0;
  const cpDeltaWB = (stats.avg_cp_loss_white ?? stats.avg_cp_loss) - (stats.avg_cp_loss_black ?? stats.avg_cp_loss);
  const winErrRate = stats.winning_error_rate ?? 0;
  const blunderFW  = stats.blunder_from_winning ?? 0;

  // Match subsections from AI text to each technical area
  const findSub = (keys: string[]) =>
    section?.subSections.find(s => keys.some(k => s.title.toLowerCase().includes(k))) ?? null;

  const tacticalSub    = findSub(["tactical", "tactic", "blind"]);
  const positionalSub  = findSub(["position", "strateg"]);
  const endgameSub     = findSub(["endgame", "end game"]);
  const psychSub       = findSub(["psych", "mental", "time", "pressure", "convert"]);

  const areas = [
    {
      icon: "⚡",
      label: "Tactical Ability",
      color: "var(--clr-blunder)",
      tint: "var(--tint-red)",
      border: "var(--border-red)",
      severity: stats.precision_rate < 60 ? "critical" : stats.precision_rate < 75 ? "caution" : "strong",
      metrics: [
        { label: "Precision Rate", value: stats.precision_rate + "%", good: stats.precision_rate >= 75 },
        { label: "Blunders",       value: "" + blunders,              good: blunders < 5 },
        { label: "Mistakes",       value: "" + mistakes,              good: mistakes < 10 },
        { label: "Error Total",    value: "" + totalErrors,           good: totalErrors < 15 },
      ],
      worstMove: stats.worst_moves?.[0],
      aiSub: tacticalSub,
    },
    {
      icon: "♟",
      label: "Positional & Strategy",
      color: "var(--clr-brilliant)",
      tint: "var(--tint-purple)",
      border: "var(--border-purple)",
      severity: Math.abs(cpDeltaWB) < 5 ? "strong" : Math.abs(cpDeltaWB) < 15 ? "caution" : "critical",
      metrics: [
        { label: "CP Loss White",  value: (stats.avg_cp_loss_white ?? stats.avg_cp_loss).toFixed(1), good: (stats.avg_cp_loss_white ?? stats.avg_cp_loss) < 35 },
        { label: "CP Loss Black",  value: (stats.avg_cp_loss_black ?? stats.avg_cp_loss).toFixed(1), good: (stats.avg_cp_loss_black ?? stats.avg_cp_loss) < 35 },
        { label: "W–B Δ CP",       value: (cpDeltaWB >= 0 ? "+" : "") + cpDeltaWB.toFixed(1),       good: Math.abs(cpDeltaWB) < 8 },
        { label: "Avg CP Loss",    value: stats.avg_cp_loss.toFixed(1),                               good: stats.avg_cp_loss < 35 },
      ],
      worstMove: null,
      aiSub: positionalSub,
    },
    {
      icon: "◈",
      label: "Endgame Technique",
      color: "var(--gold)",
      tint: "var(--tint-gold)",
      border: "var(--border-gold)",
      severity: (endgameCP > midCP * 1.4 || lateCP > midCP * 1.4) ? "critical" : endgameCP > midCP * 1.1 ? "caution" : "strong",
      metrics: [
        { label: "Opening CP Loss",  value: openingCP.toFixed(1),  good: openingCP < 35 },
        { label: "Midgame CP Loss",  value: midCP.toFixed(1),      good: midCP < 35 },
        { label: "Move 31–50 CP",    value: endgameCP > 0 ? endgameCP.toFixed(1) : "—", good: endgameCP < 40 },
        { label: "Move 50+ CP",      value: lateCP > 0 ? lateCP.toFixed(1) : "—",       good: lateCP < 40 },
      ],
      worstMove: null,
      aiSub: endgameSub,
    },
    {
      icon: "◉",
      label: "Psychological Profile",
      color: "var(--accent-blue)",
      tint: "var(--tint-blue)",
      border: "var(--border-blue)",
      severity: winErrRate > 0.4 ? "critical" : winErrRate > 0.2 ? "caution" : "strong",
      metrics: [
        { label: "Winning Err Rate",    value: (winErrRate * 100).toFixed(1) + "%",    good: winErrRate < 0.2 },
        { label: "Blunder When Winning",value: "" + blunderFW,                          good: blunderFW === 0 },
        { label: "Squander Rate",       value: (stats.squander_rate ?? 0).toFixed(1) + "%", good: (stats.squander_rate ?? 100) <= 20 },
        { label: "Conversion Rate",     value: (stats.conversion_rate ?? 0).toFixed(1) + "%", good: (stats.conversion_rate ?? 0) >= 70 },
      ],
      worstMove: null,
      aiSub: psychSub,
    },
  ];

  const severityColors: Record<string, string> = {
    critical: "var(--clr-blunder)",
    caution:  "var(--gold)",
    strong:   "var(--clr-best)",
  };
  const severityLabels: Record<string, string> = {
    critical: "↑ PRIORITY",
    caution:  "~ MONITOR",
    strong:   "✓ SOLID",
  };

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-red)", borderRadius: 16, overflow: "hidden", animation: "fade-slide-up 0.3s ease 0.07s both" }}>
      {/* Header */}
      <div style={{ background: "var(--tint-red)", borderBottom: "1px solid var(--border-red)", padding: "13px 18px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--clr-blunder)", fontSize: 13 }}>⚡</span>
        <span style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 13 }}>Technical Deep Dive</span>
        <span style={{ marginLeft: "auto", background: "var(--tint-red-strong)", color: "var(--clr-blunder)", border: "1px solid var(--border-red)", fontSize: 13, fontWeight: 800, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.1em" }}>WHERE TO IMPROVE</span>
      </div>

      {/* Section body intro */}
      {section?.body && (
        <div style={{ padding: "14px 18px 0" }}>
          <BodyInsight text={section.body} color="var(--clr-blunder)" />
        </div>
      )}

      <div style={{ padding: "14px 18px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {areas.map((area, ai) => {
          const sevColor = severityColors[area.severity];
          return (
            <div key={ai} style={{ background: area.tint, border: `1px solid ${area.border}`, borderRadius: 12, overflow: "hidden" }}>
              {/* Card header */}
              <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 13px", borderBottom: `1px solid ${area.border}` }}>
                <span style={{ color: area.color, fontSize: 13 }}>{area.icon}</span>
                <span style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 13 }}>{area.label}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 800, padding: "2px 7px", borderRadius: 4, letterSpacing: "0.09em", color: sevColor, background: `color-mix(in srgb, ${sevColor} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${sevColor} 25%, transparent)` }}>
                  {severityLabels[area.severity]}
                </span>
              </div>
              {/* Metrics grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, padding: "10px 13px 8px", borderBottom: `1px solid ${area.border}` }}>
                {area.metrics.map((m, mi) => (
                  <div key={mi} style={{ marginBottom: 6 }}>
                    <div style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>{m.label}</div>
                    <div style={{ color: m.good ? "var(--clr-best)" : "var(--clr-blunder)", fontSize: 14, fontWeight: 900, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{m.value}</div>
                  </div>
                ))}
              </div>
              {/* Worst move example (tactical only) */}
              {area.worstMove && (
                <div style={{ padding: "8px 13px", borderBottom: `1px solid ${area.border}`, background: "var(--bg-elevated)" }}>
                  <p style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Worst Blunder Sample</p>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ color: "var(--clr-blunder)", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700 }}>{area.worstMove.san}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: 13 }}>→ best was</span>
                    <span style={{ color: "var(--clr-best)", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700 }}>{area.worstMove.best_san}</span>
                    <span style={{ marginLeft: "auto", color: "var(--clr-blunder)", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>−{area.worstMove.cp_loss}cp</span>
                  </div>
                  <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Move {area.worstMove.move_number} · {area.worstMove.phase}</span>
                </div>
              )}
              {/* AI insight */}
              {area.aiSub && (
                <div style={{ padding: "8px 13px" }}>
                  {area.aiSub.body.map((b, bi) => (
                    <p key={bi} style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.65, marginBottom: 4 }}>{renderBold(b)}</p>
                  ))}
                  {area.aiSub.bullets.slice(0, 2).map((b, bi) => (
                    <div key={bi} style={{ display: "flex", gap: 6, marginBottom: 3 }}>
                      <span style={{ color: area.color, fontSize: 13, flexShrink: 0, marginTop: 1 }}>▸</span>
                      <span style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.55 }}>{renderBold(b)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Any bullets not captured by sub-sections */}
      {section && section.bullets.length > 0 && (
        <div style={{ padding: "0 18px 16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {section.bullets.map((b, i) => <InsightBullet key={i} idx={i} text={b} icon="⚠" color="var(--clr-blunder)" accent="var(--tint-red)" />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI Coach tab (visual-first, full detail) ──────────────────────────────────

function ProfileCoach({ text, stats }: { text: string; stats: ProfileStats }) {
  const sections = parseMarkdown(text);
  const styleTag = deriveStyleTag(stats);

  // AI generates sections titled: PLAYER FINGERPRINT / PERFORMANCE ANALYSIS /
  // OPENING REPERTOIRE DEEP DIVE / TECHNICAL PROFILE /
  // LONG-TERM CAREER DEVELOPMENT PLAN / WEEKLY STUDY SCHEDULE /
  // RESOURCE LIBRARY / COACH'S VERDICT
  const fingerprintS = matchSection(sections, "fingerprint");
  const performanceS = matchSection(sections, "performance");
  const openingS     = matchSection(sections, "opening", "repertoire");
  const technicalS   = matchSection(sections, "technical");
  const careerS      = matchSection(sections, "career", "development");
  const weeklyS      = matchSection(sections, "weekly", "schedule");
  const resourceS    = matchSection(sections, "resource", "library");
  const verdictS     = matchSection(sections, "verdict");

  const styleQuote      = firstQuote(fingerprintS);
  const careerBullets   = allBullets(careerS);
  const resourceBullets = rawBullets(resourceS);
  const verdictBullets  = rawBullets(verdictS);

  const sortedPhases = Object.entries(stats.phase_error_rate)
    .map(([k, v]) => ({ key: k, label: (() => { const t = k.toLowerCase(); return t.includes("end") ? "Endgame" : t.includes("mid") ? "Middlegame" : "Opening"; })(), rate: v }))
    .sort((a, b) => b.rate - a.rate);
  const [critical, focus] = sortedPhases;

  const bestColor   = (stats.white_score_pct ?? 0) >= (stats.black_score_pct ?? 0) ? "White" : "Black";
  const bestScore   = Math.max(stats.white_score_pct ?? 0, stats.black_score_pct ?? 0);
  const bestOpening = stats.top_openings.length > 0
    ? stats.top_openings.map(([name, d]) => ({ name, score: d.count > 0 ? Math.round(((d.wins ?? 0) + (d.draws ?? 0) * 0.5) / d.count * 100) : 0 }))
        .sort((a, b) => b.score - a.score)[0]
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ① Playing DNA ring + trait bars */}
      <StyleDNA stats={stats} styleTag={styleTag} styleQuote={styleQuote} />

      {/* ② Player Fingerprint — full portrait paragraph */}
      {fingerprintS?.body && fingerprintS.body.length > 60 && (
        <BodyInsight text={fingerprintS.body} color={styleTag.color} />
      )}
      {fingerprintS && fingerprintS.bullets.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {fingerprintS.bullets.map((b, i) => (
            <InsightBullet key={i} idx={i} text={b} icon="◈" color={styleTag.color} accent={styleTag.bg} />
          ))}
        </div>
      )}

      {/* ③ Priority snapshot — 3 at-a-glance cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        <PriorityCard rank="critical" idx={0}
          icon="△" color="var(--clr-blunder)" accent="rgba(224,82,82,0.05)"
          title={critical?.label ?? "Middlegame"}
          sub="Highest error rate — study here first"
          metric={(Math.min((critical?.rate ?? 0) * 100, 100)).toFixed(1) + "%"}
          metricLabel="error rate"
          quote={firstQuote(technicalS)}
        />
        <PriorityCard rank="focus" idx={1}
          icon="◉" color="var(--gold)" accent="rgba(201,162,68,0.05)"
          title={focus?.label ?? "Endgame"}
          sub="Second priority for improvement"
          metric={(Math.min((focus?.rate ?? 0) * 100, 100)).toFixed(1) + "%"}
          metricLabel="error rate"
          quote={firstQuote(careerS)}
        />
        <PriorityCard rank="strength" idx={2}
          icon="✓" color="var(--clr-best)" accent="rgba(94,166,100,0.05)"
          title={bestOpening ? bestOpening.name.split(":")[0].slice(0, 22) : `As ${bestColor}`}
          sub={bestOpening ? "Your strongest opening" : `Perform better with ${bestColor} pieces`}
          metric={bestOpening ? bestOpening.score + "%" : bestScore + "%"}
          metricLabel="score"
          quote={firstQuote(performanceS)}
        />
      </div>

      {/* ④ Conversion Intelligence Dashboard */}
      <ConversionDashboard stats={stats} />

      {/* ⑤ Move-Range Accuracy Chart */}
      <MoveRangeChart stats={stats} />

      {/* ⑥ Performance Analysis — visual-first: colour bars, phase error, blunder distribution + AI text */}
      <PerformanceAnalysisBlock stats={stats} section={performanceS} />

      {/* ⑦ Technical Deep Dive — 4-area cards with specific engine data + AI text */}
      <TechnicalDeepDiveSection stats={stats} section={technicalS} />

      {/* ⑧ Opening Fitness Matrix */}
      <OpeningFitnessMatrix stats={stats} />

      {/* ⑨ Opening Repertoire — per-opening diagnosis with verdict badges */}
      {(openingS?.body || (openingS?.subSections?.length ?? 0) > 0 || openingS?.bullets.length) && (
        <CoachBlock icon="♟" title="Opening Repertoire" badge="DEEP DIAGNOSIS" badgeColor="var(--clr-brilliant)" borderColor="rgba(138,93,245,0.25)" delay="0.10s">
          {openingS?.body && <BodyInsight text={openingS.body} color="var(--clr-brilliant)" />}
          {openingS?.subSections.map((sub, i) => (
            <OpeningSubSection key={i} sub={sub} color="var(--clr-brilliant)" />
          ))}
          {openingS?.bullets.map((b, i) => (
            <InsightBullet key={i} idx={i} text={b} icon="♟" color="var(--clr-brilliant)" accent="rgba(138,93,245,0.05)" />
          ))}
        </CoachBlock>
      )}

      {/* ⑦ Weekly training blueprint (visual grid) */}
      <WeeklyGrid bullets={careerBullets} weakestPhase={stats.weakest_phase} />

      {/* ⑧ Career Development Plan — 3-phase timeline */}
      {(careerS?.body || (careerS?.subSections?.length ?? 0) > 0 || careerBullets.length > 0) && (
        <CareerRoadmap section={careerS} />
      )}

      {/* ⑨ Weekly Study Schedule — structured 7-day cards */}
      {(weeklyS?.body || weeklyS?.bullets.length || (weeklyS?.subSections?.length ?? 0) > 0) && (
        <WeeklyScheduleCards section={weeklyS} />
      )}

      {/* ⑩ Resource Library — category-organised book cards */}
      {(resourceS?.body || resourceBullets.length > 0 || (resourceS?.subSections?.length ?? 0) > 0) && (
        <ResourceLibraryCards section={resourceS} />
      )}

      {/* ⑪ Coach's Verdict — frank personal assessment */}
      {(verdictS?.body || verdictBullets.length > 0 || (verdictS?.subSections?.length ?? 0) > 0) && (
        <div style={{ background: "linear-gradient(135deg, rgba(201,162,68,0.07) 0%, rgba(91,142,245,0.04) 100%)", border: "1px solid rgba(201,162,68,0.45)", borderRadius: 16, overflow: "hidden", animation: "fade-slide-up 0.4s ease 0.20s both" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(201,162,68,0.2)", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--gold)", fontSize: 14 }}>★</span>
            <span style={{ color: "var(--gold)", fontWeight: 900, fontSize: 13, letterSpacing: "0.05em" }}>Coach{"'"}s Verdict</span>
            <span style={{ marginLeft: "auto", background: "rgba(201,162,68,0.12)", color: "var(--gold)", border: "1px solid rgba(201,162,68,0.3)", fontSize: 13, fontWeight: 800, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.1em" }}>GM ASSESSMENT</span>
          </div>
          <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            {verdictS?.body && (
              <p style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.85, fontStyle: "italic" }}>{renderBold(verdictS.body)}</p>
            )}
            {verdictS?.subSections.map((sub, i) => (
              <div key={i}>
                {sub.body.map((b, j) => <BodyInsight key={j} text={b} color="var(--gold)" />)}
                {sub.bullets.map((b, j) => <InsightBullet key={j} idx={j} text={b} icon="★" color="var(--gold)" accent="rgba(201,162,68,0.05)" />)}
              </div>
            ))}
            {verdictBullets.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {verdictBullets.map((b, i) => <InsightBullet key={i} idx={i} text={b} icon="★" color="var(--gold)" accent="rgba(201,162,68,0.05)" />)}
              </div>
            )}
          </div>
        </div>
      )}

      {sections.length === 0 && (
        <p style={{ color: "var(--text-muted)", fontSize: 12 }}>Coach analysis will appear here once the profile is built.</p>
      )}
    </div>
  );
}

// ── Error heatmap ─────────────────────────────────────────────────────────────

function ErrorHeatmap({ moves }: { moves: ProfileStats["worst_moves"] }) {
  // Derive phases from data — works regardless of key format ("Opening" or "Opening (moves 1-15)")
  const phaseOrder = ["Opening", "Middlegame", "Endgame"];
  const normalizePhase = (p: string) => {
    for (const ph of phaseOrder) if (p.toLowerCase().includes(ph.toLowerCase())) return ph;
    return p;
  };
  const types = ["Blunder", "Mistake"];
  const grid: Record<string, Record<string, number>> = {};
  phaseOrder.forEach(p => { grid[p] = {}; types.forEach(t => { grid[p][t] = 0; }); });
  moves.forEach(m => {
    const ph = normalizePhase(m.phase);
    const clf = m.classification?.includes("Blunder") ? "Blunder" : m.classification?.includes("Mistake") ? "Mistake" : null;
    if (ph && clf) grid[ph][clf] = (grid[ph][clf] || 0) + 1;
  });
  const maxVal = Math.max(1, ...phaseOrder.flatMap(p => types.map(t => grid[p][t])));
  const phases = phaseOrder;

  return (
    <div>
      <p style={{ color: "var(--text-muted)", fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>Error Heatmap</p>
      <div style={{ display: "grid", gridTemplateColumns: `100px repeat(${types.length}, 1fr)`, gap: 4 }}>
        <div />
        {types.map(t => (
          <div key={t} style={{ color: "var(--text-muted)", fontSize: 13, fontWeight: 800, textAlign: "center", textTransform: "uppercase", letterSpacing: "0.08em", paddingBottom: 4 }}>{t}</div>
        ))}
        {phases.map(phase => (
          <React.Fragment key={phase}>
            <div style={{ color: "var(--text-secondary)", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center" }}>{phase}</div>
            {types.map(type => {
              const val = grid[phase][type];
              const intensity = val / maxVal;
              const color = type === "Blunder" ? `rgba(224,82,82,${0.1 + intensity * 0.75})` : `rgba(230,168,23,${0.1 + intensity * 0.75})`;
              return (
                <div key={type} title={`${val} ${type}s in ${PHASE_LABELS[phase] ?? phase}`}
                  style={{ height: 40, borderRadius: 8, background: val > 0 ? color : "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.5s ease", border: "1px solid var(--border)" }}>
                  {val > 0 && <span style={{ color: "#fff", fontSize: 14, fontWeight: 900, fontVariantNumeric: "tabular-nums", textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}>{val}</span>}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ── Style DNA Quadrant ────────────────────────────────────────────────────────

function StyleDNAQuadrant({ stats }: { stats: ProfileStats }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useCurrentTheme();
  const dark = theme !== "light";

  const positionalX = Math.min(100, Math.max(0,
    stats.precision_rate * 0.55 + Math.max(0, 100 - Math.min(stats.avg_cp_loss, 80) * 1.1) * 0.45
  ));
  const drawRatePct = stats.total_games > 0 ? (stats.draws / stats.total_games) * 100 : 20;
  const attackingY  = Math.min(100, Math.max(0,
    stats.win_rate * 1.15 - drawRatePct * 0.35 + 10
  ));

  // GM identity colors — same hues in both themes, darkened for light-mode contrast.
  const GM_META = [
    { name: "Tal",       x: 16, y: 90, dark: "#ef4444", light: "#b41e1e" },
    { name: "Fischer",   x: 32, y: 82, dark: "#f97316", light: "#a3450a" },
    { name: "Nakamura",  x: 38, y: 76, dark: "#eab308", light: "#8a6714" },
    { name: "Carlsen",   x: 66, y: 60, dark: "#4ade80", light: "#0c6e2c" },
    { name: "Karpov",    x: 80, y: 36, dark: "#5b8ef5", light: "#2563eb" },
    { name: "Petrosian", x: 88, y: 16, dark: "#8b5cf6", light: "#6d28d9" },
  ];
  const GMs = GM_META.map(g => ({ name: g.name, x: g.x, y: g.y, color: dark ? g.dark : g.light }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const quadTints = dark
      ? ["rgba(239,68,68,0.07)", "rgba(74,222,128,0.07)", "rgba(245,158,11,0.05)", "rgba(91,142,245,0.07)"]
      : ["rgba(180,30,30,0.06)", "rgba(20,140,60,0.06)",  "rgba(138,103,20,0.05)", "rgba(37,99,235,0.06)"];
    const gridStrong = dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.18)";
    const gridWeak   = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
    const frameCol   = dark ? "rgba(255,255,255,0.1)"  : "rgba(0,0,0,0.14)";
    const axisLabel  = dark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.38)";

    const dpr = window.devicePixelRatio || 1;
    const W = 248, H = 248;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const pad = 30, pw = W - pad * 2, ph = H - pad * 2;
    const qx = pad + pw / 2, qy = pad + ph / 2;

    [
      { x: pad,  y: pad,  w: pw/2, h: ph/2, col: quadTints[0] },
      { x: qx,   y: pad,  w: pw/2, h: ph/2, col: quadTints[1] },
      { x: pad,  y: qy,   w: pw/2, h: ph/2, col: quadTints[2] },
      { x: qx,   y: qy,   w: pw/2, h: ph/2, col: quadTints[3] },
    ].forEach(t => { ctx.fillStyle = t.col; ctx.fillRect(t.x, t.y, t.w, t.h); });

    ctx.strokeStyle = gridWeak; ctx.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(pad + pw * i/4, pad); ctx.lineTo(pad + pw * i/4, pad + ph); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad, pad + ph * i/4); ctx.lineTo(pad + pw, pad + ph * i/4); ctx.stroke();
    }
    ctx.strokeStyle = gridStrong; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(qx, pad); ctx.lineTo(qx, pad + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad, qy); ctx.lineTo(pad + pw, qy); ctx.stroke();
    ctx.strokeStyle = frameCol; ctx.strokeRect(pad, pad, pw, ph);

    ctx.font = "700 7px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = axisLabel;
    ctx.fillText("◀ TACTICAL", pad + pw * 0.15, pad - 9);
    ctx.fillText("POSITIONAL ▶", pad + pw * 0.85, pad - 9);
    ctx.save(); ctx.translate(pad - 11, pad + ph * 0.2); ctx.rotate(-Math.PI/2);
    ctx.fillText("ATTACKING ▶", 0, 0); ctx.restore();
    ctx.save(); ctx.translate(pad - 11, pad + ph * 0.8); ctx.rotate(-Math.PI/2);
    ctx.fillText("◀ SOLID", 0, 0); ctx.restore();

    const toX = (pct: number) => pad + (pct / 100) * pw;
    const toY = (pct: number) => pad + ((100 - pct) / 100) * ph;

    GMs.forEach(gm => {
      const gx = toX(gm.x), gy = toY(gm.y);
      ctx.beginPath(); ctx.arc(gx, gy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = gm.color + "45"; ctx.fill();
      ctx.strokeStyle = gm.color; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = gm.color; ctx.font = "700 7px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(gm.name, gx, gy - 7);
    });

    const px = toX(positionalX), py = toY(attackingY);
    const goldCol = dark ? "#C9A84C" : "#8a6714";
    ctx.beginPath(); ctx.arc(px, py, 13, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(201,162,68,0.1)"; ctx.fill();
    ctx.strokeStyle = "rgba(201,162,68,0.3)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(201,162,68,0.25)"; ctx.fill();
    ctx.strokeStyle = goldCol; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = goldCol; ctx.font = "900 9px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("★", px, py);
    ctx.font = "800 8px system-ui, sans-serif"; ctx.textBaseline = "alphabetic";
    ctx.fillText("YOU", px, py - 13);
  }, [positionalX, attackingY, dark]);  // eslint-disable-line react-hooks/exhaustive-deps

  const GMs2 = GMs;

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <canvas ref={canvasRef} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Your style coordinates</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>Tactical↔Positional × Attacking↔Solid. Plotted vs. 6 GM archetypes.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
          {[
            { label: "Positional score", value: Math.round(positionalX), color: "var(--gold)" },
            { label: "Attacking score",  value: Math.round(attackingY),  color: "var(--clr-blunder)" },
          ].map(item => (
            <div key={item.label}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{item.label}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: item.color, fontVariantNumeric: "tabular-nums" as const }}>{item.value}</span>
              </div>
              <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                <div style={{ height: "100%", width: item.value + "%", background: item.color, borderRadius: 2, transition: "width 0.8s ease" }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: "3px 10px", marginTop: 4 }}>
          {GMs2.map(gm => (
            <div key={gm.name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: gm.color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{gm.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Move Heatmap Canvas ───────────────────────────────────────────────────────

function MoveHeatmapCanvas({ moves }: { moves: ProfileStats["worst_moves"] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useCurrentTheme();
  const BUCKET = 5;
  const N = 11; // buckets: 0-4, 5-9, 10-14, … 50-54

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || moves.length === 0) return;
    const dark = theme !== "light";
    const RED    = dark ? "239,68,68"  : "180,30,30";
    const ORANGE = dark ? "249,115,22" : "168,61,15";
    const GREEN  = dark ? "74,222,128" : "20,140,60";
    const BLUE   = dark ? "91,142,245" : "37,99,235";
    const AMBER  = dark ? "245,158,11" : "138,103,20";
    const HI_TEXT = dark ? "255,255,255" : "26,20,16";
    const AXIS_LABEL = dark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.4)";

    const dpr = window.devicePixelRatio || 1;
    const W = 460, H = 130;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const lp = 60, tp = 28, bp = 22;
    const pw = W - lp - 6, rh = (H - tp - bp) / 2, cw = pw / N;

    const blunders = new Array(N).fill(0);
    const mistakes = new Array(N).fill(0);
    moves.forEach(m => {
      const b = Math.min(Math.floor(m.move_number / BUCKET), N - 1);
      if (m.classification?.includes("Blunder")) blunders[b]++;
      else if (m.classification?.includes("Mistake")) mistakes[b]++;
    });
    const maxV = Math.max(1, ...blunders, ...mistakes);

    // Phase stripe labels
    const phases = [
      { label: "Opening (1–15)",     start: 0, end: 3,  col: GREEN },
      { label: "Middlegame (16–35)", start: 3, end: 7,  col: BLUE },
      { label: "Endgame (36+)",      start: 7, end: N,  col: AMBER },
    ];
    phases.forEach(ph => {
      const x1 = lp + ph.start * cw, x2 = lp + ph.end * cw;
      ctx.fillStyle = `rgba(${ph.col},0.05)`; ctx.fillRect(x1, tp, x2 - x1, rh * 2);
      ctx.fillStyle = `rgba(${ph.col},0.19)`; ctx.fillRect(x1, tp - 18, x2 - x1 - 1, 14);
      ctx.fillStyle = `rgb(${ph.col})`; ctx.font = "700 7px system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(ph.label, (x1 + x2) / 2, tp - 11);
    });

    // Row labels
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.fillStyle = `rgb(${RED})`; ctx.font = "700 8px system-ui, sans-serif";
    ctx.fillText("Blunders", lp - 4, tp + rh / 2);
    ctx.fillStyle = `rgb(${ORANGE})`;
    ctx.fillText("Mistakes", lp - 4, tp + rh + rh / 2);

    for (let b = 0; b < N; b++) {
      const x = lp + b * cw;
      const bv = blunders[b] / maxV, mv = mistakes[b] / maxV;
      ctx.fillStyle = `rgba(${RED},${0.06 + bv * 0.84})`;
      ctx.fillRect(x + 1, tp + 1, cw - 2, rh - 2);
      if (blunders[b] > 0) {
        ctx.fillStyle = bv > 0.5 ? `rgba(${HI_TEXT},0.9)` : `rgb(${RED})`;
        ctx.font = `${bv > 0.6 ? "900" : "700"} 10px system-ui, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(blunders[b]), x + cw / 2, tp + rh / 2);
      }
      ctx.fillStyle = `rgba(${ORANGE},${0.06 + mv * 0.84})`;
      ctx.fillRect(x + 1, tp + rh + 1, cw - 2, rh - 2);
      if (mistakes[b] > 0) {
        ctx.fillStyle = mv > 0.5 ? `rgba(${HI_TEXT},0.9)` : `rgb(${ORANGE})`;
        ctx.font = `${mv > 0.6 ? "900" : "700"} 10px system-ui, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(mistakes[b]), x + cw / 2, tp + rh + rh / 2);
      }
      ctx.fillStyle = AXIS_LABEL;
      ctx.font = "600 7px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(`${b * BUCKET + 1}`, x + cw / 2, tp + rh * 2 + 4);
    }
  }, [moves, theme]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (moves.length === 0) return null;
  return (
    <div style={{ overflowX: "auto" }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

// ── Opening Gap Map ───────────────────────────────────────────────────────────

function OpeningGapMap({ stats }: { stats: ProfileStats }) {
  if (!stats.top_openings || stats.top_openings.length < 2) return null;
  const rows = stats.top_openings.map(([name, d]) => ({
    name: name.split(":")[0].trim().slice(0, 34),
    score: d.count > 0 ? Math.round(((d.wins ?? 0) + (d.draws ?? 0) * 0.5) / d.count * 100) : 0,
    count: d.count,
  })).filter(r => r.count >= 2).sort((a, b) => b.count - a.count);
  if (rows.length === 0) return null;
  const gaps = rows.filter(r => r.score < 45);
  const sc = (s: number) => s >= 65
    ? { color: "var(--clr-best)",    bg: "var(--tint-green)", border: "var(--border-green)" }
    : s >= 45
    ? { color: "var(--accent-amber)", bg: "var(--tint-gold)", border: "var(--border-gold)" }
    : { color: "var(--clr-blunder)", bg: "var(--tint-red)",   border: "var(--border-red)" };
  const lb = (s: number) => s >= 65 ? "STRENGTH" : s >= 45 ? "AVERAGE" : "NEEDS WORK";
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "11px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--clr-blunder)", fontSize: 13 }}>△</span>
        <span style={{ fontWeight: 800, fontSize: 12, color: "var(--text-primary)" }}>Repertoire Gap Detection</span>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--text-muted)" }}>{gaps.length} gap{gaps.length !== 1 ? "s" : ""} · {rows.filter(r => r.score >= 65).length} strength{rows.filter(r => r.score >= 65).length !== 1 ? "s" : ""}</span>
      </div>
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 7 }}>
        {rows.slice(0, 7).map(r => (
          <div key={r.name} style={{ display: "grid", gridTemplateColumns: "1fr 52px 80px 72px", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{r.name}</div>
            <div style={{ height: 18, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: r.score + "%", background: sc(r.score).color, opacity: 0.75, transition: "width 0.8s ease" }} />
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, color: sc(r.score).color, fontVariantNumeric: "tabular-nums" as const, textAlign: "right" as const }}>{r.score}% · {r.count}g</div>
            <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.06em", color: sc(r.score).color, textAlign: "center" as const, background: sc(r.score).bg, border: `1px solid ${sc(r.score).border}`, borderRadius: 4, padding: "2px 5px" }}>{lb(r.score)}</div>
          </div>
        ))}
      </div>
      {gaps.length > 0 && (
        <div style={{ padding: "9px 16px 11px", borderTop: "1px solid var(--border)", background: "var(--tint-red)" }}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
            <span style={{ color: "var(--clr-blunder)", fontWeight: 800 }}>Priority: </span>
            {gaps.slice(0, 2).map(g => g.name).join(" and ")} score{gaps.length > 1 ? "" : "s"} below 45% — study these sublines first to close the biggest Elo gap.
          </span>
        </div>
      )}
    </div>
  );
}

// ── Skill row ─────────────────────────────────────────────────────────────────

function SkillRow({ label, tooltip, score }: { label: string; tooltip: string; score: number }) {
  const t = tierColor(score);
  return (
    <div style={{ padding: "9px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 600 }}>{label}</span>
          <span title={tooltip} style={{ color: "var(--text-muted)", fontSize: 13, cursor: "help" }}>ⓘ</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: t.color, textTransform: "uppercase" as const, letterSpacing: "0.06em", background: t.bg, border: `1px solid ${t.border}`, padding: "1px 6px", borderRadius: 4 }}>{t.label}</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: t.color, fontVariantNumeric: "tabular-nums" as const, minWidth: 28, textAlign: "right" as const }}>{Math.round(score)}</span>
        </div>
      </div>
      <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: Math.min(score, 100) + "%", background: t.color, borderRadius: 3, transition: "width 0.85s ease", opacity: 0.9 }} />
      </div>
    </div>
  );
}

// ── Skills Assessment ─────────────────────────────────────────────────────────

function SkillsAssessment({ stats }: { stats: ProfileStats }) {
  const per = stats.phase_error_rate;
  const openKey = Object.keys(per).find(k => k.toLowerCase().includes("open")) ?? "";
  const midKey  = Object.keys(per).find(k => k.toLowerCase().includes("mid"))  ?? "";
  const endKey  = Object.keys(per).find(k => k.toLowerCase().includes("end"))  ?? "";
  const mra = stats.move_range_accuracy ?? {};
  const phaseScore = (key: string) => Math.max(0, Math.min(100, 100 - (per[key] ?? 0.2) * 350));
  const timeMgmt   = Math.max(0, Math.min(100, 100 - (mra["50+"] ?? mra["31-50"] ?? 20)));

  const psychology: { label: string; tooltip: string; score: number }[] = [
    { label: "Decisiveness",      tooltip: "% of winning positions (+150cp) converted to actual wins",                     score: stats.conversion_rate ?? 0 },
    { label: "Pressure Handling", tooltip: "Accuracy in positions where you have an advantage — avoiding collapse",         score: Math.max(0, Math.min(100, 100 - (stats.winning_error_rate ?? 0))) },
    { label: "Resilience",        tooltip: "How well you avoid further errors when already in a losing position",           score: Math.max(0, Math.min(100, 100 - (stats.losing_error_rate  ?? 0))) },
    { label: "Consistency",       tooltip: "% of games with zero blunders — error-free game rate",                         score: stats.clean_game_rate },
    { label: "Time Management",   tooltip: "CP loss in later game stages — lower late-game deterioration = better score",  score: timeMgmt },
  ];

  const skills: { label: string; tooltip: string; score: number }[] = [
    { label: "Opening Precision",   tooltip: "Inverted opening phase error rate from Stockfish engine analysis",    score: phaseScore(openKey) },
    { label: "Middlegame Strength", tooltip: "Inverted middlegame error rate — primary weakness if low",            score: phaseScore(midKey) },
    { label: "Endgame Technique",   tooltip: "Inverted endgame phase error rate from Stockfish",                   score: phaseScore(endKey) },
    { label: "White Performance",   tooltip: "Score % with White pieces (Win=1, Draw=0.5, Loss=0)",                score: stats.white_score_pct ?? 0 },
    { label: "Black Performance",   tooltip: "Score % with Black pieces",                                          score: stats.black_score_pct ?? 0 },
    { label: "Conversion",          tooltip: "Rate of converting winning positions — the single biggest Elo driver", score: stats.conversion_rate ?? 0 },
    { label: "Move Quality",        tooltip: "Precision rate — % of accurate and strong moves out of total",       score: stats.precision_rate },
  ];

  const tierLegend = [
    { label: "Exceptional ≥80", color: "var(--clr-best)" },
    { label: "Excellent 60–79", color: "var(--accent-blue)" },
    { label: "Needs Work 40–59", color: "var(--accent-amber)" },
    { label: "Urgent <40",       color: "var(--clr-blunder)" },
  ];

  const radarAxes = [
    { label: "Opening\nPrep",      score: phaseScore(openKey) },
    { label: "Middlegame",         score: phaseScore(midKey) },
    { label: "Endgame\nTech",      score: phaseScore(endKey) },
    { label: "Move\nQuality",      score: Math.min(stats.precision_rate, 100) },
    { label: "Conversion",         score: Math.min(stats.conversion_rate ?? 0, 100) },
    { label: "Pressure\nHandling", score: Math.max(0, 100 - (stats.winning_error_rate ?? 0)) },
    { label: "Resilience",         score: Math.max(0, 100 - (stats.losing_error_rate ?? 0)) },
    { label: "Consistency",        score: Math.min(stats.clean_game_rate * 1.3, 100) },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: "fade-slide-up 0.22s ease" }}>

      <SectionBanner icon="◈" title="Skills Assessment" desc="8-dimension skill radar, GM archetype map, and chess psychology scores" iconColor="var(--accent-blue)" />

      {/* 8D Radar + legend */}
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px" }}>
        <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.12em", color: "var(--text-muted)", marginBottom: 16 }}>8-Dimension Skill Radar</div>
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" as const }}>
          <RadarChart8D axes={radarAxes} />
          <div style={{ flex: 1, minWidth: 160, display: "flex", flexDirection: "column" as const, gap: 6 }}>
            {radarAxes.map(a => {
              const t = tierColor(a.score);
              return (
                <div key={a.label.replace("\n", " ")} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>{a.label.replace("\n", " ")}</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: t.color, fontVariantNumeric: "tabular-nums" as const }}>{Math.round(a.score)}</span>
                    </div>
                    <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: a.score + "%", background: t.color, borderRadius: 2, transition: "width 0.8s ease" }} />
                    </div>
                  </div>
                </div>
              );
            })}
            {/* Legend */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, marginTop: 6, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              {tierLegend.map(tl => (
                <div key={tl.label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--text-muted)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: tl.color, flexShrink: 0 }} />
                  {tl.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Style DNA Quadrant */}
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px" }}>
        <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.12em", color: "var(--text-muted)", marginBottom: 16 }}>Style DNA — GM Archetype Map</div>
        <StyleDNAQuadrant stats={stats} />
      </div>

      <div style={{ background: "rgba(201,162,68,0.06)", border: "1px solid rgba(201,162,68,0.18)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "var(--gold-light)", display: "flex", gap: 8, alignItems: "flex-start" }}>
        <span style={{ color: "var(--gold)", fontSize: 14, flexShrink: 0 }}>◈</span>
        <span>All scores are <strong style={{ color: "var(--gold)", fontWeight: 800 }}>computed deterministically</strong> from Stockfish engine data — same PGN always produces the same scores.</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 14, display: "flex", alignItems: "center", gap: 6, color: "var(--text-primary)" }}>
            <span style={{ color: "var(--gold)" }}>◉</span> Chess Psychology
          </div>
          {psychology.map(s => <SkillRow key={s.label} label={s.label} tooltip={s.tooltip} score={s.score} />)}
        </div>
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 14, display: "flex", alignItems: "center", gap: 6, color: "var(--text-primary)" }}>
            <span style={{ color: "var(--accent-blue)" }}>◈</span> Chess Skills
          </div>
          {skills.map(s => <SkillRow key={s.label} label={s.label} tooltip={s.tooltip} score={s.score} />)}
        </div>
      </div>
    </div>
  );
}

// ── Psychology section ────────────────────────────────────────────────────────

function PsychSection({ stats }: { stats: ProfileStats }) {
  const tiltResistance = Math.max(0, Math.min(100, 100 - (stats.squander_rate ?? 0)));
  const clutchFactor   = Math.min(100, stats.conversion_rate ?? 0);
  const pressureHndl   = Math.max(0, 100 - (stats.winning_error_rate ?? 0));
  const drawRatePct    = stats.total_games > 0 ? (stats.draws / stats.total_games) * 100 : 20;
  const fightingSpirit = Math.min(100, Math.max(0, 100 - drawRatePct * 1.3));

  // Fighting Chess Index (after Smerdon 2017): penalises draws, especially short ones
  const fci = Math.round(Math.max(0, Math.min(100, 100 - drawRatePct * 1.3)));

  const tierLbl = (v: number) => tierColor(v).label;

  const dials = [
    { label: "Tilt Resistance",   value: tiltResistance, tip: "Inverse of squander rate — how stable you are when ahead" },
    { label: "Clutch Factor",     value: clutchFactor,   tip: "% of +150cp positions successfully converted to wins" },
    { label: "Pressure Handling", value: pressureHndl,   tip: "Accuracy when winning — high error rate here = collapse risk" },
    { label: "Fighting Spirit",   value: fightingSpirit, tip: "Decisiveness index — fewer draws = more decisive play" },
  ];

  const overallPsych = Math.round((tiltResistance + clutchFactor + pressureHndl + fightingSpirit) / 4);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionBanner icon="◉" title="Psychological Profile" desc={`Mental game metrics from ${stats.total_games} games · Overall score: ${overallPsych}/100 (${tierLbl(overallPsych)})`} iconColor="var(--accent-blue)" />

      {/* 4 dial gauges */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {dials.map(d => (
          <div key={d.label} style={{ background: "var(--bg-surface)", border: `1px solid ${tierColor(d.value).border}`, borderRadius: 12, padding: "14px 12px 10px", display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 4 }}>
            <PsychDial value={d.value} color={tierColor(d.value).color} size={84} />
            <div style={{ fontSize: 18, fontWeight: 900, color: tierColor(d.value).color, fontVariantNumeric: "tabular-nums" as const, lineHeight: 1, marginTop: 4 }}>{Math.round(d.value)}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", textAlign: "center" as const, lineHeight: 1.3 }}>{d.label}</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: tierColor(d.value).color, textTransform: "uppercase" as const, letterSpacing: "0.06em", background: tierColor(d.value).bg, border: `1px solid ${tierColor(d.value).border}`, padding: "2px 7px", borderRadius: 4, marginTop: 2 }}>{tierLbl(d.value)}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center" as const, lineHeight: 1.35, marginTop: 3 }}>{d.tip}</div>
          </div>
        ))}
      </div>

      {/* Breakdown cards row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>

        {/* Conversion breakdown */}
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-primary)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--clr-best)" }}>◎</span> Conversion Intelligence
          </div>
          {[
            { label: "Winning positions reached",    value: stats.games_reached_winning ?? 0,      total: stats.total_games, fmt: "count" },
            { label: "Successfully converted",        value: stats.games_converted_from_winning ?? 0, total: stats.games_reached_winning ?? 1, fmt: "pct" },
            { label: "Squandered advantages",         value: stats.games_squandered ?? 0,            total: stats.games_reached_winning ?? 1, fmt: "pct-bad" },
          ].map(row => {
            const pct = row.fmt === "count" ? (row.value / (stats.total_games || 1)) * 100 : (row.value / (row.total || 1)) * 100;
            const barColor = row.fmt === "pct-bad" ? "var(--clr-blunder)" : "var(--clr-best)";
            return (
              <div key={row.label} style={{ marginBottom: 9 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{row.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" as const }}>{row.value}</span>
                </div>
                <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                  <div style={{ height: "100%", width: Math.min(pct, 100) + "%", background: barColor, borderRadius: 2, transition: "width 0.8s ease", opacity: 0.85 }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Pressure breakdown */}
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-primary)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--accent-blue)" }}>◈</span> Pressure & Resilience
          </div>
          {[
            { label: "Error rate when winning",  value: stats.winning_error_rate, unit: "%", invert: true },
            { label: "Error rate when losing",   value: stats.losing_error_rate,  unit: "%", invert: true },
            { label: "Draw rate",                value: drawRatePct,              unit: "%", invert: false },
            { label: "Clean games (no blunders)", value: stats.clean_game_rate,   unit: "%", invert: false },
          ].map(row => {
            const barColor = row.invert
              ? (row.value < 15 ? "var(--clr-best)" : row.value < 30 ? "var(--accent-amber)" : "var(--clr-blunder)")
              : (row.value > 60 ? "var(--clr-best)" : row.value > 40 ? "var(--accent-blue)" : "var(--accent-amber)");
            return (
              <div key={row.label} style={{ marginBottom: 9 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{row.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" as const }}>{Math.round(row.value)}{row.unit}</span>
                </div>
                <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                  <div style={{ height: "100%", width: Math.min(row.value, 100) + "%", background: barColor, borderRadius: 2, transition: "width 0.8s ease", opacity: 0.85 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* FCI card + Decisive game rate */}
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <div style={{ textAlign: "center" as const }}>
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 6 }}>Fighting Chess Index</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: tierColor(fci).color, fontVariantNumeric: "tabular-nums" as const, lineHeight: 1 }}>{fci}</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: tierColor(fci).color, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginTop: 4 }}>{tierLbl(fci)}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>Smerdon 2017 · FCI = 100 − draw_rate×1.3</div>
          </div>
          <div style={{ textAlign: "center" as const }}>
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 6 }}>Decisive Games</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: tierColor(100 - drawRatePct).color, fontVariantNumeric: "tabular-nums" as const, lineHeight: 1 }}>{Math.round(100 - drawRatePct)}%</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 7 }}>{stats.wins + stats.losses} decisive · {stats.draws} drawn</div>
          </div>
          <div style={{ textAlign: "center" as const }}>
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 6 }}>Squander Rate</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: (stats.squander_rate ?? 0) > 30 ? "var(--clr-blunder)" : (stats.squander_rate ?? 0) > 15 ? "var(--accent-amber)" : "var(--clr-best)", fontVariantNumeric: "tabular-nums" as const, lineHeight: 1 }}>{Math.round(stats.squander_rate ?? 0)}%</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 7 }}>{stats.games_squandered ?? 0} of {stats.games_reached_winning ?? 0} wins dropped</div>
          </div>
        </div>
      </div>

      {/* Coaching insight strip */}
      <div style={{ background: "rgba(91,142,245,0.06)", border: "1px solid rgba(91,142,245,0.15)", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1, color: "var(--accent-blue)" }}>◈</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>GM Coach Insight</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {overallPsych >= 70
              ? `Strong mental game — ${stats.player_name} handles pressure well and converts advantages at a high rate (FCI ${fci}/100). Focus on eliminating the remaining squander cases with concrete endgame technique.`
              : overallPsych >= 50
              ? `Mixed psychological profile (FCI ${fci}/100). Clutch factor and pressure handling suggest room to improve decision-making in critical moments. Practice converting +2 pawn advantages against a computer in training mode.`
              : `Mental game is the primary growth area (FCI ${fci}/100). Frequent errors in winning positions and a squander rate of ${Math.round(stats.squander_rate ?? 0)}% indicate anxiety in technical positions. Implement a hard stop rule after 2 consecutive losses and study Shereshevsky's endgame technique.`
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Summary section ───────────────────────────────────────────────────────────

function SummarySection({ stats, ratingHistory }: { stats: ProfileStats; ratingHistory: RatingHistoryEntry[] }) {
  const per = stats.phase_error_rate;
  const openKey = Object.keys(per).find(k => k.toLowerCase().includes("open")) ?? "";
  const midKey  = Object.keys(per).find(k => k.toLowerCase().includes("mid"))  ?? "";
  const endKey  = Object.keys(per).find(k => k.toLowerCase().includes("end"))  ?? "";
  const phaseScore = (key: string) => Math.max(0, Math.min(100, 100 - (per[key] ?? 0.2) * 350));
  const bxp = stats.blunder_by_phase ?? {};
  const scoreColor = (s: number) => s >= 80 ? "var(--clr-best)" : s >= 60 ? "var(--accent-blue)" : s >= 40 ? "var(--gold)" : "var(--clr-blunder)";

  const phases = [
    { label: "Opening",    key: openKey, score: phaseScore(openKey), errorPct: Math.min((per[openKey] ?? 0) * 100, 100), blunders: bxp["Opening"] ?? 0 },
    { label: "Middlegame", key: midKey,  score: phaseScore(midKey),  errorPct: Math.min((per[midKey]  ?? 0) * 100, 100), blunders: bxp["Middlegame"] ?? 0 },
    { label: "Endgame",    key: endKey,  score: phaseScore(endKey),  errorPct: Math.min((per[endKey]  ?? 0) * 100, 100), blunders: bxp["Endgame"] ?? 0 },
  ];

  const convRate = stats.conversion_rate ?? 0;
  const squRate  = stats.squander_rate   ?? 0;
  const eloLoss  = Math.round(squRate / 10 * 18);
  const weakestPhase = phases.reduce((a, b) => a.errorPct > b.errorPct ? a : b);

  const styleTag = deriveStyleTag(stats);
  const colorDelta = Math.round(Math.abs((stats.white_score_pct ?? 0) - (stats.black_score_pct ?? 0)));
  const betterColor = (stats.white_score_pct ?? 0) >= (stats.black_score_pct ?? 0) ? "White" : "Black";
  const colorAccent = betterColor === "White" ? "var(--gold)" : "var(--accent-blue)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: "fade-slide-up 0.22s ease" }}>

      <SectionBanner icon="◎" title="Performance Summary" desc={`${stats.player_name} · ${stats.total_games} games analysed · Overall performance overview`} iconColor="var(--gold)" />

      {/* Player Identity Card */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: styleTag.bg, border: `1px solid ${styleTag.border}`, borderRadius: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: `color-mix(in srgb, ${styleTag.color} 9%, transparent)`, border: `1px solid ${styleTag.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{styleTag.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 3 }}>Playing Identity</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: styleTag.color, lineHeight: 1 }}>{styleTag.tag}</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 3 }}>{styleTag.sub}</div>
        </div>
        {colorDelta > 0 && (
          <div style={{ textAlign: "right" as const, flexShrink: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 4 }}>Color Advantage</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: colorAccent, fontVariantNumeric: "tabular-nums" as const }}>{betterColor} +{colorDelta}%</div>
          </div>
        )}
      </div>

      {/* ELO + phase arcs row */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, alignItems: "start" }}>
        <div style={{ background: "linear-gradient(135deg, rgba(201,162,68,0.12), rgba(201,162,68,0.04))", border: "1px solid rgba(201,162,68,0.22)", borderRadius: 12, padding: "16px 18px", minWidth: 148 }}>
          <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 6 }}>Estimated ELO</div>
          <div style={{ fontSize: 32, fontWeight: 900, color: "var(--gold)", fontVariantNumeric: "tabular-nums" as const, lineHeight: 1 }}>
            {(stats.display_elo ?? 0) > 0 ? `~${stats.display_elo}` : "N/A"}
          </div>
          <div style={{ fontSize: 12, color: "var(--gold-light)", marginTop: 3, fontWeight: 700 }}>
            {stats.elo_source === "pgn_headers" ? "Rated" : "CP-loss model"}
          </div>
          {ratingHistory.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(201,162,68,0.2)" }}>
              <HeroSparkline history={ratingHistory} />
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {phases.map(p => (
            <div key={p.label} style={{ flex: 1, background: "var(--bg-surface)", border: p.key === stats.weakest_phase ? "1px solid rgba(239,68,68,0.3)" : "1px solid var(--border)", borderRadius: 12, padding: "14px 10px", textAlign: "center" as const }}>
              <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: p.key === stats.weakest_phase ? "var(--clr-blunder)" : "var(--text-muted)", marginBottom: 6 }}>
                {p.label} {p.key === stats.weakest_phase ? "◀" : ""}
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, color: scoreColor(p.score), fontVariantNumeric: "tabular-nums" as const }}>{Math.round(p.score)}%</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: scoreColor(p.score), marginTop: 2, fontVariantNumeric: "tabular-nums" as const }}>{p.errorPct.toFixed(1)}% err</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>{p.blunders} blunders</div>
            </div>
          ))}
        </div>
      </div>

      {/* Stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {([
          { label: "Win Rate",    value: `${stats.win_rate}%`,       color: stats.win_rate > 50 ? "var(--clr-best)" : "var(--clr-blunder)", sub: `${stats.wins}W · ${stats.draws}D · ${stats.losses}L` },
          { label: "Avg CP Loss", value: `${stats.avg_cp_loss}`,     color: stats.avg_cp_loss < 30 ? "var(--clr-best)" : stats.avg_cp_loss < 50 ? "var(--gold)" : "var(--accent-amber)", sub: "per player move" },
          { label: "Precision",   value: `${stats.precision_rate}%`, color: stats.precision_rate > 60 ? "var(--accent-blue)" : "var(--gold)", sub: "accurate + strong" },
          { label: "Clean Games", value: `${stats.clean_game_rate}%`,color: stats.clean_game_rate > 50 ? "var(--clr-best)" : "var(--gold)", sub: `${stats.clean_games} of ${stats.total_games}` },
          { label: "Conversion",  value: convRate > 0 ? `${convRate.toFixed(0)}%` : "—", color: convRate >= 60 ? "var(--clr-best)" : convRate >= 40 ? "var(--gold)" : "var(--clr-blunder)", sub: "from winning pos." },
          { label: "Total Moves", value: `${stats.total_player_moves}`, color: "var(--text-secondary)", sub: "player moves analysed" },
        ] as { label: string; value: string; color: string; sub: string }[]).map(s => (
          <div key={s.label} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", textAlign: "center" as const }}>
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: s.color, fontVariantNumeric: "tabular-nums" as const, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Key insight */}
      {squRate > 0 && (
        <div style={{ background: "rgba(201,162,68,0.06)", border: "1px solid rgba(201,162,68,0.18)", borderRadius: 10, padding: "12px 16px", display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, lineHeight: 1.6, color: "var(--gold-light)" }}>
          <span style={{ color: "var(--gold)", fontSize: 16, flexShrink: 0 }}>⚑</span>
          <span>
            <strong style={{ color: "var(--gold)", fontWeight: 800 }}>Critical insight:</strong>{" "}
            You squander {squRate.toFixed(0)}% of winning positions — this costs an estimated <strong style={{ color: "var(--gold)", fontWeight: 800 }}>~{eloLoss} Elo points</strong>.{" "}
            <strong style={{ color: "var(--gold)", fontWeight: 800 }}>{weakestPhase.label}</strong> is your primary error phase at {weakestPhase.errorPct.toFixed(1)}% error rate.
          </span>
        </div>
      )}

      {/* Colour bars */}
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px" }}>
        <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 14 }}>Colour Performance</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <ColorBar label="White" wins={stats.white_wins} draws={stats.white_draws} losses={stats.as_white - stats.white_wins - stats.white_draws} score={Math.round(stats.white_score_pct ?? 0)} total={stats.as_white} />
          <ColorBar label="Black" wins={stats.black_wins} draws={stats.black_draws} losses={stats.as_black - stats.black_wins - stats.black_draws} score={Math.round(stats.black_score_pct ?? 0)} total={stats.as_black} />
        </div>
      </div>

      {/* Radar + move range */}
      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 14, alignItems: "start" }}>
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <PerfRadar stats={stats} />
        </div>
        <MoveRangeChart stats={stats} />
      </div>
    </div>
  );
}

// ── Opening Analysis section ──────────────────────────────────────────────────

function OpeningAnalysisSection({ stats }: { stats: ProfileStats }) {
  const bestScore = stats.top_openings.length > 0
    ? Math.max(...stats.top_openings.map(([, d]) => d.count > 0 ? Math.round(((d.wins ?? 0) + (d.draws ?? 0) * 0.5) / d.count * 100) : 0))
    : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: "fade-slide-up 0.22s ease" }}>
      <SectionBanner icon="◆" title="Opening Analysis" desc="Repertoire performance, gap map, and opening fitness matrix" iconColor="var(--clr-best)" />
      <OpeningGapMap stats={stats} />
      <OpeningFitnessMatrix stats={stats} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {stats.top_openings.slice(0, 6).map(([name, data], idx) => {
          const w = data.wins ?? 0, d = data.draws ?? 0;
          const score = data.count > 0 ? Math.round(((w + d * 0.5) / data.count) * 100) : 0;
          return <OpeningCard key={name} name={name} data={data as { count: number; wins?: number; draws?: number; losses?: number; avg_cp_theory?: number }} idx={idx} isBest={score === bestScore && score > 0} />;
        })}
      </div>
    </div>
  );
}

// ── Position Puzzle Modal ─────────────────────────────────────────────────────

type WorstMove = ProfileStats["worst_moves"][0];

function generateMoveExplanation(m: WorstMove): { whyBad: string; whyBest: string } {
  const ctx = m.pos_context ?? "equal";
  const cp = m.cp_loss;
  const isBlunder = m.classification === "Blunder";
  const phase = m.phase?.toLowerCase().includes("end") ? "endgame" : "middlegame";

  const ctxPhrase =
    ctx === "winning"  ? "from a winning position" :
    ctx === "losing"   ? "from a losing position" :
    "from a balanced position";

  let whyBad = "";
  if (isBlunder && cp > 300) {
    whyBad = `Playing **${m.san}** (−${cp}cp) ${ctxPhrase} is a severe error — it likely allows a decisive tactical response, loses a piece outright, or abandons a key defensive resource. After this move the engine evaluation shifts dramatically in the opponent's favour.`;
  } else if (isBlunder) {
    whyBad = `**${m.san}** (−${cp}cp) ${ctxPhrase} is a critical error in the ${phase}. It either misses an opponent's threat, creates a fatal weakness, or allows a combination that the engine exploits immediately.`;
  } else {
    whyBad = `**${m.san}** (−${cp}cp) is a significant inaccuracy ${ctxPhrase}. While not immediately losing, it concedes a meaningful advantage — relaxing tension at the wrong moment, moving a well-placed piece, or failing to address the key imbalance in the position.`;
  }

  const whyBest = `**${m.best_san}** is the engine's top recommendation because it either (a) maintains control of the position's key tension, (b) exploits the most forcing continuation available, or (c) finds the optimal defensive resource. Playing this move keeps the position in line with the evaluation before your move.`;

  return { whyBad, whyBest };
}

function PuzzleModal({ move, onClose }: { move: WorstMove; onClose: () => void }) {
  const hasFen = Boolean(move.fen);
  const [fen, setFen] = useState(move.fen ?? "");
  const [solveState, setSolveState] = useState<"idle" | "correct" | "wrong" | "shown">("idle");
  const [hintLevel, setHintLevel] = useState(0);
  const [message, setMessage] = useState("");
  const chessRef = useRef<Chess | null>(null);

  const playerIsWhite = (move.fen ?? "").split(" ")[1] !== "b";
  const colorLabel = playerIsWhite ? "White" : "Black";

  useEffect(() => {
    if (move.fen) {
      chessRef.current = new Chess(move.fen);
      setFen(move.fen);
      setSolveState("idle");
      setHintLevel(0);
      setMessage(`Find the best move for ${colorLabel} — the engine's choice instead of ${move.san}.`);
    }
  }, [move.fen, colorLabel, move.san]);

  const onPieceDrop = useCallback(({ sourceSquare: from, targetSquare: toOrNull }: PieceDropHandlerArgs) => {
    if (!chessRef.current || !toOrNull || solveState !== "idle") return false;
    const to = toOrNull;
    try {
      const result = chessRef.current.move({ from, to, promotion: "q" });
      if (!result) return false;
    } catch { return false; }

    const played = chessRef.current.history({ verbose: true }).slice(-1)[0];
    const playedSan = played?.san ?? "";
    setFen(chessRef.current.fen());

    const uciPlayed = `${from}${to}`;
    const isCorrect = playedSan === move.best_san || uciPlayed === (move.best_move_uci ?? "");

    if (isCorrect) {
      setSolveState("correct");
      setMessage(`Correct! ${move.best_san} is the engine's best move.`);
    } else {
      setSolveState("wrong");
      setMessage(`Not quite — you played ${playedSan}. Engine recommends ${move.best_san}.`);
    }
    return true;
  }, [move.best_san, move.best_move_uci, solveState]);

  const retry = useCallback(() => {
    if (!move.fen) return;
    chessRef.current = new Chess(move.fen);
    setFen(move.fen);
    setSolveState("idle");
    setHintLevel(0);
    setMessage(`Find the best move for ${colorLabel}.`);
  }, [move.fen, colorLabel]);

  const showSolution = useCallback(() => {
    if (!move.fen) return;
    chessRef.current = new Chess(move.fen);
    try { chessRef.current.move(move.best_san); } catch { /* ignore invalid san */ }
    setFen(chessRef.current.fen());
    setSolveState("shown");
    setMessage(`Solution: ${move.best_san} — this maintains the evaluation advantage.`);
  }, [move.fen, move.best_san]);

  const hintSquares = useMemo<Record<string, { backgroundColor: string }>>(() => {
    if (hintLevel === 0 || !move.best_move_uci || move.best_move_uci.length < 4) return {};
    const fromSq = move.best_move_uci.slice(0, 2);
    const toSq   = move.best_move_uci.slice(2, 4);
    if (hintLevel === 1) return { [fromSq]: { backgroundColor: "rgba(255,209,102,0.45)" } };
    return {
      [fromSq]: { backgroundColor: "rgba(255,209,102,0.45)" },
      [toSq]:   { backgroundColor: "rgba(255,209,102,0.35)" },
    };
  }, [hintLevel, move.best_move_uci]);

  const { whyBad, whyBest } = generateMoveExplanation(move);
  const isBlunder = move.classification === "Blunder";
  const clColor = isBlunder ? "var(--clr-blunder)" : "var(--gold)";

  // Close on backdrop click
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div onClick={handleBackdrop} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", overflowY: "auto" }}>
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 20, width: "100%", maxWidth: 820, maxHeight: "92vh", overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 800, background: isBlunder ? "var(--tint-red)" : "var(--tint-gold)", color: clColor, border: `1px solid ${isBlunder ? "var(--border-red)" : "var(--border-gold)"}`, borderRadius: 4, padding: "2px 8px", letterSpacing: "0.1em", textTransform: "uppercase" as const }}>
            {move.classification}
          </span>
          <span style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 14 }}>
            Move {move.move_number} — you played <span style={{ fontFamily: "var(--font-mono)", color: clColor }}>{move.san}</span> (−{move.cp_loss}cp)
          </span>
          <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 13 }}>Game {move.game}</span>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: "0 4px", marginLeft: 4 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ display: "grid", gridTemplateColumns: hasFen ? "1fr 1fr" : "1fr", gap: 0, flex: 1, minHeight: 0, overflow: "hidden" }}>

          {/* Chess board panel */}
          {hasFen && (
            <div style={{ padding: 16, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>
                {colorLabel} to play — find the engine&apos;s recommendation
              </div>
              <div style={{ borderRadius: 10, overflow: "hidden" }}>
                <ProfileChessboard
                  options={{
                    position: fen,
                    onPieceDrop: onPieceDrop,
                    boardOrientation: (playerIsWhite ? "white" : "black") as "white" | "black",
                    squareStyles: hintSquares,
                    allowDragging: solveState === "idle",
                    boardStyle: { borderRadius: 8 },
                  }}
                />
              </div>

              {/* State message */}
              {message && (
                <div style={{
                  padding: "10px 12px", borderRadius: 8, fontSize: 13, lineHeight: 1.5, fontWeight: 600,
                  background: solveState === "correct" ? "rgba(74,222,128,0.1)" : solveState === "wrong" ? "rgba(239,68,68,0.1)" : solveState === "shown" ? "rgba(91,142,245,0.1)" : "var(--bg-elevated)",
                  color: solveState === "correct" ? "var(--clr-best)" : solveState === "wrong" ? "var(--clr-blunder)" : solveState === "shown" ? "var(--accent-blue)" : "var(--text-secondary)",
                  border: `1px solid ${solveState === "correct" ? "rgba(74,222,128,0.3)" : solveState === "wrong" ? "rgba(239,68,68,0.3)" : solveState === "shown" ? "rgba(91,142,245,0.3)" : "var(--border)"}`,
                }}>
                  {solveState === "correct" && "✓ "}{solveState === "wrong" && "✗ "}{message}
                </div>
              )}

              {/* Controls */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                {solveState === "idle" && (
                  <button onClick={() => setHintLevel(h => Math.min(h + 1, 2))} style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    {hintLevel === 0 ? "Hint (piece)" : "Hint (square)"}
                  </button>
                )}
                {(solveState === "wrong" || solveState === "correct") && (
                  <button onClick={retry} style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    ↺ Retry
                  </button>
                )}
                {solveState !== "shown" && (
                  <button onClick={showSolution} style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(91,142,245,0.3)", background: "rgba(91,142,245,0.08)", color: "var(--accent-blue)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    Show Solution
                  </button>
                )}
                {solveState === "shown" && (
                  <button onClick={retry} style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(74,222,128,0.3)", background: "rgba(74,222,128,0.08)", color: "var(--clr-best)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    ↺ Try Again
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Explanation panel */}
          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
            {/* Idle state: prompt the user */}
            {solveState === "idle" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 16, padding: "24px 0", textAlign: "center" as const }}>
                <div style={{ fontSize: 36 }}>♟</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Find the best move</div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 240 }}>
                  Drag a piece on the board, or use hints to narrow it down. The engine&apos;s recommendation will be revealed once you find it.
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}>
                  Move {move.move_number} · {move.phase} · {move.classification}
                </div>
              </div>
            )}

            {/* Wrong attempt: show what went wrong but keep the challenge */}
            {solveState === "wrong" && (
              <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--clr-blunder)", marginBottom: 8 }}>Not quite</div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                  That&apos;s not the engine&apos;s top choice. Try again or use a hint to find <strong style={{ color: "var(--text-primary)" }}>{move.best_san}</strong>.
                </p>
              </div>
            )}

            {/* Revealed: Why bad + Why best (shown after correct answer or Show Solution) */}
            {(solveState === "correct" || solveState === "shown") && (
              <>
                {/* Why the move was bad */}
                <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--clr-blunder)", marginBottom: 8 }}>Why {move.san} is bad</div>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                    {whyBad.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
                      part.startsWith("**") && part.endsWith("**")
                        ? <strong key={i} style={{ color: "var(--text-primary)", fontWeight: 700 }}>{part.slice(2,-2)}</strong>
                        : part
                    )}
                  </p>
                </div>

                {/* Why the engine move is best */}
                <div style={{ background: "rgba(74,222,128,0.05)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--clr-best)", marginBottom: 8 }}>Why {move.best_san} is best</div>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                    {whyBest.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
                      part.startsWith("**") && part.endsWith("**")
                        ? <strong key={i} style={{ color: "var(--text-primary)", fontWeight: 700 }}>{part.slice(2,-2)}</strong>
                        : part
                    )}
                  </p>
                </div>

                {/* Engine line */}
                <div style={{ background: "rgba(91,142,245,0.06)", border: "1px solid rgba(91,142,245,0.2)", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--accent-blue)", marginBottom: 8 }}>Engine Line</div>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--accent-blue)", lineHeight: 1.6 }}>
                    {move.move_number}{"."} <strong>{move.best_san}</strong> — best continuation secures the advantage established by this move.
                  </p>
                </div>
              </>
            )}

            {/* Position metadata */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: "auto" }}>
              {[
                { label: "Phase",        value: move.phase },
                { label: "Position",     value: move.pos_context ?? "—" },
                { label: "CP Loss",      value: `−${move.cp_loss}` },
                { label: "Type",         value: move.classification },
              ].map(row => (
                <div key={row.label} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 2 }}>{row.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", textTransform: "capitalize" as const }}>{row.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Error List (shared by Middlegame and Endgame) ─────────────────────────────

function ErrorList({ moves, title }: { moves: WorstMove[]; title: string }) {
  const [openMove, setOpenMove] = useState<WorstMove | null>(null);
  if (moves.length === 0) return null;
  const cpColor = (cp: number) => cp > 200 ? "var(--clr-blunder)" : cp > 80 ? "var(--gold)" : "var(--text-secondary)";
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--clr-blunder)", fontSize: 12 }}>△</span>
        <span style={{ fontWeight: 800, fontSize: 13, color: "var(--text-primary)" }}>{title}</span>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--text-muted)" }}>{moves.length} error{moves.length !== 1 ? "s" : ""} · click to analyse position</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {moves.map((m, i) => {
          const isBlunder = m.classification === "Blunder";
          const clColor = isBlunder ? "var(--clr-blunder)" : "var(--gold)";
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "28px 60px 70px 90px 80px 1fr auto", gap: 8, padding: "10px 16px", borderBottom: i < moves.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none", alignItems: "center", background: i % 2 ? "rgba(255,255,255,0.01)" : "transparent" }}>
              <span style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 700 }}>#{i + 1}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 13, color: "var(--text-primary)" }}>{m.san}</span>
              <span>
                <span style={{ fontSize: 12, fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: isBlunder ? "var(--tint-red)" : "var(--tint-gold)", color: clColor, border: `1px solid ${isBlunder ? "var(--border-red)" : "var(--border-gold)"}` }}>
                  {isBlunder ? "BLUNDER" : "MISTAKE"}
                </span>
              </span>
              <span style={{ color: cpColor(m.cp_loss), fontWeight: 800, fontSize: 13, fontVariantNumeric: "tabular-nums" as const }}>−{m.cp_loss}cp</span>
              <span style={{ color: "var(--clr-best)", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13 }}>→ {m.best_san}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Mv {m.move_number} · G{m.game} · {m.pos_context ?? ""}</span>
              <button
                onClick={() => setOpenMove(m)}
                disabled={!m.fen}
                style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${m.fen ? "rgba(91,142,245,0.4)" : "var(--border)"}`, background: m.fen ? "rgba(91,142,245,0.08)" : "transparent", color: m.fen ? "var(--accent-blue)" : "var(--text-muted)", fontSize: 12, fontWeight: 700, cursor: m.fen ? "pointer" : "not-allowed", whiteSpace: "nowrap" as const }}
              >
                {m.fen ? "Analyse ▶" : "No FEN"}
              </button>
            </div>
          );
        })}
      </div>
      {openMove && <PuzzleModal move={openMove} onClose={() => setOpenMove(null)} />}
    </div>
  );
}

// ── Tactics & Strategy from AI text ──────────────────────────────────────────

// Sub-section accent colors — cycles through a palette per card index
const TACTIC_COLORS = ["var(--accent-blue)", "var(--accent-purple)", "var(--accent-pink)", "var(--clr-good)", "var(--clr-mistake)"];

function TacticsStrategyPanel({ sections, phase }: { sections: ParsedSection[]; phase: "mid" | "end" }) {
  // AI nests tactical/endgame content as H4 subsections inside "### 4. TACTICAL & ENDGAME ANALYSIS"
  // Fall back to "Technical Profile" for backwards compatibility with older cached reports
  const tacAnalysisSection = matchSection(sections, "tactical & endgame analysis", "tactical &") ??
    matchSection(sections, "technical profile", "technical");
  const subSections = tacAnalysisSection?.subSections ?? [];

  const isTacticsSub = (title: string) => {
    const t = title.toLowerCase();
    return t.includes("tactical pattern") || t.includes("tactical ability") ||
           t.includes("missed attack") || t.includes("defensive failure") ||
           t.includes("defensive failure") || t.includes("positional") ||
           t.includes("strategic");
  };

  const isEndgameSub = (title: string) => {
    const t = title.toLowerCase();
    return t.includes("endgame weakness") || t.includes("endgame technique") ||
           t.includes("endgame type") || t.includes("end game");
  };

  const targets = phase === "mid"
    ? subSections.filter(s => isTacticsSub(s.title))
    : subSections.filter(s => isEndgameSub(s.title));

  if (targets.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {targets.map((sub, idx) => {
        const bodyText = sub.body.join(" ").trim();
        if (!bodyText && sub.bullets.length === 0) return null;
        const secColor = TACTIC_COLORS[idx % TACTIC_COLORS.length];
        return (
          <div key={idx} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: secColor, marginBottom: 10 }}>{stripBold(sub.title)}</div>
            {/* Body lines rendered as separate paragraphs (preserves per-game spacing) */}
            {sub.body.filter(l => l.trim()).map((line, li) => (
              <p key={li} style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: li < sub.body.length - 1 ? 6 : (sub.bullets.length > 0 ? 10 : 0) }}>
                {renderBold(line)}
              </p>
            ))}
            {sub.bullets.length > 0 && (
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {sub.bullets.map((b, bi) => (
                  <li key={bi} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ color: secColor, flexShrink: 0, fontSize: 12, marginTop: 3 }}>▸</span>
                    <span style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{renderBold(b)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Middlegame section ────────────────────────────────────────────────────────

function MiddlegameSection({ stats, profileText }: { stats: ProfileStats; profileText: string }) {
  const per = stats.phase_error_rate;
  const midKey  = Object.keys(per).find(k => k.toLowerCase().includes("mid")) ?? "";
  const midRate = Math.min((per[midKey] ?? 0) * 100, 100);
  const bxp = stats.blunder_by_phase ?? {};
  const mra = stats.move_range_accuracy ?? {};

  const totalBlunders = Math.max(1,
    (bxp["Opening"] ?? 0) + (bxp["Middlegame"] ?? 0) + (bxp["Endgame"] ?? 0)
  );
  const convPct    = stats.conversion_rate ?? 50;
  const endgamePct = Math.round(((bxp["Endgame"] ?? 0) / totalBlunders) * 100);
  const midgamePct = Math.round(((bxp["Middlegame"] ?? 0) / totalBlunders) * 100);
  const timePressure = Math.min(35, Math.max(5, Math.round(100 - convPct)));
  const positional   = Math.max(5, Math.round(midgamePct * 0.4));
  const tactical     = Math.round(midgamePct * 0.6);
  const technique    = Math.max(5, endgamePct);
  const rawSum = timePressure + positional + tactical + technique;
  const norm = (v: number) => Math.round((v / rawSum) * 100);

  const yusupovCategories = [
    { label: "Endgame Technique",      pct: norm(technique),    color: "var(--accent-amber)" },
    { label: "Positional Misjudgment", pct: norm(positional),   color: "var(--accent-blue)" },
    { label: "Tactical Oversight",     pct: norm(tactical),     color: "var(--clr-blunder)" },
    { label: "Time Pressure",          pct: norm(timePressure), color: "var(--accent-purple)" },
  ].sort((a, b) => b.pct - a.pct);

  const midMoves = stats.worst_moves
    .filter(m => m.phase?.toLowerCase().includes("mid"))
    .sort((a, b) => b.cp_loss - a.cp_loss);

  const sections = profileText ? parseMarkdown(profileText) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: "fade-slide-up 0.22s ease" }}>
      <SectionBanner icon="△" title="Middlegame Analysis" desc="Error categorization, critical mistakes with position review, and tactical patterns" iconColor="var(--accent-blue)" />

      {/* Stat tiles — unique to this tab */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {([
          { label: "Middlegame Error",  value: `${midRate.toFixed(1)}%`,          color: midRate > 20 ? "var(--clr-blunder)" : "var(--gold)", sub: "phase error rate" },
          { label: "Blunders",          value: `${bxp["Middlegame"] ?? 0}`,       color: (bxp["Middlegame"] ?? 0) > 5 ? "var(--clr-blunder)" : "var(--gold)", sub: "in middlegame" },
          { label: "CP Loss (16–30)",   value: mra["16-30"]?.toFixed(1) ?? "—",  color: "var(--gold)", sub: "avg per move" },
          { label: "CP Loss (31–50)",   value: mra["31-50"]?.toFixed(1) ?? "—",  color: "var(--accent-blue)",     sub: "avg per move" },
        ] as { label: string; value: string; color: string; sub: string }[]).map(s => (
          <div key={s.label} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px", textAlign: "center" as const }}>
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: s.color, fontVariantNumeric: "tabular-nums" as const, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Yusupov Error Categorization */}
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--text-muted)" }}>Error Categorization</span>
          <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--text-muted)" }}>Dvoretsky/Yusupov methodology · {totalBlunders} critical mistakes</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {yusupovCategories.map((cat, i) => (
            <div key={cat.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flexShrink: 0, textAlign: "right" as const, width: 32, fontSize: 13, fontWeight: 900, color: cat.color, fontVariantNumeric: "tabular-nums" as const }}>{cat.pct}%</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600, marginBottom: 3 }}>{cat.label}{i === 0 ? " ◀ Priority" : ""}</div>
                <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: cat.pct + "%", background: cat.color, borderRadius: 3, transition: "width 0.8s ease", opacity: 0.85 }} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
          Priority: <span style={{ color: yusupovCategories[0].color, fontWeight: 700 }}>{yusupovCategories[0].label}</span> accounts for {yusupovCategories[0].pct}% of all mistakes in your games.
        </div>
      </div>

      {/* Middlegame errors with position links */}
      <ErrorList moves={midMoves} title="Middlegame Errors — analyse each position" />

      {/* Tactics & Strategy from AI profile — header only renders when panel has content */}
      {sections.length > 0 && (() => {
        const tacSection = matchSection(sections, "tactical & endgame analysis", "tactical &") ??
          matchSection(sections, "technical profile", "technical");
        const subs = tacSection?.subSections ?? [];
        const hasTactics = subs.some(s => {
          const t = s.title.toLowerCase();
          return t.includes("tactical pattern") || t.includes("tactical ability") ||
                 t.includes("missed attack") || t.includes("defensive failure") ||
                 t.includes("positional") || t.includes("strategic");
        });
        if (!hasTactics) return null;
        return (
          <>
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--accent-blue)", marginBottom: -6 }}>Tactics & Strategy Patterns</div>
            <TacticsStrategyPanel sections={sections} phase="mid" />
          </>
        );
      })()}
    </div>
  );
}

// ── Endgame section ───────────────────────────────────────────────────────────

function EndgameSection({ stats, profileText }: { stats: ProfileStats; profileText: string }) {
  const per = stats.phase_error_rate;
  const endKey  = Object.keys(per).find(k => k.toLowerCase().includes("end")) ?? "";
  const endRate = Math.min((per[endKey] ?? 0) * 100, 100);
  const bxp     = stats.blunder_by_phase ?? {};
  const mra     = stats.move_range_accuracy ?? {};
  const totalBlunders = Math.max(1,
    (bxp["Opening"] ?? 0) + (bxp["Middlegame"] ?? 0) + (bxp["Endgame"] ?? 0)
  );

  const endMoves = stats.worst_moves
    .filter(m => m.phase?.toLowerCase().includes("end"))
    .sort((a, b) => b.cp_loss - a.cp_loss);

  const sections = profileText ? parseMarkdown(profileText) : [];

  // Endgame strength/weakness inference from stats
  const convRate    = stats.conversion_rate ?? 0;
  const squandRate  = stats.squander_rate ?? 0;
  const endBlunders = bxp["Endgame"] ?? 0;
  const cpLate      = mra["50+"] ?? 0;

  const endgameTypes = [
    {
      type: "Conversion Skill",
      strength: convRate >= 65,
      note: convRate >= 65
        ? `Strong — converts ${convRate.toFixed(0)}% of winning positions. Decisive technique under pressure.`
        : `Weak — only ${convRate.toFixed(0)}% conversion. Winning advantages slip away, costing Elo.`,
      color: convRate >= 65 ? "var(--clr-best)" : "var(--clr-blunder)",
    },
    {
      type: "Endgame Accuracy",
      strength: endRate < 15,
      note: endRate < 15
        ? `Clean — only ${endRate.toFixed(1)}% error rate after move 35. Technique is reliable.`
        : `${endRate.toFixed(1)}% error rate in endgames. Inaccuracies mount as pieces come off the board.`,
      color: endRate < 15 ? "var(--clr-best)" : "var(--accent-amber)",
    },
    {
      type: "Late-Game Calculation",
      strength: cpLate < 30,
      note: cpLate > 0
        ? cpLate < 30
          ? `Good — ${cpLate.toFixed(1)}cp avg loss after move 50. Calculation holds in simplified positions.`
          : `${cpLate.toFixed(1)}cp avg loss after move 50. Calculation quality drops in late endgames.`
        : "Insufficient data — more games needed for late-endgame statistics.",
      color: cpLate > 0 && cpLate < 30 ? "var(--clr-best)" : cpLate > 0 ? "var(--accent-amber)" : "var(--text-muted)",
    },
    {
      type: "Defensive Resourcefulness",
      strength: (stats.losing_error_rate ?? 50) < 30,
      note: (stats.losing_error_rate ?? 50) < 30
        ? "Resilient — holds positions well when behind. Good fighting spirit in defence."
        : `${stats.losing_error_rate ?? 0}% error rate in losing positions. Resistance breaks down under pressure.`,
      color: (stats.losing_error_rate ?? 50) < 30 ? "var(--clr-best)" : "var(--accent-amber)",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: "fade-slide-up 0.22s ease" }}>
      <SectionBanner icon="◉" title="Endgame Analysis" desc="Conversion intelligence, technique assessment, endgame type strengths, and position review" iconColor="var(--accent-amber)" />

      {/* Stat tiles — unique to endgame */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {([
          { label: "Endgame Error",    value: `${endRate.toFixed(1)}%`,         color: endRate > 15 ? "var(--gold)" : "var(--clr-best)", sub: "phase error rate" },
          { label: "Endgame Blunders", value: `${endBlunders}`,                  color: endBlunders > 3 ? "var(--gold)" : "var(--clr-best)", sub: `of ${totalBlunders} total` },
          { label: "CP Loss (50+)",    value: mra["50+"]?.toFixed(1) ?? "—",    color: "var(--accent-blue)", sub: "avg per move" },
          { label: "Conversion Rate",  value: convRate > 0 ? `${convRate.toFixed(0)}%` : "—", color: convRate >= 60 ? "var(--clr-best)" : "var(--gold)", sub: "from winning pos." },
        ] as { label: string; value: string; color: string; sub: string }[]).map(s => (
          <div key={s.label} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px", textAlign: "center" as const }}>
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: s.color, fontVariantNumeric: "tabular-nums" as const, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Conversion dashboard (moved from Middlegame) */}
      <ConversionDashboard stats={stats} />

      {/* Endgame type strengths & weaknesses */}
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--accent-amber)", fontSize: 12 }}>◉</span>
          <span style={{ fontWeight: 800, fontSize: 13, color: "var(--text-primary)" }}>Endgame Strength Profile</span>
          <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--text-muted)" }}>derived from your game patterns</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
          {endgameTypes.map((et, i) => (
            <div key={i} style={{ padding: "14px 16px", borderBottom: i < 2 ? "1px solid var(--border)" : "none", borderRight: i % 2 === 0 ? "1px solid var(--border)" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13, lineHeight: 1 }}>{et.strength ? "✓" : "✗"}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: et.color }}>{et.type}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 800, padding: "1px 7px", borderRadius: 4, background: et.strength ? "var(--tint-green)" : "var(--tint-red)", color: et.color, border: `1px solid ${et.strength ? "var(--border-green)" : "var(--border-red)"}` }}>
                  {et.strength ? "STRONG" : "IMPROVE"}
                </span>
              </div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{et.note}</p>
            </div>
          ))}
        </div>
        {endMoves.length > 0 && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", background: "rgba(245,158,11,0.04)", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            <span style={{ color: "var(--accent-amber)", fontWeight: 700 }}>Pattern:</span>{" "}
            {endMoves[0]?.pos_context === "winning"
              ? `Most endgame errors occur from winning positions — the biggest weakness is technique under pressure, not finding the endgame.`
              : `Endgame errors spread across equal and losing positions — focus on building a systematic endgame foundation.`}
          </div>
        )}
      </div>

      {/* Endgame errors with position links */}
      <ErrorList moves={endMoves} title="Endgame Errors — analyse each position" />

      {/* Endgame technique patterns from AI — header only renders when panel has content */}
      {sections.length > 0 && (() => {
        const tacSection = matchSection(sections, "tactical & endgame analysis", "tactical &") ??
          matchSection(sections, "technical profile", "technical");
        const subs = tacSection?.subSections ?? [];
        const hasEnd = subs.some(s => {
          const t = s.title.toLowerCase();
          return t.includes("endgame weakness") || t.includes("endgame technique") ||
                 t.includes("endgame type") || t.includes("end game");
        });
        if (!hasEnd) return null;
        return (
          <>
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--accent-amber)", marginBottom: -6 }}>Endgame Technique Analysis</div>
            <TacticsStrategyPanel sections={sections} phase="end" />
          </>
        );
      })()}
    </div>
  );
}

// ── Blunder Map section ───────────────────────────────────────────────────────

function BlunderMapSection({ stats }: { stats: ProfileStats }) {
  const worst = [...stats.worst_moves].sort((a, b) => b.cp_loss - a.cp_loss).slice(0, 15);
  const cpColor  = (cp: number) => cp > 150 ? "var(--clr-blunder)" : cp > 80 ? "var(--gold)" : "var(--text-secondary)";
  const normPhase = (p: string) => { const l = p.toLowerCase(); return l.includes("mid") ? "Middlegame" : l.includes("end") ? "Endgame" : "Opening"; };
  const phaseCol  = (p: string) => { const n = normPhase(p); return n === "Middlegame" ? "var(--gold)" : n === "Endgame" ? "var(--clr-mistake)" : "var(--clr-best)"; };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: "fade-slide-up 0.22s ease" }}>
      <SectionBanner icon="△" title="Error Heatmap" desc="Move-by-move error patterns, severity analysis, and top critical mistakes" iconColor="var(--clr-blunder)" />
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px" }}>
        <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 14 }}>Error Heatmap by Move Number</div>
        <MoveHeatmapCanvas moves={stats.worst_moves} />
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <ErrorHeatmap moves={stats.worst_moves} />
        </div>
      </div>
      {worst.length > 0 && (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--clr-blunder)", fontSize: 12 }}>△</span>
            <span style={{ fontWeight: 800, fontSize: 12 }}>Top {worst.length} Errors by Severity</span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>ranked by centipawn loss</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "30px 64px 80px 90px 74px 52px 70px", gap: 0, padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
              {["#", "Move", "Type", "Phase", "CP Loss", "Gm", "Best"].map(h => (
                <div key={h} style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: "var(--text-muted)" }}>{h}</div>
              ))}
            </div>
            {worst.map((m, i) => {
              const isBlunder = m.classification?.toLowerCase().includes("blunder");
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "30px 64px 80px 90px 74px 52px 70px", gap: 0, padding: "9px 14px", borderBottom: i < worst.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none", alignItems: "center", background: i % 2 === 1 ? "rgba(255,255,255,0.012)" : "transparent" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 700 }}>#{i+1}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 12, color: "var(--text-primary)" }}>{m.san}</span>
                  <span>
                    <span style={{ fontSize: 13, fontWeight: 800, padding: "2px 7px", borderRadius: 4, background: isBlunder ? "rgba(239,68,68,0.12)" : "rgba(249,115,22,0.12)", color: isBlunder ? "var(--clr-blunder)" : "var(--clr-mistake)", border: `1px solid ${isBlunder ? "rgba(239,68,68,0.3)" : "rgba(249,115,22,0.3)"}` }}>
                      {isBlunder ? "BLUNDER" : "MISTAKE"}
                    </span>
                  </span>
                  <span style={{ color: phaseCol(m.phase), fontWeight: 700, fontSize: 13 }}>{normPhase(m.phase)}</span>
                  <span style={{ color: cpColor(m.cp_loss), fontWeight: 800, fontSize: 12, fontVariantNumeric: "tabular-nums" as const }}>−{m.cp_loss}cp</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 12 }}>G{m.game}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, color: "var(--clr-best)" }}>{m.best_san || "—"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Linked accounts (signed-in only) ────────────────────────────────────────────

function LinkedAccountsCard({ onLoaded }: { onLoaded?: (me: Me) => void }) {
  const { status } = useSession();
  const [me, setMe]                   = useState<Me | null>(null);
  const [lichessInput, setLichessInput]   = useState("");
  const [chesscomInput, setChesscomInput] = useState("");
  const [saving, setSaving]           = useState(false);
  const [loaded, setLoaded]           = useState(false);
  const [msg, setMsg]                 = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    getMe()
      .then(m => {
        setMe(m);
        setLichessInput(m.lichess_username ?? "");
        setChesscomInput(m.chesscom_username ?? "");
        setLoaded(true);
        onLoaded?.(m);
      })
      .catch(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (status !== "authenticated") return null;

  const linkedInputStyle = {
    background: "var(--bg-elevated)", border: "1px solid var(--border-strong)",
    color: "var(--text-primary)", borderRadius: 8, padding: "9px 12px", fontSize: 13,
  };

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      await linkChessUsername({
        lichess_username: lichessInput.trim() || undefined,
        chesscom_username: chesscomInput.trim() || undefined,
      });
      const updated = await getMe();
      setMe(updated);
      setMsg({ text: "Saved.", ok: true });
      onLoaded?.(updated);
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ padding: 18, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--gold)" }}>
          Linked Accounts
        </span>
        {me?.lichess_verified && me.lichess_username && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
            background: "rgba(76,175,130,0.12)", color: "var(--clr-best)",
            border: "1px solid rgba(76,175,130,0.25)",
          }}>
            ✓ Verified via Lichess sign-in
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          style={{ ...linkedInputStyle, flex: "1 1 200px" }}
          placeholder="Lichess username"
          value={lichessInput}
          onChange={e => setLichessInput(e.target.value)}
          disabled={!loaded}
        />
        <input
          style={{ ...linkedInputStyle, flex: "1 1 200px" }}
          placeholder="Chess.com username"
          value={chesscomInput}
          onChange={e => setChesscomInput(e.target.value)}
          disabled={!loaded}
        />
        <button
          onClick={handleSave}
          disabled={saving || !loaded}
          className="btn-gold"
          style={{ padding: "9px 18px", borderRadius: 8, fontSize: 13, whiteSpace: "nowrap", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {msg && (
        <p style={{ marginTop: 8, fontSize: 12, color: msg.ok ? "var(--clr-best)" : "var(--clr-blunder)" }}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function ProfilePageContent() {
  const [inputMode, setInputMode]     = useState<InputMode>("platform");
  const [platform, setPlatform]       = useState<Platform>("lichess");
  const [username, setUsername]       = useState("");
  const [count, setCount]             = useState(20);
  const [pgnText, setPgnText]         = useState("");
  const [pgnPlayerName, setPgnPlayerName] = useState("");
  const [phase, setPhase]             = useState<Phase>("idle");
  const [progress, setProgress]       = useState({ current: 0, total: 0 });
  const [skippedGames, setSkippedGames] = useState(0);
  const [statusMsg, setStatusMsg]     = useState("");
  const [stats, setStats]             = useState<ProfileStats | null>(null);
  const [profileText, setProfileText] = useState("");
  const [ratingHistory, setRatingHistory] = useState<RatingHistoryEntry[]>([]);
  const [error, setError]             = useState("");
  const [activeSection, setActiveSection] = useState<SidebarSection>("summary");
  const stopRef   = useRef<(() => void) | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { status: sessionStatus } = useSession();
  const searchParams = useSearchParams();
  const router        = useRouter();

  // Opening a saved profile from /dashboard (?profileId=123) — pure
  // hydration from the saved payload, no Stockfish/AI recompute.
  //
  // Reads via next/navigation's useSearchParams() (reactive to Next's
  // router) rather than a one-time window.location.search read — a plain
  // useRef-at-mount read never re-fires on a client-side Link navigation
  // between routes, since Next can reuse/update the existing render tree
  // without a fresh mount. The handledProfileIdRef guard (not the URL) is
  // what actually prevents double-fetching once handled.
  const handledProfileIdRef = useRef<string | null>(null);
  useEffect(() => {
    const profileId = searchParams.get("profileId");
    if (!profileId || handledProfileIdRef.current === profileId) return;
    handledProfileIdRef.current = profileId;
    router.replace("/profile");
    setPhase("analyzing"); setStatusMsg("Loading your saved profile…");
    getSavedProfile(Number(profileId))
      .then(detail => {
        const { profile_text, ...restStats } = detail.payload;
        setStats(restStats as ProfileStats);
        setProfileText(profile_text ?? "");
        setPhase("done"); setStatusMsg("");
        setActiveSection("summary");
      })
      .catch(() => { setError("Couldn't load that saved profile."); setPhase("error"); });
  }, [searchParams, router]);

  const _startStream = useCallback((
    pgn: string, playerName: string,
    provider: "lichess" | "chesscom" | "pgn" = "pgn", usernameForSave?: string,
  ) => {
    setPhase("analyzing"); setStatusMsg("Starting analysis…"); setSkippedGames(0);
    let finalStats: ProfileStats | null = null;
    let finalText = "";
    let finalGamesCount = 0;
    stopRef.current = streamProfile(
      pgn, playerName,
      (total, skipped = 0) => { finalGamesCount = total; setProgress({ current: 0, total }); setSkippedGames(skipped); setStatusMsg("Analyzing game 0 / " + total + "…"); },
      (current, total)     => { setProgress({ current, total }); setStatusMsg("Analyzing game " + current + " / " + total + "…"); },
      (s)                  => { finalStats = s; setStats(s); setStatusMsg("Generating AI coaching profile…"); },
      (text)               => { finalText = text; setProfileText(text); },
      () => {
        setPhase("done"); setStatusMsg("");
        if (provider === "lichess") {
          fetchLichessRatingHistory(playerName).then(h => setRatingHistory(h)).catch(() => {});
        }
        // Best-effort save for /dashboard history — local closure vars
        // (not React state) so this always sees this exact stream's final
        // values regardless of _startStream's own stale-closure risk.
        if (sessionStatus === "authenticated" && finalStats) {
          saveProfile({
            provider, username: usernameForSave, player_name: playerName,
            games_count: finalGamesCount || (finalStats as ProfileStats).total_games || 0,
            payload: { ...(finalStats as ProfileStats), profile_text: finalText },
          }).catch(() => {});
        }
      },
      (msg) => { setError(msg); setPhase("error"); },
    );
  }, [sessionStatus]);

  const handleBuild = useCallback(async () => {
    setError(""); setStats(null); setProfileText(""); setRatingHistory([]); setSkippedGames(0);
    setActiveSection("summary");

    if (inputMode === "pgn") {
      if (!pgnText.trim()) { setError("Paste a PGN to analyse."); return; }
      const name = pgnPlayerName.trim() || "Player";
      _startStream(pgnText.trim(), name, "pgn");
      return;
    }

    if (!username.trim()) { setError("Enter a username."); return; }
    setPhase("fetching");
    setStatusMsg("Fetching games from " + (platform === "lichess" ? "Lichess" : "Chess.com") + "…");
    let pgn: string;
    try {
      const fn = platform === "lichess" ? fetchLichessGames : fetchChessdotcomGames;
      const resp = await fn(username.trim(), count);
      pgn = resp.pgn;
      if (!pgn?.trim()) throw new Error("No games found for this username.");
    } catch (e: unknown) { setError((e as Error).message); setPhase("error"); return; }
    _startStream(pgn, username.trim(), platform === "lichess" ? "lichess" : "chesscom", username.trim());
  }, [username, platform, count, inputMode, pgnText, pgnPlayerName, _startStream]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setPgnText(ev.target?.result as string ?? ""); };
    reader.readAsText(file);
  }, []);

  const inputStyle = {
    background: "var(--bg-elevated)", border: "1px solid var(--border-strong)",
    color: "var(--text-primary)", borderRadius: 8, padding: "10px 12px", fontSize: 14, width: "100%",
  };
  const progressPct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
  const styleTag    = stats ? deriveStyleTag(stats) : null;


  return (
    <>
      <Navbar />
      <main style={{ background: "var(--bg-base)", minHeight: "100vh" }} className="px-6 py-6 max-w-[1440px] mx-auto">

        {/* Page header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <Link href="/" style={{ color: "var(--text-muted)", fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" }} className="hover:text-[var(--gold)] transition-colors">{"← Home"}</Link>
            <span style={{ color: "var(--border)" }}>|</span>
            <span style={{ color: "var(--text-muted)", fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase" }}>Player Profile</span>
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "clamp(30px, 4.5vw, 52px)", lineHeight: 1.05, letterSpacing: "-0.02em", color: "var(--text-primary)", marginBottom: 8 }}>
            Your <em className="text-gold-gradient not-italic">chess story,</em><br />across every game.
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.65, maxWidth: 580 }}>
            GM-level diagnostics across 9 dimensions — powered by Stockfish engine analysis and AI coaching. More insight than Chess.com, Lichess, and ChessBase combined.
          </p>
        </div>

        <LinkedAccountsCard />

        {/* Input form */}
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          {/* Mode toggle */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {([["platform", "♟ Fetch from Platform"], ["pgn", "⬆ Upload PGN"]] as [InputMode, string][]).map(([mode, label]) => (
              <button key={mode} onClick={() => setInputMode(mode)} style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: inputMode === mode ? 700 : 400, background: inputMode === mode ? "var(--gold-subtle)" : "var(--bg-elevated)", color: inputMode === mode ? "var(--gold)" : "var(--text-muted)", border: inputMode === mode ? "1px solid var(--gold-border)" : "1px solid var(--border)", transition: "all 0.15s" }}>
                {label}
              </button>
            ))}
          </div>

          {inputMode === "platform" ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {(["lichess", "chessdotcom"] as Platform[]).map(p => (
                <button key={p} onClick={() => setPlatform(p)} style={{ padding: "9px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer", transition: "all 0.15s", fontWeight: platform === p ? 600 : 400, background: platform === p ? "var(--gold-subtle)" : "var(--bg-elevated)", color: platform === p ? "var(--gold-light)" : "var(--text-secondary)", border: platform === p ? "1px solid var(--gold-border)" : "1px solid var(--border)" }}>
                  {p === "lichess" ? "♞ Lichess" : "♟ Chess.com"}
                </button>
              ))}
              <input style={{ ...inputStyle, flex: "1 1 160px", transition: "border-color 0.2s, box-shadow 0.2s" }}
                placeholder={platform === "lichess" ? "Lichess username" : "Chess.com username"}
                value={username} onChange={e => setUsername(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleBuild()}
                onFocus={e => { e.currentTarget.style.borderColor = "var(--gold-border)"; e.currentTarget.style.boxShadow = "0 0 0 3px var(--gold-subtle)"; }}
                onBlur={e  => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.boxShadow = "none"; }} />
              <select style={{ ...inputStyle, width: "auto", minWidth: 110, flex: "0 0 auto" }} value={count} onChange={e => setCount(Number(e.target.value))}>
                {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n} games</option>)}
              </select>
              <button onClick={handleBuild} disabled={phase === "fetching" || phase === "analyzing"} className="btn-gold"
                style={{ padding: "9px 20px", borderRadius: 10, fontSize: 14, whiteSpace: "nowrap", flex: "0 0 auto", opacity: (phase === "fetching" || phase === "analyzing") ? 0.6 : 1 }}>
                {phase === "fetching" ? "Fetching…" : phase === "analyzing" ? "Analyzing…" : "Build Profile"}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Player name + file upload row */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <input style={{ ...inputStyle, flex: "1 1 160px" }}
                  placeholder="Your name (used in the report)"
                  value={pgnPlayerName} onChange={e => setPgnPlayerName(e.target.value)} />
                <input ref={fileInput} type="file" accept=".pgn,.txt" style={{ display: "none" }} onChange={handleFileUpload} />
                <button onClick={() => fileInput.current?.click()}
                  style={{ padding: "9px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer", background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)", whiteSpace: "nowrap", flex: "0 0 auto" }}>
                  ↑ Upload .pgn file
                </button>
              </div>
              {/* PGN textarea */}
              <textarea
                style={{ ...inputStyle, minHeight: 110, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.6 }}
                placeholder={"Paste multi-game PGN here…\n\n[Event \"Casual Game\"]\n[White \"Player\"]\n[Black \"Opponent\"]\n1. e4 e5 2. Nf3 Nc6 *"}
                value={pgnText} onChange={e => setPgnText(e.target.value)} />
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {pgnText && (
                  <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
                    {pgnText.split(/\[Event /).length - 1 || 1} game(s) detected
                  </span>
                )}
                <button onClick={handleBuild} disabled={phase === "analyzing"} className="btn-gold"
                  style={{ padding: "9px 20px", borderRadius: 10, fontSize: 14, marginLeft: "auto", opacity: phase === "analyzing" ? 0.6 : 1 }}>
                  {phase === "analyzing" ? "Analyzing…" : "Build Profile"}
                </button>
              </div>
            </div>
          )}
          {error && <p style={{ color: "var(--clr-blunder)", fontSize: 12, marginTop: 10 }}>{error}</p>}
        </div>

        {/* Progress */}
        {(phase === "fetching" || phase === "analyzing") && (
          <div className="card" style={{ padding: 20, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: progress.total > 0 ? 14 : 0 }}>
              <div style={{ position: "relative", width: 22, height: 22, flexShrink: 0 }}>
                <div style={{ width: 22, height: 22, border: "2px solid rgba(91,142,245,0.2)", borderTopColor: "var(--accent-blue)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                <div style={{ position: "absolute", inset: 4, border: "1.5px solid rgba(201,162,68,0.25)", borderBottomColor: "var(--gold)", borderRadius: "50%", animation: "spin 1.4s linear infinite reverse" }} />
              </div>
              <div>
                <span style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 500 }}>{statusMsg}</span>
                <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                  {[0, 1, 2].map(i => (
                    <span key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--accent-blue)", display: "inline-block", animation: "ai-pulse 1.2s ease-in-out " + (i * 0.2) + "s infinite" }} />
                  ))}
                </div>
              </div>
            </div>
            {skippedGames > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--gold-subtle)", border: "1px solid var(--gold-border)", borderRadius: 8, padding: "7px 12px", marginBottom: 10 }}>
                <span style={{ color: "var(--gold)", fontSize: 13 }}>⚠</span>
                <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                  Your PGN has {progress.total + skippedGames} games — analysing the most recent <strong>{progress.total}</strong>. The 100-game cap keeps analysis fast.
                </span>
              </div>
            )}
            {progress.total > 0 && (
              <>
                <div style={{ background: "var(--bg-elevated)", borderRadius: 6, height: 5, overflow: "hidden" }}>
                  <div style={{ width: progressPct + "%", background: "linear-gradient(90deg, var(--accent-blue), var(--gold))", height: "100%", borderRadius: 6, transition: "width 0.4s ease" }} />
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{progress.current} / {progress.total} games analyzed</p>
              </>
            )}
          </div>
        )}

        {/* Results */}
        {stats && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Hero card */}
            <div style={{ padding: "1.5px", borderRadius: 17, backgroundImage: "linear-gradient(135deg, rgba(91,142,245,0.75), rgba(201,162,68,0.75), rgba(91,142,245,0.75))", backgroundSize: "200% 200%", animation: "gradient-border 6s ease infinite" }}>
              <div style={{ background: "var(--bg-surface)", borderRadius: "15.5px", padding: "22px 24px" }}>
                <div className="flex flex-col sm:flex-row gap-6 items-start">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(91,142,245,0.1)", border: "1px solid rgba(91,142,245,0.3)", borderRadius: 6, padding: "3px 9px", fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", color: "var(--accent-blue)", textTransform: "uppercase" }}>
                        <span style={{ width: 5, height: 5, background: "var(--accent-blue)", borderRadius: "50%", display: "inline-block", animation: "ai-pulse 1.5s ease-in-out infinite" }} />
                        AI Analysis Complete
                      </span>
                      <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{inputMode === "pgn" ? "PGN Upload" : platform === "lichess" ? "Lichess" : "Chess.com"} · {stats.total_games} games</span>
                    </div>
                    <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "clamp(24px, 3.5vw, 36px)", letterSpacing: "-0.02em", color: "var(--text-primary)", lineHeight: 1.1, marginBottom: 12 }}>
                      {stats.player_name}
                      {phase === "analyzing" && <span style={{ fontSize: 12, color: "var(--gold)", fontWeight: 500, marginLeft: 14, fontStyle: "normal", letterSpacing: 0 }}>· Generating AI report…</span>}
                    </h2>
                    {styleTag && (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, background: styleTag.bg, border: `1px solid ${styleTag.border}`, borderRadius: 8, padding: "5px 13px", fontSize: 12, fontWeight: 700, color: styleTag.color }}>
                          <span style={{ width: 6, height: 6, background: styleTag.color, borderRadius: "50%", display: "inline-block", animation: "ai-pulse 2s ease-in-out infinite" }} />
                          {styleTag.tag}
                        </span>
                        <span style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.4 }}>{styleTag.sub}</span>
                      </div>
                    )}
                    {(stats.display_elo ?? 0) > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                        <div style={{ display: "inline-flex", alignItems: "baseline", gap: 5, background: "var(--tint-gold)", border: "1px solid rgba(201,162,68,0.3)", borderRadius: 8, padding: "5px 12px" }}>
                          <span style={{ fontSize: 17, fontWeight: 800, color: "var(--gold)", fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>~{stats.display_elo}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--gold)", textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.8 }}>ELO</span>
                        </div>
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {stats.elo_source === "pgn_headers" ? "rated" : "estimated from engine data"}
                        </span>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                      {[
                        { label: "Win Rate",      value: stats.win_rate + "%",        color: stats.win_rate > 50 ? "var(--clr-best)" : "var(--clr-mistake)",                sub: `${stats.wins}W · ${stats.draws}D · ${stats.losses}L` },
                        { label: "Avg CP Loss",   value: "" + stats.avg_cp_loss,       color: stats.avg_cp_loss < 30 ? "var(--clr-best)" : stats.avg_cp_loss < 50 ? "var(--gold)" : "var(--clr-mistake)", sub: "per player move" },
                        { label: "Precision",     value: stats.precision_rate + "%",   color: stats.precision_rate > 60 ? "var(--clr-best)" : "var(--gold)",                 sub: "accurate + strong" },
                        { label: "Clean Games",   value: stats.clean_game_rate + "%",  color: stats.clean_game_rate > 50 ? "var(--clr-best)" : "var(--text-secondary)",     sub: `${stats.clean_games} zero-blunder games` },
                        { label: "Conversion",    value: (stats.conversion_rate ?? 0) > 0 ? Math.round(stats.conversion_rate ?? 0) + "%" : "—", color: (stats.conversion_rate ?? 0) >= 60 ? "var(--clr-best)" : "var(--gold)", sub: "from winning positions" },
                      ].map(stat => (
                        <div key={stat.label} style={{ borderLeft: "2px solid var(--border)", paddingLeft: 12 }}>
                          <div style={{ color: "var(--text-muted)", fontSize: 13, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 2 }}>{stat.label}</div>
                          <div style={{ color: stat.color, fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums" as const, fontFamily: "var(--font-display)", lineHeight: 1 }}>{stat.value}</div>
                          <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>{stat.sub}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {ratingHistory.length > 0 && (
                    <div style={{ flexShrink: 0, paddingTop: 4, borderLeft: "1px solid var(--border)", paddingLeft: 24 }}>
                      <p style={{ color: "var(--text-muted)", fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>Rating Trend</p>
                      <HeroSparkline history={ratingHistory} />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Horizontal tab navigation */}
            {(() => {
              const per = stats.phase_error_rate;
              const openKey = Object.keys(per).find(k => k.toLowerCase().includes("open")) ?? "";
              const midKey  = Object.keys(per).find(k => k.toLowerCase().includes("mid"))  ?? "";
              const endKey  = Object.keys(per).find(k => k.toLowerCase().includes("end"))  ?? "";
              const phaseScore = (key: string) => Math.max(0, Math.min(100, 100 - (per[key] ?? 0.2) * 350));
              const dotColor = (s: number) => s >= 80 ? "var(--clr-best)" : s >= 60 ? "var(--accent-blue)" : s >= 40 ? "var(--accent-amber)" : "var(--clr-blunder)";
              const tabs: { id: SidebarSection; icon: string; label: string; score?: number }[] = [
                { id: "summary",    icon: "◎", label: "Summary" },
                { id: "skills",     icon: "◈", label: "Skills" },
                { id: "openings",   icon: "◆", label: "Opening",    score: phaseScore(openKey) },
                { id: "middlegame", icon: "△", label: "Middlegame", score: phaseScore(midKey) },
                { id: "endgame",    icon: "◉", label: "Endgame",    score: phaseScore(endKey) },
                { id: "psychology", icon: "◉", label: "Psychology" },
                { id: "blunders",   icon: "△", label: "Blunder Map" },
                { id: "coach",      icon: "✦", label: "AI Coach" },
              ];
              return (
                <div style={{ overflowX: "auto", marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "6px", minWidth: "max-content" }}>
                    {tabs.map(tab => {
                      const active = activeSection === tab.id;
                      return (
                        <button key={tab.id} onClick={() => setActiveSection(tab.id)}
                          style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 20px", borderRadius: 10, border: "none", flexShrink: 0,
                            background: active ? "var(--gold)" : "transparent",
                            color: active ? "var(--gold-contrast)" : "var(--text-secondary)",
                            fontSize: 14, fontWeight: active ? 700 : 500, cursor: "pointer",
                            transition: "all 0.15s", whiteSpace: "nowrap" as const }}>
                          <span style={{ fontSize: 15, lineHeight: 1 }}>{tab.icon}</span>
                          {tab.label}
                          {tab.score !== undefined && (
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor(tab.score), flexShrink: 0, opacity: 0.9, marginLeft: 2 }} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Full-width section content */}
            <div key={activeSection} style={{ animation: "fade-slide-up 0.22s ease" }}>

              {activeSection === "summary"    && <SummarySection stats={stats} ratingHistory={ratingHistory} />}
              {activeSection === "skills"     && <SkillsAssessment stats={stats} />}
              {activeSection === "openings"   && <OpeningAnalysisSection stats={stats} />}
              {activeSection === "middlegame" && <MiddlegameSection stats={stats} profileText={profileText} />}
              {activeSection === "endgame"    && <EndgameSection stats={stats} profileText={profileText} />}
              {activeSection === "psychology" && <PsychSection stats={stats} />}
              {activeSection === "blunders"   && <BlunderMapSection stats={stats} />}
              {activeSection === "coach" && (
                <div>
                  {/* Coach header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: "14px 18px", background: "var(--tint-blue)", border: "1px solid var(--border-blue)", borderRadius: 14 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: "var(--tint-blue-strong)", border: "1px solid var(--border-blue)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "var(--accent-blue)", animation: "ai-glow 3s ease-in-out infinite" }}>✦</div>
                    <div style={{ flex: 1 }}>
                      <p style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 14 }}>GM Coach Analysis</p>
                      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>AI-generated coaching report based on {stats.total_games} games</p>
                    </div>
                    {profileText && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ background: "var(--tint-green)", color: "var(--clr-best)", border: "1px solid var(--border-green)", fontSize: 13, fontWeight: 700, padding: "3px 8px", borderRadius: 4, letterSpacing: "0.08em" }}>COMPLETE</span>
                        <button
                          onClick={() => {
                            const mdToHtml = (md: string) => md
                              .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                              .replace(/^### (.+)$/gm, "<h3>$1</h3>")
                              .replace(/^## (.+)$/gm, "<h2>$1</h2>")
                              .replace(/^# (.+)$/gm, "<h1>$1</h1>")
                              .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                              .replace(/\*(.+?)\*/g, "<em>$1</em>")
                              .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
                              .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
                              .replace(/\n\n/g, "</p><p>")
                              .replace(/^(?!<[hul])(.+)$/gm, "$1");
                            const eloLine = (stats.display_elo ?? 0) > 0
                              ? `<p><strong>Estimated ELO:</strong> ~${stats.display_elo} (${stats.elo_source === "pgn_headers" ? "rated" : "estimated"})</p>` : "";
                            const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Chess Coaching Report — ${stats.player_name}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#1a1a1a; background:#fff; padding:48px 56px; line-height:1.65; font-size:12px; max-width:820px; margin:0 auto; }
header { border-bottom:2px solid #c9a244; padding-bottom:16px; margin-bottom:28px; }
header h1 { font-size:24px; font-weight:900; color:#c9a244; margin-bottom:4px; }
header p { color:#666; font-size:11px; }
.stats-row { display:flex; gap:20px; margin-top:12px; flex-wrap:wrap; }
.stat { background:#fffaf0; border:1px solid #e8d89a; border-radius:8px; padding:8px 14px; }
.stat-label { font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:#9a7830; }
.stat-value { font-size:16px; font-weight:900; color:#c9a244; margin-top:2px; }
.content h1 { font-size:18px; font-weight:900; color:#c9a244; margin:28px 0 10px; padding-top:20px; border-top:1px solid #f0e8c8; }
.content h2 { font-size:13px; font-weight:800; color:#444; text-transform:uppercase; letter-spacing:0.08em; margin:20px 0 8px; }
.content h3 { font-size:12px; font-weight:700; color:#555; margin:14px 0 6px; }
.content p { color:#333; margin-bottom:10px; }
.content ul { padding-left:20px; margin-bottom:10px; }
.content li { color:#333; margin-bottom:4px; }
.content strong { color:#1a1a1a; }
.footer { margin-top:40px; padding-top:12px; border-top:1px solid #eee; color:#aaa; font-size:10px; text-align:center; }
@media print { body { padding:24px 32px; } }
</style></head><body>
<header>
  <h1>♟ Chess Coaching Report</h1>
  <p>${stats.player_name} · ${stats.total_games} games analysed</p>
  <div class="stats-row">
    <div class="stat"><div class="stat-label">Win Rate</div><div class="stat-value">${stats.win_rate}%</div></div>
    <div class="stat"><div class="stat-label">Avg CP Loss</div><div class="stat-value">${stats.avg_cp_loss}</div></div>
    <div class="stat"><div class="stat-label">Precision Rate</div><div class="stat-value">${stats.precision_rate}%</div></div>
    ${(stats.display_elo ?? 0) > 0 ? `<div class="stat"><div class="stat-label">Estimated ELO</div><div class="stat-value">~${stats.display_elo}</div></div>` : ""}
  </div>
</header>
<div class="content"><p>${mdToHtml(profileText)}</p></div>
<div class="footer">Generated by chessAIlytics · ${new Date().toLocaleDateString()}</div>
</body></html>`;
                            const win = window.open("", "_blank");
                            if (!win) return;
                            win.document.write(html);
                            win.document.close();
                            setTimeout(() => { win.print(); }, 400);
                          }}
                          style={{ padding: "6px 13px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", background: "var(--tint-gold)", color: "var(--gold)", border: "1px solid var(--border-gold)", display: "flex", alignItems: "center", gap: 5, transition: "opacity 0.15s" }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = "0.75"; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
                        >
                          ↓ Download
                        </button>
                      </div>
                    )}
                  </div>

                  {!profileText && phase === "analyzing" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "20px 0" }}>
                      {[82, 58, 91, 48, 73, 87, 42, 66].map((w, i) => (
                        <div key={i} style={{ height: 11, width: w + "%", background: "var(--bg-elevated)", borderRadius: 4, animation: "shimmer 1.6s ease-in-out " + STAGGER[i] + " infinite" }} />
                      ))}
                      <p style={{ color: "var(--accent-blue)", fontSize: 12, marginTop: 6, animation: "ai-pulse 1.5s ease-in-out infinite" }}>◈ AI is analysing your patterns across {stats.total_games} games…</p>
                    </div>
                  ) : profileText ? (
                    <ProfileCoach text={profileText} stats={stats} />
                  ) : (
                    <p style={{ color: "var(--text-muted)", fontSize: 12, padding: "20px 0" }}>Coach analysis will appear here once the profile is built.</p>
                  )}
                </div>
              )}

            </div>
          </div>
        )}
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes gradient-border { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        @keyframes ai-glow { 0%,100% { box-shadow: 0 0 0 1px rgba(91,142,245,0.15), 0 0 18px rgba(91,142,245,0.06); } 50% { box-shadow: 0 0 0 1px rgba(91,142,245,0.5), 0 0 32px rgba(91,142,245,0.2); } }
        @keyframes ai-pulse { 0%,100% { opacity: 0.55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.18); } }
        @keyframes ai-ready-pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
        @keyframes scan-line { 0% { left: -40%; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { left: 120%; opacity: 0; } }
        @keyframes fade-slide-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes draw-path { from { stroke-dashoffset: 800; } to { stroke-dashoffset: 0; } }
        @keyframes shimmer { 0%,100% { opacity: 0.3; } 50% { opacity: 0.75; } }
      ` }} />
    </>
  );
}

// useSearchParams() requires a Suspense boundary above it (Next.js opts the
// page out of static rendering otherwise) — this page is fully client/dynamic
// already, so the fallback never really shows in practice.
export default function ProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfilePageContent />
    </Suspense>
  );
}

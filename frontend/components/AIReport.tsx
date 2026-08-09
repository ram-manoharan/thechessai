"use client";
import { useState, useEffect, useRef } from "react";
import { useGameStore } from "@/lib/store";
import { CLF_CONFIG, countQuality, eloBandLabel } from "@/lib/chess-utils";

// ── Types ────────────────────────────────────────────────────────────────────

type PhaseGrade = { grade: string; note: string };
type OpeningResource = { type: string; title?: string; author?: string; chapter?: string; platform?: string; topic?: string; time?: string };
type KeyMoment = {
  move_num: number; san: string; side: string; label: string;
  classification: string; cp_loss: number | null; best: string | null;
  principle: string; what_happened: string; best_explanation: string;
};
type TacticalPattern = { name: string; description: string };
type StrengthItem    = { title: string; detail: string };
type StudyItem       = { type: string; title?: string; author?: string; chapter?: string; why?: string; platform?: string; theme?: string; daily_count?: number; target_accuracy?: string; description?: string; frequency?: string; how?: string };
type Priority        = { rank: number; title: string; action: string };

export type ReportData = {
  verdict: string;
  game_type: string;
  phase_grades: { opening: PhaseGrade; middlegame: PhaseGrade; endgame: PhaseGrade };
  opening: { name: string; eco: string; assessment: string; deviation: { move_num: number; san: string; note: string } | null; resources: OpeningResource[] };
  key_moments: KeyMoment[];
  tactical_patterns: TacticalPattern[];
  strengths: StrengthItem[];
  weaknesses: StrengthItem[];
  study_plan: { priority_phase: string; items: StudyItem[]; daily_routine: string; four_week_goal: string };
  checklist: string[];
  priorities: Priority[];
  coach_note: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function clsColor(clf: string) { return CLF_CONFIG[clf as keyof typeof CLF_CONFIG]?.color ?? "var(--text-muted)"; }
function clsBadge(clf: string) { return CLF_CONFIG[clf as keyof typeof CLF_CONFIG]?.badge ?? "·"; }

const GRADE_COLOR: Record<string, string> = {
  A: "var(--clr-best)", B: "var(--clr-excellent)",
  C: "var(--clr-inaccuracy)", D: "var(--clr-blunder)", "N/A": "var(--text-muted)",
};

const GRADE_PCT: Record<string, number> = { A: 95, B: 72, C: 44, D: 20, "N/A": 0 };

// ── SVG Phase Arc ─────────────────────────────────────────────────────────────
// Semi-circle arc gauge: 0% at 180deg (left), 100% at 0deg (right)

export function PhaseArc({ label, grade, note }: { label: string; grade: string; note: string }) {
  const color = GRADE_COLOR[grade] ?? "var(--text-muted)";
  const pct   = GRADE_PCT[grade] ?? 0;
  // Arc params: cx=50, cy=54, r=38, semi-circle from 180° to 0°
  const cx = 50, cy = 54, r = 38;
  const toXY = (deg: number) => ({
    x: cx + r * Math.cos((deg * Math.PI) / 180),
    y: cy + r * Math.sin((deg * Math.PI) / 180),
  });
  const start = toXY(180);
  const endDeg = 180 - pct * 1.8; // 180 → 0 degrees for 0→100%
  const end   = toXY(endDeg);
  const large = pct > 50 ? 1 : 0;
  const trackPath = `M ${toXY(180).x} ${toXY(180).y} A ${r} ${r} 0 1 1 ${toXY(0).x} ${toXY(0).y}`;
  const arcPath   = pct === 0 ? "" : `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
      <svg width="100" height="62" viewBox="0 0 100 62" style={{ overflow: "visible" }}>
        {/* track */}
        <path d={trackPath} fill="none" stroke="var(--bg-hover,#2a2a2a)" strokeWidth={7} strokeLinecap="round" />
        {/* fill */}
        {arcPath && <path d={arcPath} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.8s ease" }} />}
        {/* grade text */}
        <text x={cx} y={cy - 2} textAnchor="middle" fill={color} fontSize={22} fontWeight={900} fontFamily="inherit">{grade}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill="var(--text-muted)" fontSize={8} fontWeight={700} fontFamily="inherit" letterSpacing={1}>{label.toUpperCase()}</text>
      </svg>
      <p style={{ color: "var(--text-secondary)", fontSize: 10, lineHeight: 1.4, textAlign: "center", maxWidth: 100 }}>{note}</p>
    </div>
  );
}

// ── SVG Donut ─────────────────────────────────────────────────────────────────

export type DonutSlice = { label: string; value: number; color: string; badge: string };

export function DonutChart({ slices }: { slices: DonutSlice[] }) {
  const total = slices.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  const cx = 54, cy = 54, R = 40, W = 12;
  let angle = -90;
  const paths = slices.filter(s => s.value > 0).map(s => {
    const sweep = (s.value / total) * 360;
    const a1 = (angle * Math.PI) / 180;
    const a2 = ((angle + sweep) * Math.PI) / 180;
    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    const x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
    const large = sweep > 180 ? 1 : 0;
    const path = `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`;
    angle += sweep;
    return { ...s, path };
  });

  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width="108" height="108" viewBox="0 0 108 108">
        {paths.map(p => (
          <path key={p.label} d={p.path} fill="none"
            stroke={p.color} strokeWidth={hovered === p.label ? W + 3 : W}
            strokeLinecap="butt"
            style={{ transition: "stroke-width 0.2s", cursor: "default" }}
            onMouseEnter={() => setHovered(p.label)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
        <text x={cx} y={cy - 5} textAnchor="middle" fill="var(--text-primary)" fontSize={20} fontWeight={900} fontFamily="inherit">{total}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="var(--text-muted)" fontSize={8} fontWeight={700} fontFamily="inherit">MOVES</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {paths.map(p => (
          <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 6 }}
            onMouseEnter={() => setHovered(p.label)} onMouseLeave={() => setHovered(null)}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, flexShrink: 0, transition: "transform 0.2s", transform: hovered === p.label ? "scale(1.4)" : "scale(1)" }} />
            <span style={{ color: p.color, fontSize: 10, fontWeight: 800, fontVariantNumeric: "tabular-nums", minWidth: 14 }}>{p.value}</span>
            <span style={{ color: "var(--text-muted)", fontSize: 10 }}>{p.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Game Timeline Strip ───────────────────────────────────────────────────────

function TimelineStrip({ moments, onSelect }: { moments: KeyMoment[]; onSelect: (i: number) => void }) {
  // Represents all key moment positions along the game
  if (!moments.length) return null;
  const maxMove = Math.max(...moments.map(m => m.move_num));
  const W = 480, H = 32, pad = 16;

  return (
    <div style={{ overflowX: "auto", paddingBottom: 4 }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", minWidth: 280 }}>
        {/* baseline */}
        <line x1={pad} y1={H / 2} x2={W - pad} y2={H / 2} stroke="var(--border)" strokeWidth={1.5} />
        {moments.map((m, i) => {
          const x = pad + ((m.move_num - 1) / Math.max(maxMove - 1, 1)) * (W - pad * 2);
          const color = clsColor(m.classification);
          const isError = ["Blunder", "Mistake", "Miss"].some(k => m.classification.includes(k));
          return (
            <g key={i} onClick={() => onSelect(i)} style={{ cursor: "pointer" }}>
              <circle cx={x} cy={H / 2} r={isError ? 6 : 4} fill={color} opacity={0.9} />
              {isError && <circle cx={x} cy={H / 2} r={9} fill={color} opacity={0.15} />}
              <text x={x} y={H - 2} textAnchor="middle" fill="var(--text-muted)" fontSize={7} fontFamily="inherit">
                {m.move_num}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
        {moments.map((m, i) => {
          const color = clsColor(m.classification);
          return (
            <button key={i} onClick={() => onSelect(i)}
              style={{ background: `${color}18`, border: `1px solid ${color}40`, color, fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4, cursor: "pointer" }}>
              {m.move_num}. {m.san}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Radar Chart ───────────────────────────────────────────────────────────────

function RadarChart({ axes }: { axes: { label: string; value: number; color?: string }[] }) {
  const n = axes.length;
  const cx = 80, cy = 80, R = 60;
  const angle = (i: number) => ((i / n) * 2 * Math.PI) - Math.PI / 2;
  const pt = (i: number, r: number) => ({
    x: cx + r * Math.cos(angle(i)),
    y: cy + r * Math.sin(angle(i)),
  });
  const polyPts = (r: number) => axes.map((_, i) => `${pt(i, r).x},${pt(i, r).y}`).join(" ");
  const valuePts = axes.map((a, i) => `${pt(i, (a.value / 100) * R).x},${pt(i, (a.value / 100) * R).y}`).join(" ");

  return (
    <svg width="160" height="160" viewBox="0 0 160 160">
      {/* Grid rings */}
      {[0.25, 0.5, 0.75, 1].map(f => (
        <polygon key={f} points={polyPts(R * f)} fill="none" stroke="var(--border)" strokeWidth={0.8} />
      ))}
      {/* Spokes */}
      {axes.map((_, i) => {
        const end = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="var(--border)" strokeWidth={0.8} />;
      })}
      {/* Value fill */}
      <polygon points={valuePts} fill="rgba(201,162,68,0.12)" stroke="var(--gold)" strokeWidth={1.5} />
      {/* Axis labels */}
      {axes.map((a, i) => {
        const labelR = R + 14;
        const { x, y } = pt(i, labelR);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            fill="var(--text-secondary)" fontSize={8} fontWeight={700} fontFamily="inherit">
            {a.label}
          </text>
        );
      })}
      {/* Value dots */}
      {axes.map((a, i) => {
        const { x, y } = pt(i, (a.value / 100) * R);
        return <circle key={i} cx={x} cy={y} r={3} fill="var(--gold)" />;
      })}
    </svg>
  );
}

// ── Strength Bar ──────────────────────────────────────────────────────────────

function StrengthBar({ item, type }: { item: StrengthItem; type: "strength" | "weakness" }) {
  const [open, setOpen] = useState(false);
  const color = type === "strength" ? "var(--clr-best)" : "var(--clr-mistake)";
  return (
    <button onClick={() => setOpen(o => !o)} className="w-full text-left" style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
        <span style={{ color, fontSize: 10, flexShrink: 0 }}>{type === "strength" ? "✓" : "△"}</span>
        <span style={{ color: "var(--text-primary)", fontSize: 11, fontWeight: 600, flex: 1, textAlign: "left" }}>{item.title}</span>
        <span style={{ color: "var(--text-muted)", fontSize: 9 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <p style={{ color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5, paddingLeft: 18, paddingBottom: 6, textAlign: "left" }}>{item.detail}</p>
      )}
    </button>
  );
}

// ── Study Calendar ────────────────────────────────────────────────────────────

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function StudyCalendar({ items, routine }: { items: StudyItem[]; routine: string }) {
  // Distribute items across weekdays in a simple pattern
  const assignments: Record<string, StudyItem[]> = {};
  DAYS.forEach(d => { assignments[d] = []; });
  items.forEach((item, i) => {
    if (item.type === "puzzles") {
      // Puzzles go every day or alternate
      DAYS.forEach(d => assignments[d].push(item));
    } else if (item.type === "book") {
      // Books 3x / week: Mon, Wed, Fri
      ["Mon", "Wed", "Fri"].forEach(d => assignments[d].push(item));
    } else {
      // Practice: alternate days
      const practiceDays = ["Tue", "Thu", "Sat"];
      assignments[practiceDays[i % practiceDays.length]].push(item);
    }
  });
  // Dedupe per day
  DAYS.forEach(d => {
    const seen = new Set<string>();
    assignments[d] = assignments[d].filter(it => {
      const key = (it.title ?? it.description ?? it.theme ?? "") + it.type;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
        {DAYS.map(day => (
          <div key={day} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ color: "var(--text-muted)", fontSize: 9, fontWeight: 800, textAlign: "center", letterSpacing: "0.05em", paddingBottom: 4, borderBottom: "1px solid var(--border)" }}>
              {day}
            </div>
            {assignments[day].map((item, i) => {
              const isPuzzle = item.type === "puzzles";
              const isBook   = item.type === "book";
              const color    = isPuzzle ? "var(--accent-blue)" : isBook ? "var(--gold)" : "var(--clr-excellent)";
              const icon     = isPuzzle ? "◉" : isBook ? "◈" : "♟";
              const text     = isPuzzle
                ? `${item.daily_count ?? ""}p`
                : isBook
                  ? (item.title ?? "").split(" ").slice(0, 2).join(" ")
                  : (item.description ?? "").split(" ").slice(0, 2).join(" ");
              return (
                <div key={i} title={item.title ?? item.description ?? ""}
                  style={{ background: `${color}18`, border: `1px solid ${color}30`, borderRadius: 5, padding: "3px 4px", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <span style={{ color, fontSize: 9 }}>{icon}</span>
                  <span style={{ color, fontSize: 8, fontWeight: 700, textAlign: "center", lineHeight: 1.2, wordBreak: "break-word" }}>{text}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {routine && (
        <p style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 10, lineHeight: 1.5, fontStyle: "italic" }}>{routine}</p>
      )}
    </div>
  );
}

// ── Checklist ─────────────────────────────────────────────────────────────────

function Checklist({ items }: { items: string[] }) {
  const [checked, setChecked] = useState<boolean[]>(() => items.map(() => false));
  const allDone = checked.every(Boolean);

  // Sync length if items change
  useEffect(() => { setChecked(items.map(() => false)); }, [items.length]);

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((q, i) => (
          <button key={i} onClick={() => setChecked(c => { const n = [...c]; n[i] = !n[i]; return n; })}
            style={{ background: checked[i] ? "rgba(94,166,100,0.08)" : "var(--bg-elevated)", border: `1px solid ${checked[i] ? "rgba(94,166,100,0.3)" : "var(--border)"}`, borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
            <span style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${checked[i] ? "var(--clr-best)" : "var(--border-strong)"}`, background: checked[i] ? "var(--clr-best)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1, transition: "all 0.15s" }}>
              {checked[i] && <span style={{ color: "#fff", fontSize: 10, fontWeight: 900, lineHeight: 1 }}>✓</span>}
            </span>
            <span style={{ color: checked[i] ? "var(--text-muted)" : "var(--text-secondary)", fontSize: 11, lineHeight: 1.5, textDecoration: checked[i] ? "line-through" : "none", flex: 1 }}>{q}</span>
          </button>
        ))}
      </div>
      {allDone && (
        <div style={{ marginTop: 12, background: "rgba(94,166,100,0.1)", border: "1px solid rgba(94,166,100,0.3)", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--clr-best)", fontSize: 14 }}>✓</span>
          <span style={{ color: "var(--clr-best)", fontSize: 11, fontWeight: 700 }}>Ready to play — you&apos;ve reviewed every checkpoint.</span>
        </div>
      )}
    </div>
  );
}

// ── PDF Print ─────────────────────────────────────────────────────────────────

export function printReport(data: ReportData, meta: Record<string, string>) {
  const w = meta.White ?? "White", b = meta.Black ?? "Black";
  const gradeBar = (g: string) => `<span style="display:inline-block;width:40px;height:6px;border-radius:3px;background:${g === "A" ? "#5ea664" : g === "B" ? "#8bc34a" : g === "C" ? "#e6a817" : "#e05252"};vertical-align:middle;margin-left:8px;"></span>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Chess Report – ${w} vs ${b}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; background: #fff; padding: 40px; line-height: 1.6; font-size: 12px; }
  h1 { font-size: 22px; font-weight: 900; color: #c9a244; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 11px; margin-bottom: 32px; }
  h2 { font-size: 11px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #888; margin: 24px 0 10px; border-bottom: 1px solid #eee; padding-bottom: 6px; }
  .verdict { background: #fffaf0; border-left: 3px solid #c9a244; padding: 12px 16px; border-radius: 4px; font-style: italic; font-size: 13px; margin-bottom: 8px; }
  .chip { display: inline-block; background: #f5f0e6; color: #c9a244; border: 1px solid #e0cc99; border-radius: 4px; padding: 2px 8px; font-size: 9px; font-weight: 700; margin-right: 6px; }
  .grades { display: flex; gap: 12px; margin-bottom: 8px; }
  .grade-card { flex: 1; border: 1px solid #eee; border-radius: 8px; padding: 10px; text-align: center; }
  .grade-letter { font-size: 28px; font-weight: 900; }
  .grade-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: #888; }
  .grade-note { font-size: 10px; color: #555; margin-top: 4px; }
  .priority { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
  .rank-badge { width: 22px; height: 22px; border-radius: 50%; background: #e8f0fe; color: #4f8ef7; font-weight: 900; font-size: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .moment { background: #fafafa; border: 1px solid #eee; border-radius: 6px; padding: 10px; margin-bottom: 8px; }
  .moment-header { font-weight: 700; font-size: 12px; margin-bottom: 4px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .strength { background: #f0faf2; border: 1px solid #b8e0bd; border-radius: 6px; padding: 10px; }
  .weakness { background: #fef6f0; border: 1px solid #f5c5a3; border-radius: 6px; padding: 10px; }
  .item-title { font-weight: 700; font-size: 11px; }
  .item-detail { color: #555; font-size: 10px; margin-top: 2px; }
  .study-item { padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
  .check-item { display: flex; gap: 8px; padding: 6px 0; }
  .check-box { width: 14px; height: 14px; border: 2px solid #ccc; border-radius: 3px; flex-shrink: 0; margin-top: 1px; }
  .coach { background: #f0f4ff; border-left: 3px solid #4f8ef7; padding: 10px 14px; border-radius: 4px; font-style: italic; }
  .goal { background: #f0faf2; border: 1px solid #b8e0bd; border-radius: 6px; padding: 10px; margin-top: 10px; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #eee; color: #aaa; font-size: 10px; text-align: center; }
  @media print { body { padding: 20px; } }
</style></head><body>
<h1>✦ AI Coaching Report</h1>
<p class="subtitle">${w} vs ${b}${meta.Date && !meta.Date.startsWith("????") ? " · " + meta.Date : ""}${meta.Event && meta.Event !== "?" ? " · " + meta.Event : ""}</p>

<h2>The Verdict</h2>
<div class="verdict">"${data.verdict}"</div>
<span class="chip">${data.game_type}</span>${data.opening?.name ? `<span class="chip">${data.opening.eco} · ${data.opening.name}</span>` : ""}

<h2>Phase Grades</h2>
<div class="grades">
  ${["opening","middlegame","endgame"].map(phase => {
    const g = data.phase_grades[phase as keyof typeof data.phase_grades];
    const color = g.grade === "A" ? "#5ea664" : g.grade === "B" ? "#8bc34a" : g.grade === "C" ? "#e6a817" : "#e05252";
    return `<div class="grade-card"><div class="grade-label">${phase}</div><div class="grade-letter" style="color:${color}">${g.grade}</div>${gradeBar(g.grade)}<div class="grade-note">${g.note}</div></div>`;
  }).join("")}
</div>

<h2>Top Priorities</h2>
${data.priorities.map(p => `<div class="priority"><div class="rank-badge">${p.rank}</div><div><div class="item-title">${p.title}</div><div class="item-detail">${p.action}</div></div></div>`).join("")}

<h2>Key Moments</h2>
${data.key_moments.map(m => {
  const color = m.classification.includes("Blunder") || m.classification.includes("Miss") ? "#e05252" : m.classification.includes("Mistake") ? "#e6a817" : "#888";
  return `<div class="moment"><div class="moment-header" style="color:${color}">Move ${m.move_num}: ${m.san} — ${m.classification}${m.cp_loss ? ` (−${m.cp_loss}cp)` : ""}</div><div style="color:#555;font-size:11px;margin-top:4px;">${m.label}</div><div style="margin-top:6px;font-size:10px;color:#444"><strong>Principle:</strong> ${m.principle}</div><div style="margin-top:4px;font-size:10px;color:#444"><strong>What went wrong:</strong> ${m.what_happened}</div>${m.best ? `<div style="margin-top:4px;font-size:10px;background:#f0faf2;padding:6px;border-radius:4px;"><strong style="color:#5ea664">Best: ${m.best}</strong> — ${m.best_explanation}</div>` : ""}</div>`;
}).join("")}

<h2>Tactical Patterns</h2>
${data.tactical_patterns.map(t => `<div style="padding:4px 0"><span style="font-weight:700">${t.name}</span> — ${t.description}</div>`).join("")}

<h2>Performance DNA</h2>
<div class="grid2">
  <div class="strength"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:#5ea664;margin-bottom:8px">✓ Strengths</div>${data.strengths.map(s => `<div style="margin-bottom:8px"><div class="item-title">${s.title}</div><div class="item-detail">${s.detail}</div></div>`).join("")}</div>
  <div class="weakness"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:#e0823a;margin-bottom:8px">△ To Improve</div>${data.weaknesses.map(w => `<div style="margin-bottom:8px"><div class="item-title">${w.title}</div><div class="item-detail">${w.detail}</div></div>`).join("")}</div>
</div>

<h2>Opening</h2>
<div><strong>${data.opening.name} (${data.opening.eco})</strong></div>
<div style="color:#555;font-size:11px;margin-top:4px">${data.opening.assessment}</div>
${data.opening.deviation ? `<div style="background:#fff8e6;border:1px solid #e0cc99;border-radius:4px;padding:8px;margin-top:8px;font-size:11px"><strong>Theory departure:</strong> Move ${data.opening.deviation.move_num}: ${data.opening.deviation.san} — ${data.opening.deviation.note}</div>` : ""}

<h2>Study Plan</h2>
<div style="font-size:11px;color:#555;margin-bottom:8px">Priority phase: <strong>${data.study_plan.priority_phase}</strong></div>
${data.study_plan.items.map((item, i) => {
  const label = item.type === "book" ? `"${item.title}" by ${item.author}${item.chapter ? " — " + item.chapter : ""}` : item.type === "puzzles" ? `${item.platform}: ${item.theme} — ${item.daily_count} puzzles/day (${item.target_accuracy})` : `${item.description} — ${item.frequency}`;
  return `<div class="study-item"><div class="item-title">${i + 1}. ${label}</div>${item.why ? `<div class="item-detail">${item.why}</div>` : item.how ? `<div class="item-detail">${item.how}</div>` : ""}</div>`;
}).join("")}
<div class="goal"><div style="font-size:9px;font-weight:800;color:#5ea664;text-transform:uppercase;letter-spacing:0.1em">✦ 4-Week Goal</div><div style="font-size:11px;margin-top:4px">${data.study_plan.four_week_goal}</div></div>

<h2>Pre-Move Checklist</h2>
${data.checklist.map(q => `<div class="check-item"><div class="check-box"></div><div style="font-size:11px">${q}</div></div>`).join("")}

<h2>Coach&apos;s Note</h2>
<div class="coach">"${data.coach_note}"</div>

<div class="footer">Generated by thechess.ai · ${new Date().toLocaleDateString()}</div>
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.print(); }, 400);
}

// ── Section head ──────────────────────────────────────────────────────────────

function SectionHead({ icon, title, accent }: { icon: string; title: string; accent?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span style={{ color: accent ?? "var(--gold)", fontSize: 12 }}>{icon}</span>
      <span style={{ color: accent ?? "var(--text-secondary)", fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>{title}</span>
    </div>
  );
}

// ── Moment card (redesigned) ──────────────────────────────────────────────────

function MomentCard({ m, defaultOpen }: { m: KeyMoment; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const color = clsColor(m.classification);
  const badge = clsBadge(m.classification);
  return (
    <button onClick={() => setOpen(o => !o)} className="w-full text-left rounded-xl overflow-hidden transition-all"
      style={{ background: `${color}0c`, border: `1px solid ${color}30` }}>
      <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ background: `${color}22`, color, border: `1px solid ${color}44`, minWidth: 52, fontSize: 11, fontWeight: 900, padding: "2px 6px", borderRadius: 4, textAlign: "center", flexShrink: 0 }}>
          {m.move_num}. {m.san}
        </span>
        <span style={{ color, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{badge} {m.classification}</span>
        {m.cp_loss != null && m.cp_loss > 0 &&
          <span style={{ color: "var(--text-muted)", fontSize: 10, flexShrink: 0 }}>{"−"}{m.cp_loss}{"cp"}</span>}
        <span style={{ color: "var(--text-primary)", fontSize: 11, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}</span>
        <span style={{ color: "var(--text-muted)", fontSize: 10, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "0 12px 12px", borderTop: `1px solid ${color}20` }}>
          {/* Side-by-side move comparison */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 6, alignItems: "center", padding: "10px 0 8px" }}>
            <div style={{ background: `${color}18`, border: `1px solid ${color}40`, borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
              <div style={{ color: "var(--text-muted)", fontSize: 9, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Your move</div>
              <div style={{ color, fontSize: 16, fontWeight: 900, fontFamily: "var(--font-mono, monospace)" }}>{m.san}</div>
              {m.cp_loss != null && m.cp_loss > 0 && (
                <div style={{ color, fontSize: 10, fontWeight: 700, marginTop: 2 }}>{"−"}{m.cp_loss}cp</div>
              )}
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 700 }}>→</div>
            <div style={{ background: "rgba(94,166,100,0.1)", border: "1px solid rgba(94,166,100,0.3)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
              <div style={{ color: "var(--text-muted)", fontSize: 9, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Best</div>
              <div style={{ color: "var(--clr-best)", fontSize: 16, fontWeight: 900, fontFamily: "var(--font-mono, monospace)" }}>{m.best ?? "—"}</div>
              {m.cp_loss != null && m.cp_loss > 0 && (
                <div style={{ color: "var(--clr-best)", fontSize: 10, fontWeight: 700, marginTop: 2 }}>+{m.cp_loss}cp</div>
              )}
            </div>
          </div>
          {/* Principle pull-quote */}
          <div style={{ background: "var(--bg-elevated)", borderLeft: "2px solid var(--accent-blue)", padding: "6px 10px", borderRadius: "0 6px 6px 0", marginBottom: 8 }}>
            <span style={{ color: "var(--accent-blue)", fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>Principle · </span>
            <span style={{ color: "var(--text-primary)", fontSize: 11, fontStyle: "italic" }}>{m.principle}</span>
          </div>
          {/* What went wrong */}
          <p style={{ color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5 }}>{m.what_happened}</p>
          {m.best && m.best_explanation && (
            <div style={{ background: "rgba(94,166,100,0.08)", border: "1px solid rgba(94,166,100,0.25)", borderRadius: 8, padding: "8px 10px", marginTop: 8 }}>
              <span style={{ color: "var(--clr-best)", fontSize: 10, fontWeight: 800 }}>✓ Why {m.best} is best: </span>
              <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{m.best_explanation}</span>
            </div>
          )}
        </div>
      )}
    </button>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

type Tab = "overview" | "gamefilm" | "dna" | "nextsteps";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview",  label: "Overview",  icon: "◎" },
  { id: "gamefilm",  label: "Game Film", icon: "✦" },
  { id: "dna",       label: "DNA",       icon: "∿" },
  { id: "nextsteps", label: "Next Steps",icon: "⟶" },
];

// ── Main ──────────────────────────────────────────────────────────────────────

export function AIReport({ onClose }: { onClose: () => void }) {
  const aiReport    = useGameStore(s => s.aiReport);
  const analyzing   = useGameStore(s => s.analyzing);
  const movesData   = useGameStore(s => s.movesData);
  const metadata    = useGameStore(s => s.metadata);
  const playerColor = useGameStore(s => s.playerColor);
  const estimatedElo = useGameStore(s => s.estimatedElo);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [filmIdx,   setFilmIdx]   = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Scroll body to top on tab change
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [activeTab]);

  const qCounts = countQuality(movesData, playerColor === "white" ? "White" : "Black");

  let data: ReportData | null = null;
  const hasReport = !!aiReport && !aiReport.startsWith("No engine data") && !aiReport.startsWith("AI model not available");
  if (hasReport) { try { data = JSON.parse(aiReport!); } catch { /* plain-text fallback */ } }

  const donutSlices: DonutSlice[] = [
    { label: "Brilliant", value: qCounts.brilliant, color: "var(--clr-brilliant)", badge: "!!" },
    { label: "Best",      value: qCounts.best,      color: "var(--clr-best)",      badge: "✓"  },
    { label: "Excellent", value: qCounts.excellent, color: "var(--clr-excellent)", badge: "!"  },
    { label: "Good",      value: qCounts.good,      color: "var(--clr-good)",      badge: ""   },
    { label: "Inaccuracy",value: qCounts.inaccuracy,color: "var(--clr-inaccuracy)",badge: "?!" },
    { label: "Mistake",   value: qCounts.mistake,   color: "var(--clr-mistake)",   badge: "?"  },
    { label: "Blunder",   value: qCounts.blunder,   color: "var(--clr-blunder)",   badge: "??" },
  ].filter(s => s.value > 0);

  // Radar axes (derived from strengths/weaknesses if available)
  const radarAxes = data ? (() => {
    const phases: Record<string, number> = { "A": 90, "B": 70, "C": 45, "D": 20, "N/A": 0 };
    return [
      { label: "Opening",    value: phases[data.phase_grades.opening.grade]    ?? 50 },
      { label: "Middlegame", value: phases[data.phase_grades.middlegame.grade] ?? 50 },
      { label: "Endgame",    value: phases[data.phase_grades.endgame.grade]    ?? 50 },
      { label: "Tactics",    value: data.tactical_patterns?.length > 2 ? 75 : data.tactical_patterns?.length > 0 ? 50 : 30 },
      { label: "Accuracy",   value: Math.min(100, qCounts.best + qCounts.excellent > 0 ? Math.round(((qCounts.best + qCounts.excellent) / Math.max(1, qCounts.best + qCounts.excellent + qCounts.mistake + qCounts.blunder)) * 100) : 50) },
      { label: "Consistency",value: qCounts.blunder === 0 ? 85 : qCounts.blunder === 1 ? 60 : 35 },
    ];
  })() : [];

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "modal-fade-in 0.2s ease" }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--bg-surface)", border: "1px solid rgba(201,162,68,0.22)", borderRadius: 20, width: "min(780px, 100%)", maxHeight: "calc(100vh - 48px)", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 32px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(201,162,68,0.08)", animation: "modal-slide-up 0.2s ease" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)", padding: "13px 18px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ color: "var(--gold)", fontSize: 14 }}>{"✦"}</span>
          <span style={{ color: "var(--text-primary)", fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", flex: 1 }}>AI Coaching Report</span>
          {data && (
            <>
              <span style={{ background: "var(--gold-subtle)", color: "var(--gold)", border: "1px solid var(--gold-border)", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, letterSpacing: "0.06em" }}>{data.game_type}</span>
              <span
                title={estimatedElo != null
                  ? `This report's vocabulary and depth are calibrated to ~${estimatedElo} Elo, detected from this game's rating headers or move accuracy.`
                  : "No rating detected — defaulting to Intermediate-level coaching."}
                style={{ background: "rgba(91,142,245,0.1)", color: "var(--accent-blue)", border: "1px solid rgba(91,142,245,0.25)", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, cursor: "help" }}
              >
                {"🎯 "}{eloBandLabel(estimatedElo)}{estimatedElo != null ? ` ~${estimatedElo}` : ""}
              </span>
              <span title="Generated by chessAIlytics AI coaching" style={{ background: "rgba(91,142,245,0.1)", color: "var(--accent-blue)", border: "1px solid rgba(91,142,245,0.25)", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, cursor: "default" }}>AI Coach</span>
              <button onClick={() => printReport(data!, metadata ?? {})}
                style={{ color: "var(--text-secondary)", border: "1px solid var(--border-strong)", background: "transparent", fontSize: 11, padding: "4px 10px", borderRadius: 8, cursor: "pointer", transition: "all 0.15s" }}
                className="hover:border-[var(--gold-border)] hover:text-[var(--gold)]">
                {"↓ PDF"}
              </button>
            </>
          )}
          <button onClick={onClose}
            style={{ width: 30, height: 30, borderRadius: 8, background: "var(--bg-surface)", border: "1px solid var(--border-strong)", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            className="hover:border-[rgba(224,82,82,0.5)] hover:text-[var(--clr-blunder)]">
            {"✕"}
          </button>
        </div>

        {/* Tab bar */}
        {data && (
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)", padding: "0 4px", flexShrink: 0 }}>
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{ padding: "10px 14px", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", border: "none", borderBottom: activeTab === tab.id ? "2px solid var(--gold)" : "2px solid transparent", background: "transparent", color: activeTab === tab.id ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, transition: "color 0.15s", whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 10 }}>{tab.icon}</span>{tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Scrollable body */}
        <div ref={bodyRef} style={{ overflowY: "auto", flex: 1, scrollbarWidth: "thin", scrollbarColor: "var(--border-strong) transparent" }}>

          {/* Loading */}
          {analyzing && !aiReport && (
            <div style={{ padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                <span style={{ color: movesData.length > 0 ? "var(--gold)" : "var(--accent-blue)", animation: "report-icon-pulse 1.5s ease-in-out infinite" }}>{"✦"}</span>
                <span style={{ color: "var(--text-secondary)", fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                  {movesData.length > 0 ? "AI is writing your report…" : "Stockfish evaluating positions…"}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[75, 55, 88, 45, 66, 80, 50, 62, 72, 40].map((w, i) => (
                  <div key={i} style={{ height: 9, borderRadius: 5, width: w + "%", background: movesData.length > 0 ? "rgba(201,162,68,0.1)" : "var(--bg-elevated)", animation: `report-shimmer 1.8s ease-in-out ${i * 0.1}s infinite` }} />
                ))}
              </div>
            </div>
          )}

          {/* No report */}
          {!analyzing && !hasReport && (
            <div style={{ padding: 48, textAlign: "center" }}>
              <div style={{ color: "var(--gold)", fontSize: 28, marginBottom: 12 }}>{"✦"}</div>
              <p style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>Import and analyse a game to generate your AI coaching report.</p>
            </div>
          )}

          {/* Plain text fallback */}
          {hasReport && !data && (
            <div style={{ color: "var(--text-secondary)", padding: 20, fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{aiReport}</div>
          )}

          {/* Structured report */}
          {data && (
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>

              {/* ═══ OVERVIEW ═══ */}
              {activeTab === "overview" && (
                <>
                  {/* Verdict */}
                  <div style={{ background: "linear-gradient(135deg, var(--gold-subtle), rgba(201,162,68,0.04))", border: "1px solid var(--gold-border)", borderRadius: 14, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", right: -24, top: -24, width: 100, height: 100, background: "radial-gradient(circle, rgba(201,162,68,0.08), transparent 70%)", pointerEvents: "none" }} />
                    <p style={{ color: "var(--gold)", fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>{"✦ The Verdict"}</p>
                    <p style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 500, lineHeight: 1.65, fontStyle: "italic" }}>&ldquo;{data.verdict}&rdquo;</p>
                    <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ background: "rgba(201,162,68,0.18)", color: "var(--gold)", border: "1px solid rgba(201,162,68,0.35)", fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 4 }}>{data.game_type}</span>
                      {data.opening?.name && <span style={{ background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)", fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 4 }}>{data.opening.eco} · {data.opening.name}</span>}
                    </div>
                  </div>

                  {/* Phase arcs + donut, side by side */}
                  <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                    {/* Phase arcs */}
                    <div style={{ flex: "1 1 280px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 10px" }}>
                      <p style={{ color: "var(--text-muted)", fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12, textAlign: "center" }}>Phase Grades</p>
                      <div style={{ display: "flex", gap: 4, justifyContent: "space-around" }}>
                        <PhaseArc label="Opening"    grade={data.phase_grades.opening.grade}    note={data.phase_grades.opening.note} />
                        <PhaseArc label="Middlegame" grade={data.phase_grades.middlegame.grade} note={data.phase_grades.middlegame.note} />
                        <PhaseArc label="Endgame"    grade={data.phase_grades.endgame.grade}    note={data.phase_grades.endgame.note} />
                      </div>
                    </div>
                    {/* Move quality donut */}
                    {donutSlices.length > 0 && (
                      <div style={{ flex: "0 0 auto", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px" }}>
                        <p style={{ color: "var(--text-muted)", fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12 }}>Move Quality</p>
                        <DonutChart slices={donutSlices} />
                      </div>
                    )}
                  </div>

                  {/* Top priorities */}
                  <section>
                    <SectionHead icon="◈" title="Top Priorities" accent="var(--clr-inaccuracy)" />
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {data.priorities.map((p, i) => {
                        const borderColor = i === 0 ? "var(--clr-blunder)" : i === 1 ? "var(--clr-inaccuracy)" : "var(--clr-best)";
                        return (
                          <div key={i} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderLeft: `3px solid ${borderColor}`, borderRadius: "0 10px 10px 0", padding: "10px 14px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                            <span style={{ background: `${borderColor}22`, color: borderColor, minWidth: 22, height: 22, borderRadius: "50%", fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{p.rank}</span>
                            <div>
                              <p style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 700, lineHeight: 1.3 }}>{p.title}</p>
                              <p style={{ color: "var(--text-secondary)", fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>{p.action}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* Coach's note — margin annotation style */}
                  <div style={{ borderLeft: "3px solid var(--accent-blue)", paddingLeft: 14 }}>
                    <p style={{ color: "var(--accent-blue)", fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>◎ Coach&apos;s Note</p>
                    <p style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.6, fontStyle: "italic" }}>&ldquo;{data.coach_note}&rdquo;</p>
                  </div>
                </>
              )}

              {/* ═══ GAME FILM ═══ */}
              {activeTab === "gamefilm" && (
                <>
                  {data.key_moments.length > 0 && (
                    <section>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                        <SectionHead icon="✦" title="Game Timeline" />
                        <span style={{ color: "var(--text-muted)", fontSize: 10, fontVariantNumeric: "tabular-nums" }}>{data.key_moments.length} moments reviewed</span>
                      </div>
                      <TimelineStrip moments={data.key_moments} onSelect={i => setFilmIdx(i)} />
                    </section>
                  )}

                  <section>
                    <SectionHead icon="◎" title="Key Moments" accent="var(--clr-inaccuracy)" />
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {data.key_moments.map((m, i) => <MomentCard key={i} m={m} defaultOpen={i === filmIdx} />)}
                    </div>
                  </section>

                  {data.tactical_patterns?.length > 0 && (
                    <section>
                      <SectionHead icon="◉" title="Tactical Patterns" />
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {data.tactical_patterns.map((t, i) => (
                          <div key={i} title={t.description}
                            style={{ background: "rgba(91,142,245,0.1)", border: "1px solid rgba(91,142,245,0.25)", color: "var(--accent-blue)", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6, cursor: "default" }}>
                            {t.name}
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
                        {data.tactical_patterns.map((t, i) => (
                          <p key={i} style={{ color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5 }}>
                            <span style={{ color: "var(--accent-blue)", fontWeight: 700 }}>{t.name}</span>{" — "}{t.description}
                          </p>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}

              {/* ═══ DNA ═══ */}
              {activeTab === "dna" && (
                <>
                  {/* Radar + breakdown side by side */}
                  <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                      <p style={{ color: "var(--text-muted)", fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>Performance Radar</p>
                      <RadarChart axes={radarAxes} />
                    </div>
                    <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ background: "rgba(94,166,100,0.06)", border: "1px solid rgba(94,166,100,0.2)", borderRadius: 12, padding: "12px 14px" }}>
                        <p style={{ color: "var(--clr-best)", fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>✓ Strengths</p>
                        {data.strengths.map((s, i) => <StrengthBar key={i} item={s} type="strength" />)}
                      </div>
                      <div style={{ background: "rgba(224,130,58,0.06)", border: "1px solid rgba(224,130,58,0.2)", borderRadius: 12, padding: "12px 14px" }}>
                        <p style={{ color: "var(--clr-mistake)", fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>△ To Improve</p>
                        {data.weaknesses.map((w, i) => <StrengthBar key={i} item={w} type="weakness" />)}
                      </div>
                    </div>
                  </div>

                  {/* Opening section */}
                  <section>
                    <SectionHead icon="◈" title="Opening" />
                    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 800 }}>{data.opening.name}</span>
                        <span style={{ background: "rgba(91,142,245,0.15)", color: "var(--accent-blue)", fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 4 }}>{data.opening.eco}</span>
                      </div>
                      <p style={{ color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5, marginBottom: 8 }}>{data.opening.assessment}</p>
                      {data.opening.deviation && (
                        <div style={{ background: "var(--clr-inaccuracy)12", border: "1px solid var(--clr-inaccuracy)30", borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}>
                          <span style={{ color: "var(--clr-inaccuracy)", fontSize: 9, fontWeight: 800, textTransform: "uppercase" }}>{"⚑ Theory departure · "}</span>
                          <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>Move {data.opening.deviation.move_num}: <strong>{data.opening.deviation.san}</strong> — {data.opening.deviation.note}</span>
                        </div>
                      )}
                      {data.opening.resources?.length > 0 && (
                        <div>
                          <p style={{ color: "var(--text-muted)", fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Resources</p>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {data.opening.resources.map((r, i) => (
                              <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                                <span style={{ color: "var(--gold)", fontSize: 10, marginTop: 2 }}>{r.type === "book" ? "◈" : "◉"}</span>
                                <p style={{ color: "var(--text-secondary)", fontSize: 11 }}>
                                  {r.type === "book" && <><strong>&ldquo;{r.title}&rdquo;</strong>{" by "}{r.author}{r.chapter ? `, ${r.chapter}` : ""}</>}
                                  {r.type === "drill" && <><strong>{r.platform}</strong>{": "}{r.topic}{r.time ? ` · ${r.time}` : ""}</>}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                </>
              )}

              {/* ═══ NEXT STEPS ═══ */}
              {activeTab === "nextsteps" && (
                <>
                  {/* 4-week goal — hero */}
                  <div style={{ background: "linear-gradient(135deg, rgba(94,166,100,0.1), rgba(94,166,100,0.04))", border: "1px solid rgba(94,166,100,0.3)", borderRadius: 14, padding: "16px 18px" }}>
                    <p style={{ color: "var(--clr-best)", fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>{"✦ 4-Week Goal"}</p>
                    <p style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 700, lineHeight: 1.5 }}>{data.study_plan.four_week_goal}</p>
                  </div>

                  {/* Study calendar */}
                  <section>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <SectionHead icon="⟶" title="Weekly Study Plan" />
                      <span style={{ background: "rgba(91,142,245,0.1)", color: "var(--accent-blue)", border: "1px solid rgba(91,142,245,0.2)", fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 4 }}>Priority: {data.study_plan.priority_phase}</span>
                    </div>
                    <StudyCalendar items={data.study_plan.items} routine={data.study_plan.daily_routine} />
                  </section>

                  {/* Study items list (compact) */}
                  <section>
                    <SectionHead icon="◈" title="Study Resources" />
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {data.study_plan.items.map((item, i) => (
                        <div key={i} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start" }}>
                          <span style={{ color: "var(--gold)", fontSize: 14, flexShrink: 0, marginTop: 1 }}>{item.type === "book" ? "◈" : item.type === "puzzles" ? "◉" : "♟"}</span>
                          <div style={{ minWidth: 0 }}>
                            {item.type === "book" && (
                              <>
                                <p style={{ color: "var(--text-primary)", fontSize: 11, fontWeight: 700 }}>&ldquo;{item.title}&rdquo; <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>by {item.author}</span></p>
                                {item.chapter && <p style={{ color: "var(--accent-blue)", fontSize: 10, marginTop: 1 }}>{item.chapter}</p>}
                                {item.why && <p style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 2 }}>{item.why}</p>}
                              </>
                            )}
                            {item.type === "puzzles" && (
                              <>
                                <p style={{ color: "var(--text-primary)", fontSize: 11, fontWeight: 700 }}>{item.platform} · <span style={{ color: "var(--accent-blue)" }}>{item.theme}</span></p>
                                <p style={{ color: "var(--text-secondary)", fontSize: 10, marginTop: 1 }}>{item.daily_count} puzzles/day · target {item.target_accuracy}</p>
                                {item.why && <p style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 2 }}>{item.why}</p>}
                              </>
                            )}
                            {item.type === "practice" && (
                              <>
                                <p style={{ color: "var(--text-primary)", fontSize: 11, fontWeight: 700 }}>{item.description}</p>
                                <p style={{ color: "var(--text-secondary)", fontSize: 10, marginTop: 1 }}>{item.frequency}</p>
                                {item.how && <p style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 2 }}>{item.how}</p>}
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Checklist */}
                  {data.checklist?.length > 0 && (
                    <section>
                      <SectionHead icon="◆" title="Pre-Game Checklist" />
                      <p style={{ color: "var(--text-muted)", fontSize: 10, marginBottom: 10, lineHeight: 1.5 }}>Tailored to your error patterns — tick each before you play your next game.</p>
                      <Checklist items={data.checklist} />
                    </section>
                  )}
                </>
              )}

            </div>
          )}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: "@keyframes modal-fade-in { from { opacity: 0; } to { opacity: 1; } } @keyframes modal-slide-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } } @keyframes report-icon-pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } } @keyframes report-shimmer { 0%,100% { opacity: 0.35; } 50% { opacity: 0.75; } }" }} />
    </div>
  );
}

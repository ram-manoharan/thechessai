"use client";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function noise(dur: number, freq: number, vol: number, decay: number) {
  try {
    const c = getCtx();
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    const src = c.createBufferSource();
    src.buffer = buf;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = freq; lp.Q.value = 0.5;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(lp); lp.connect(g); g.connect(c.destination); src.start();
  } catch { /* no-op if audio not available */ }
}

function tone(freq: number, dur: number, vol: number) {
  try {
    const c = getCtx();
    const o = c.createOscillator(); o.type = "sine"; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
  } catch { /* no-op */ }
}

const mv   = () => noise(0.062, 480, 0.52, 3.2);
const cap  = () => noise(0.075, 650, 0.70, 2.5);
const cas  = () => { mv(); setTimeout(mv, 85); };
const chk  = () => { mv(); tone(740, 0.22, 0.18); };
const mate = () => { cap(); tone(880, 0.15, 0.22); setTimeout(() => tone(660, 0.2, 0.18), 120); };

export type SoundType = "move" | "capture" | "castle" | "check" | "checkmate";

export function sanToSound(san: string): SoundType {
  if (!san) return "move";
  if (san.startsWith("O-O")) return "castle";
  if (san.includes("x"))     return "capture";
  if (san.endsWith("#"))     return "checkmate";
  if (san.endsWith("+"))     return "check";
  return "move";
}

export function playSound(type: SoundType) {
  switch (type) {
    case "capture":    cap();  break;
    case "castle":     cas();  break;
    case "check":      chk();  break;
    case "checkmate":  mate(); break;
    default:           mv();
  }
}

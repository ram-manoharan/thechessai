"use client";
import { useEffect, useRef, useState } from "react";
import { buildMoveTimeline, type TimelineEntry } from "./coachVoice";

export type ActiveMove = { from: string; to: string } | null;

/** Speaks `text` aloud (browser-native Web Speech API -- zero network
 * round-trip, starts the instant text is ready) and tracks which chess
 * move is currently being talked about, for a board to highlight in sync.
 * Effect is keyed on [text, fen, enabled] as plain primitives, so a parent
 * re-render passing the same string value (e.g. from the sibling eval-bar
 * fetch) does not re-trigger this by React's default comparison. */
export function useCoachVoice(text: string, fen: string, enabled: boolean) {
  const [activeMove, setActiveMove] = useState<ActiveMove>(null);
  const [speaking, setSpeaking] = useState(false);
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!enabled || !text || !synth) {
      // Necessary reset when a dependency change (new empty text, voice
      // toggled off, etc.) makes this effect a no-op -- not a redundant
      // call, the previous run's speech/highlight state must be cleared.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveMove(null);
      setSpeaking(false);
      return;
    }

    const timeline: TimelineEntry[] = buildMoveTimeline(text, fen);
    const utterance = new SpeechSynthesisUtterance(text);

    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const clear = () => {
      setActiveMove(null);
      setSpeaking(false);
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    };

    utterance.onstart = () => {
      setSpeaking(true);
      // Chrome silently stalls utterances after ~15s of continuous speech --
      // a real risk here since a full reply can run 25-35s+. A pause/resume
      // heartbeat is the documented workaround.
      heartbeat = setInterval(() => { synth.pause(); synth.resume(); }, 10000);
    };
    utterance.onboundary = e => {
      let active: TimelineEntry | null = null;
      for (const entry of timeline) {
        if (entry.charStart <= e.charIndex) active = entry;
        else break;
      }
      setActiveMove(active ? { from: active.from, to: active.to } : null);
    };
    utterance.onend = clear;
    utterance.onerror = clear;

    synth.cancel();
    // cancel() immediately followed by speak() in the same tick silently
    // drops the new utterance in Chrome -- a small delay is the standard
    // workaround.
    const startTimer = setTimeout(() => synth.speak(utterance), 50);

    stopRef.current = () => { synth.cancel(); clear(); };

    return () => {
      clearTimeout(startTimer);
      synth.cancel();
      clear();
    };
  }, [text, fen, enabled]);

  return { activeMove, speaking, stop: () => stopRef.current() };
}

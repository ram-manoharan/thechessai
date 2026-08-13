"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { MoveData, Opening, GameMetadata, KidMoveCommentary } from "./api";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type GameStore = {
  // Input
  pgn:          string;
  analysisKey:  number;   // increments each time analysis should (re-)start
  playerColor:  "white" | "black";
  // Analysis result
  movesData:    MoveData[];
  positions:    string[];
  opening:      Opening | null;
  metadata:     GameMetadata;
  aiReport:        string | null;
  kidCommentaries: Record<number, KidMoveCommentary>;
  estimatedElo:    number | null;
  // Navigation
  currentIdx:   number;   // -1 = start
  // Explore mode
  exploreMode:  boolean;
  // UI state
  analyzing:    boolean;
  error:        string | null;
  flipped:      boolean;
  showArrows:   boolean;
  soundEnabled: boolean;
  kidMode:      boolean;

  // Actions
  setPgn:          (pgn: string) => void;
  startAnalysis:   (pgn: string) => void;   // reset + set pgn + bump key atomically
  setPlayerColor:  (c: "white" | "black") => void;
  setKidMode:      (v: boolean) => void;
  setAnalyzing:    (v: boolean) => void;
  setError:        (e: string | null) => void;
  setResult:       (r: { movesData: MoveData[]; positions: string[]; opening: Opening; metadata: GameMetadata; estimatedElo?: number | null }) => void;
  setAiReport:         (text: string) => void;
  setKidCommentaries:  (data: Record<number, KidMoveCommentary>) => void;
  navigateTo:      (idx: number) => void;
  toggleFlip:      () => void;
  toggleArrows:    () => void;
  toggleSound:     () => void;
  setExploreMode:  (v: boolean) => void;
  reset:           () => void;

  // Derived helpers
  currentFen:  () => string;
  currentMove: () => MoveData | null;
};

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      pgn:          "",
      analysisKey:  0,
      playerColor:  "white",
      movesData:    [],
      positions:    [],
      opening:      null,
      metadata:     {},
      aiReport:        null,
      kidCommentaries: {},
      estimatedElo:    null,
      currentIdx:      -1,
      exploreMode:  false,
      analyzing:    false,
      error:        null,
      flipped:      false,
      showArrows:   true,
      soundEnabled: true,
      kidMode:      false,

      setPgn:         (pgn)         => set({ pgn }),
      startAnalysis:  (pgn)         => set(s => ({
        pgn,
        analysisKey: s.analysisKey + 1,
        // Intentionally NOT clearing movesData/aiReport here — they persist in
        // localStorage so a fresh page reload still sees non-empty results and
        // the guard in the analyze page's useEffect blocks spurious auto-analysis.
        // The old results stay visible (briefly) until the new analysis overwrites them.
        currentIdx: -1,
        analyzing: false,
        error: null,
        exploreMode: false,
      })),
      setPlayerColor: (playerColor) => set({ playerColor }),
      setKidMode:     (kidMode)     => set({ kidMode }),
      setAnalyzing:   (analyzing)   => set({ analyzing }),
      setError:       (error)       => set({ error }),
      setResult:      ({ movesData, positions, opening, metadata, estimatedElo }) =>
        set({ movesData, positions, opening, metadata, estimatedElo: estimatedElo ?? null, currentIdx: movesData.length - 1, exploreMode: false, kidCommentaries: {} }),
      setAiReport:        (aiReport)        => set({ aiReport }),
      setKidCommentaries: (kidCommentaries) => set({ kidCommentaries }),
      navigateTo:     (idx)         => set({ currentIdx: idx, exploreMode: false }),
      toggleFlip:     ()            => set(s => ({ flipped: !s.flipped })),
      toggleArrows:   ()            => set(s => ({ showArrows: !s.showArrows })),
      toggleSound:    ()            => set(s => ({ soundEnabled: !s.soundEnabled })),
      setExploreMode: (v)           => set({ exploreMode: v }),
      reset: () => set({
        pgn: "", movesData: [], positions: [], opening: null, metadata: {},
        aiReport: null, kidCommentaries: {}, estimatedElo: null, currentIdx: -1, analyzing: false, error: null, exploreMode: false,
      }),

      currentFen: () => {
        const { positions, currentIdx } = get();
        if (currentIdx < 0 || !positions.length) return START_FEN;
        return positions[currentIdx + 1] ?? START_FEN;
      },

      currentMove: () => {
        const { movesData, currentIdx } = get();
        return currentIdx >= 0 ? movesData[currentIdx] ?? null : null;
      },
    }),
    {
      name: "chess-ai-game",
      storage: createJSONStorage(() => localStorage),
      // Only persist the game data, not transient UI state
      partialize: (s) => ({
        pgn:         s.pgn,
        // analysisKey intentionally NOT persisted — it's a session-only trigger
        playerColor: s.playerColor,
        movesData:   s.movesData,
        positions:   s.positions,
        opening:     s.opening,
        metadata:    s.metadata,
        aiReport:        s.aiReport,
        kidCommentaries: s.kidCommentaries,
        estimatedElo:    s.estimatedElo,
        currentIdx:      s.currentIdx,
        flipped:     s.flipped,
        showArrows:  s.showArrows,
        soundEnabled: s.soundEnabled,
        kidMode:     s.kidMode,
      }),
    }
  )
);

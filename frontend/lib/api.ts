const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Types ─���───────────────────────────────────────────────────────────────────

export type TopMove = { san: string; uci: string; score_cp: number; continuation?: string[]; practical?: boolean };

export type MoveData = {
  move_number:      number;
  color:            "White" | "Black";
  san:              string;
  move_san:         string;
  best_move_san:    string;
  best_move_uci:    string;
  top_moves:        TopMove[];
  score_before:     number | null;
  score_after:      number | null;
  cp_loss:          number;
  classification:   string;
  accuracy_score:   number;
  fen:              string;
  clock_remaining?: number | null;  // seconds remaining on clock (null if PGN has no clocks)
  phase?:           string;         // "Opening" | "Middlegame" | "Endgame"
};

export type PuzzleData = {
  fen:           string;
  move_number:   number;
  color:         "White" | "Black";
  played_san:    string;
  best_move_san: string;
  continuation:  string[];
  classification: string;
  cp_loss:       number;
  phase:         string;
  theme?:        string;
  game_white:    string;
  game_black:    string;
  game_date:     string;
};

export type Opening = { name: string; eco: string };

export type GameMetadata = Record<string, string>;

export type AnalysisResult = {
  metadata:   GameMetadata;
  positions:  string[];      // FEN list: [start, after_move_1, …]
  opening:    Opening;
  moves_data: MoveData[];
  ai_report:  string | null;
  estimated_elo?: number | null;
};

// ── Import ──────���─────────────────────────────────────────────────────────────

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Authenticated requests (calls into FastAPI on behalf of a signed-in user) ──
//
// FastAPI never sees Auth.js's own session — this app mints a short-lived
// (60s) token via /api/internal/token and attaches it as a Bearer header.
// The token is cached in memory and reused for ~45s instead of re-minting
// on every single API call.
let _internalToken: { value: string; expiresAt: number } | null = null;

async function getInternalToken(): Promise<string | null> {
  const now = Date.now();
  if (_internalToken && _internalToken.expiresAt > now) return _internalToken.value;

  const res = await fetch("/api/internal/token", { method: "POST" });
  if (!res.ok) { _internalToken = null; return null; }
  const { token, expiresIn } = await res.json() as { token: string; expiresIn: number };
  _internalToken = { value: token, expiresAt: now + expiresIn * 1000 * 0.75 };
  return token;
}

/** Like apiFetch, but attaches a signed-in user's Bearer token. Throws if not signed in. */
async function authedFetch(url: string, opts?: RequestInit) {
  const token = await getInternalToken();
  if (!token) throw new Error("Not signed in");
  return apiFetch(url, {
    ...opts,
    headers: { ...opts?.headers, Authorization: `Bearer ${token}` },
  });
}

/** Like apiFetch, but attaches a Bearer token when signed in and proceeds
 * anonymously (no error) when not — for Analyze-tab endpoints that work
 * either way, only unlocking mistake-fingerprint tracking when logged in. */
async function optionalAuthedFetch(url: string, opts?: RequestInit) {
  const token = await getInternalToken().catch(() => null);
  return apiFetch(url, {
    ...opts,
    headers: token ? { ...opts?.headers, Authorization: `Bearer ${token}` } : opts?.headers,
  });
}

export async function fetchLichessGames(username: string, count = 10) {
  return apiFetch(`${BASE}/api/import/lichess/${encodeURIComponent(username)}?count=${count}`) as Promise<{ pgn: string }>;
}

export async function fetchChessdotcomGames(username: string, count = 10) {
  return apiFetch(`${BASE}/api/import/chessdotcom/${encodeURIComponent(username)}?count=${count}`) as Promise<{ pgn: string }>;
}

// ── Analysis ──────���───────────────────────────────────────────────────────────

export async function analyzeGame(pgn: string, playerColor: "white" | "black", aiReport = true) {
  return apiFetch(`${BASE}/api/analysis/game`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pgn, player_color: playerColor, ai_report: aiReport }),
  }) as Promise<AnalysisResult>;
}

export type KidMoveCommentary = {
  emoji:    string;
  headline: string;
  what:     string;
  why:      string;
  better:   string;  // empty string for good moves
  followup: string;
  kind:     "mistake" | "good";
};

/** SSE stream. Returns a cleanup fn. Callbacks fired as data arrives. */
export function streamAnalysis(
  pgn: string,
  playerColor: "white" | "black",
  onMoves: (r: Omit<AnalysisResult, "ai_report">) => void,
  onReport: (text: string) => void,
  onDone: () => void,
  onError: (msg: string) => void,
  kidMode = false,
  onKidCommentaries?: (data: Record<number, KidMoveCommentary>) => void,
) {
  const ctrl = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE}/api/analysis/game/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pgn, player_color: playerColor, ai_report: true, kid_mode: kidMode }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) { onError(`HTTP ${res.status}`); return; }

      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const msg = JSON.parse(line.slice(6));
            if (msg.type === "moves")  onMoves(msg);
            if (msg.type === "report") onReport(msg.text);
            if (msg.type === "kid_commentaries" && onKidCommentaries) onKidCommentaries(msg.data);
            if (msg.type === "error")  onError(msg.message);
            if (msg.type === "done")   onDone();
          } catch { /* malformed chunk — skip */ }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== "AbortError") onError(String(e));
    }
  })();

  return () => ctrl.abort();
}

// ── Puzzles & Annotated PGN ──────────────────────────────────────────────────

export async function fetchPuzzles(pgn: string, playerColor: "white" | "black") {
  return apiFetch(`${BASE}/api/analysis/game/puzzles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pgn, player_color: playerColor }),
  }) as Promise<{ puzzles: PuzzleData[] }>;
}

export async function fetchAnnotatedPgn(pgn: string, movesData: MoveData[], keyMoments: object[] = []) {
  return apiFetch(`${BASE}/api/analysis/game/annotated-pgn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pgn, moves_data: movesData, key_moments: keyMoments }),
  }) as Promise<{ pgn: string }>;
}

/** Download annotated PGN as a file. */
export function downloadAnnotatedPgn(pgn: string, filename = "analysis.pgn") {
  const blob = new Blob([pgn], { type: "application/x-chess-pgn" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Player Profile ────────────────────────────────────────────────────────────

export type ProfileStats = {
  player_name:      string;
  total_games:      number;
  wins:             number;
  losses:           number;
  draws:            number;
  win_rate:         number;
  as_white:         number;
  as_black:         number;
  white_wins:       number;
  white_draws:      number;
  black_wins:       number;
  black_draws:      number;
  white_score_pct:  number;
  black_score_pct:  number;
  top_openings:     [string, Record<string, number>][];
  global_counts:    Record<string, number>;
  phase_error_rate: Record<string, number>;
  weakest_phase:    string;
  avg_cp_loss:      number;
  avg_cp_loss_white: number;
  avg_cp_loss_black: number;
  precision_rate:   number;
  clean_game_rate:  number;
  clean_games:      number;
  total_player_moves: number;
  worst_moves:      { game: number; move_number: number; san: string; best_san: string; best_move_uci?: string; fen?: string; cp_loss: number; classification: string; phase: string; pos_context?: string; score_before?: number | null }[];
  losing_error_rate:  number;
  winning_error_rate: number;
  // GM-level metrics (may be absent on older cached responses)
  games_reached_winning?:       number;
  games_converted_from_winning?: number;
  games_squandered?:            number;
  conversion_rate?:             number;
  squander_rate?:               number;
  games_had_equal?:             number;
  games_created_advantage?:     number;
  equal_to_advantage_rate?:     number;
  move_range_accuracy?:         Record<string, number>;
  blunder_by_phase?:            Record<string, number>;
  blunder_from_winning?:        number;
  // ELO
  header_elo?:                  number;
  estimated_elo?:               number;
  display_elo?:                 number;
  elo_source?:                  "pgn_headers" | "cp_loss_model";
};

/** SSE profile stream. Returns a cleanup fn. */
export function streamProfile(
  pgn: string,
  playerName: string,
  onStart:    (total: number, skipped?: number) => void,
  onProgress: (current: number, total: number) => void,
  onStats:    (stats: ProfileStats, gamesParsed: number) => void,
  onProfile:  (text: string) => void,
  onDone:     () => void,
  onError:    (msg: string) => void,
  // Set only when this is a signed-in user viewing their own linked
  // chess.com/lichess profile — enables server-side caching of the
  // expensive Stockfish aggregation (never set for anonymous PGN paste or
  // looking up someone else's username).
  cacheKey?: { userId: string; provider: "lichess" | "chesscom" },
) {
  const ctrl = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE}/api/profile/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pgn, player_name: playerName,
          ...(cacheKey ? { user_id: cacheKey.userId, provider: cacheKey.provider } : {}),
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) { onError(`HTTP ${res.status}`); return; }

      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const msg = JSON.parse(line.slice(6));
            if (msg.type === "start")    onStart(msg.total, msg.skipped ?? 0);
            if (msg.type === "progress") onProgress(msg.current, msg.total);
            if (msg.type === "stats")    onStats(msg.stats, msg.games_parsed);
            if (msg.type === "profile")  onProfile(msg.text);
            if (msg.type === "error")    onError(msg.message);
            if (msg.type === "done")     onDone();
          } catch { /* malformed chunk — skip */ }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== "AbortError") onError(String(e));
    }
  })();

  return () => ctrl.abort();
}

export type PositionExplanation = {
  why_bad:  string;
  why_good: string;
  theme:    string;
  elo_note: string;
  reasoning_feedback?: string | null;
};

export async function explainPosition(params: {
  fen: string;
  played_move: string;
  best_move: string;
  phase?: string;
  position_context?: string;
  cp_loss?: number;
  player_color?: string;
  estimated_elo?: number;
  clock_remaining?: number;
  player_reasoning?: string;
}): Promise<PositionExplanation> {
  // optionalAuthedFetch: works anonymously too, but when signed in this also
  // feeds the mistake-fingerprint tracking (ANALYSIS_STRATEGY.md section 5).
  return optionalAuthedFetch(`${BASE}/api/analysis/position/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

// ── Conversational follow-up on a position ──────────────────────────────────

export type ChatMessage = { role: "user" | "assistant"; content: string };

export async function chatAboutPosition(params: {
  fen: string;
  played_move: string;
  best_move: string;
  player_color?: string;
  estimated_elo?: number;
  history: ChatMessage[];
}): Promise<{ reply: string }> {
  return apiFetch(`${BASE}/api/analysis/position/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

// ── Peer benchmark ────────────────────────────────────────────────────────────

export type PeerMove = { san: string; uci: string; count: number; pct: number };
export type PeerStats = { total_games: number; moves: PeerMove[] };

/** "Players near your rating play X% here" — gracefully returns null when the
 * backend isn't configured with a Lichess explorer token (optional feature). */
export async function fetchPositionPeers(fen: string, tier: string): Promise<PeerStats | null> {
  try {
    return await apiFetch(`${BASE}/api/analysis/position/peers?fen=${encodeURIComponent(fen)}&tier=${tier}`);
  } catch {
    return null;
  }
}

// ── Mistake fingerprint & spaced-repetition puzzle queue (signed-in only) ──────

export type MistakeTheme = {
  theme: string;
  occurrences: number;
  recent_occurrences?: number;
  avg_cp_loss: number;
  total_cp_loss: number;
  sparkline?: number[];
};

export async function getMistakeFingerprint(limit = 5): Promise<{ themes: MistakeTheme[] }> {
  return authedFetch(`${BASE}/api/user/mistake-fingerprint?limit=${limit}`);
}

export type QueuedPuzzle = {
  fen: string;
  best_move_san: string;
  continuation: string[];
  theme: string;
  cp_loss: number;
  phase: string;
  game_white: string;
  game_black: string;
  game_date: string;
  streak: number;
};

export async function getPuzzleQueue(limit = 10): Promise<{ top_themes: string[]; puzzles: QueuedPuzzle[] }> {
  return authedFetch(`${BASE}/api/user/puzzle-queue?limit=${limit}`);
}

// ── Rating History ────────────────────────────────────────────────────────────

export type RatingPoint = { date: string; rating: number };
export type RatingHistoryEntry = { name: string; points: RatingPoint[] };

/** Fetch Lichess rating history for a user. Returns array of time-control histories. */
export async function fetchLichessRatingHistory(username: string): Promise<RatingHistoryEntry[]> {
  const raw = await apiFetch(
    `${BASE}/api/import/lichess/${encodeURIComponent(username)}/rating-history`
  ) as Array<{ name: string; points: number[][] }>;
  return raw.map(entry => ({
    name: entry.name,
    points: entry.points.map(([year, month, day, rating]) => ({
      // Lichess months are 0-indexed
      date: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      rating,
    })),
  }));
}

// ── User account (requires sign-in) ─────────────────────────────────────────────

export type Me = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  lichess_username: string | null;
  chesscom_username: string | null;
  lichess_verified: boolean;
};

export async function getMe(): Promise<Me> {
  return authedFetch(`${BASE}/api/user/me`) as Promise<Me>;
}

export async function linkChessUsername(params: {
  lichess_username?: string;
  chesscom_username?: string;
}): Promise<{ ok: true }> {
  return authedFetch(`${BASE}/api/user/chess-links`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }) as Promise<{ ok: true }>;
}

export async function recordPuzzleProgress(
  puzzleFen: string, solved = true
): Promise<{ ok: true; streak: number; next_review_in_days: number }> {
  return authedFetch(`${BASE}/api/user/puzzle-progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ puzzle_fen: puzzleFen, solved }),
  });
}

// ── Analyzed-game & profile history (dashboard, signed-in only) ────────────────
//
// Saved once client-side after a stream finishes (see app/analyze/page.tsx
// and app/profile/page.tsx), then read back verbatim on revisit — no
// Stockfish/AI recompute involved.

export type GamePayload = {
  metadata: GameMetadata;
  positions: string[];
  opening: Opening;
  moves_data: MoveData[];
  ai_report: string | null;
  estimated_elo?: number | null;
};

export type SavedGameSummary = {
  id: number;
  white: string | null;
  black: string | null;
  game_date: string | null;
  result: string | null;
  event: string | null;
  player_color: string;
  opening_name: string | null;
  opening_eco: string | null;
  estimated_elo: number | null;
  accuracy_white: number | null;
  accuracy_black: number | null;
  created_at: string;
};

export type SavedGameDetail = { pgn: string; player_color: string; payload: GamePayload; created_at: string };

export async function saveAnalyzedGame(params: {
  pgn: string;
  white?: string; black?: string; game_date?: string; result?: string; event?: string;
  player_color: string;
  opening_name?: string; opening_eco?: string;
  estimated_elo?: number | null;
  accuracy_white?: number; accuracy_black?: number;
  payload: GamePayload;
}): Promise<{ ok: true; id: number }> {
  return authedFetch(`${BASE}/api/user/games`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function getAnalyzedGames(limit = 20): Promise<{ games: SavedGameSummary[] }> {
  return authedFetch(`${BASE}/api/user/games?limit=${limit}`);
}

export async function getAnalyzedGame(id: number): Promise<SavedGameDetail> {
  return authedFetch(`${BASE}/api/user/games/${id}`);
}

export async function deleteAnalyzedGame(id: number): Promise<{ ok: true }> {
  return authedFetch(`${BASE}/api/user/games/${id}`, { method: "DELETE" });
}

export type SavedProfileSummary = {
  id: number;
  provider: "lichess" | "chesscom" | "pgn";
  username: string | null;
  player_name: string;
  games_count: number;
  created_at: string;
};

export type SavedProfileDetail = { player_name: string; payload: ProfileStats & { profile_text?: string }; created_at: string };

export async function saveProfile(params: {
  provider: "lichess" | "chesscom" | "pgn";
  username?: string;
  player_name: string;
  games_count?: number;
  payload: ProfileStats & { profile_text?: string };
}): Promise<{ ok: true; id: number }> {
  return authedFetch(`${BASE}/api/user/profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function getSavedProfiles(limit = 20): Promise<{ profiles: SavedProfileSummary[] }> {
  return authedFetch(`${BASE}/api/user/profiles?limit=${limit}`);
}

export async function getSavedProfile(id: number): Promise<SavedProfileDetail> {
  return authedFetch(`${BASE}/api/user/profiles/${id}`);
}

export async function deleteSavedProfile(id: number): Promise<{ ok: true }> {
  return authedFetch(`${BASE}/api/user/profiles/${id}`, { method: "DELETE" });
}

export type DashboardSummary = {
  games_analyzed: number;
  profiles_built: number;
  puzzles_solved: number;
  best_streak: number;
  top_mistake_theme: string | null;
  last_activity_at: string | null;
};

export async function getDashboardSummary(): Promise<DashboardSummary> {
  return authedFetch(`${BASE}/api/user/dashboard-summary`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Split a multi-game PGN blob into individual game strings. */
export function splitPgn(raw: string): string[] {
  return raw.split(/\n(?=\[Event )/).map(b => b.trim()).filter(Boolean);
}

/** Extract a display label from a single-game PGN. */
export function pgnLabel(pgn: string, i: number): string {
  const w = pgn.match(/\[White "(.+?)"\]/)?.[1] ?? "?";
  const b = pgn.match(/\[Black "(.+?)"\]/)?.[1] ?? "?";
  const d = pgn.match(/\[Date "(.+?)"\]/)?.[1]?.slice(0, 7) ?? "";
  return `${i + 1}. ${w} vs ${b}${d ? `  (${d})` : ""}`;
}

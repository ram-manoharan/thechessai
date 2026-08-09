# Analysis Product Strategy — finding our USP

## 1. Competitive landscape (researched Aug 2026)

| Tool | What it actually nails | Where it stops |
|---|---|---|
| **Chess.com Game Review** | Polished single-game narration, "Show Line" replay, opening commentary by masters, retry-a-mistake accuracy recalculation, Game Graph | Same explanation style for a 400 and a 1900; no cross-game memory of *your* recurring patterns; engine's "best move" shown even when unplayable for a human |
| **Lichess Analysis** | Free, unlimited, strong Stockfish NNUE, clean eval graph, "Learn from your mistakes" retry mode | No AI narrative at all — you get the *what*, never the *why*; zero personalization |
| **ChessBase / Fritz** | Deepest engine + database tooling, novelty detection | Built for titled players doing prep, not improvement coaching; steep learning curve |
| **Aimchess** | Cross-game weakness dashboard, training drills from batch analysis | Explicitly a separate "long-term dashboard," disconnected from live in-game review — you analyze a game in one tool, get weakness reports in another |
| **DecodeChess** | Plain-English explanation of engine lines, "up to 2000 Elo" | [Documented, named criticism](https://www.improvemychess.co/learn/best-chess-com-game-review-alternatives-2026): **uses the same coaching language for a 400 ELO and a 1900 ELO player** — plus reported reliability/UX bugs |
| **blunders.ai** | Exactly the idea "spaced-repetition drilling of your own recurring mistakes" — already a dedicated product | A bolt-on drilling app, not connected to full game analysis or a coaching narrative |
| **CircleChess, Sensei Chess, AICoachess** (2026 wave) | GM-backed curricula + AI personalization, growing fast | New entrants converging on the same "AI wrapper on Stockfish" pattern we'd be entering too — not a moat by itself |

**The meta-finding**, confirmed by [chess-improvement research](https://chessimprovementlab.substack.com/p/nine-lessons-i-learned-from-stockfish): raw engine lines produce a "nodding-along" effect — players see the correct move, file it as "reviewed," and retain nothing, because titled players actually reconstruct their own thinking *before* consulting the engine, while every consumer tool leads with the engine's answer first.

**Pricing reality**: the genuinely personalized tools (Aimchess, DecodeChess-tier) run **$12–15/mo**, which is exactly the barrier for the beginners who need the most hand-holding and can least justify a subscription before they know if they'll stick with chess.

**Our own codebase, checked against this**: `ai_service.py:329` already tags a prompt with `estimated_elo`, but the prompt template itself (`ai_service.py:340-346`) is identical regardless of whether that number is 600 or 2200 — **we currently have the exact DecodeChess flaw, just not yet shipped as a differentiator.** That's the fastest, most concrete fix available and the foundation the rest of this plan builds on.

## 2. The gap, stated precisely

Nobody has shipped **one continuous loop** that:
1. Genuinely varies *vocabulary, depth, and focus* by the player's actual rating (not a label bolted onto a fixed template)
2. Remembers *your* recurring mistake patterns across every game you've ever analyzed here, not just this one
3. Turns that memory into a prioritized, spaced-repetition practice queue built from *your own* positions
4. Distinguishes the engine's mathematically-best move from the *practically playable* move for a human at your level

Every competitor nails exactly one of these four. None does all four in a single product.

## 3. Our USP

> **"The only chess coach that remembers you, speaks at your level, and turns every mistake into tomorrow's practice."**

Not "better engine" (Stockfish is a commodity — everyone has the same numbers). Not "another AI narrator" (the 2026 wave is already crowded there). The wedge is **continuity + calibration**: single-game review, cross-game memory, and spaced-repetition drilling as one connected system instead of three separate tools a user has to stitch together themselves — which is literally what current buyer's-guides tell people to do today.

## 4. Design by ELO band

Generic advice at the wrong altitude is worse than no advice — this is the core, evidenced failure mode we're fixing. Each band gets a genuinely different experience, not just a shorter/longer paragraph.

### Under 800 — absolute beginner
- **No centipawn numbers at all.** Replace the eval bar's `+1.4` with a 5-step qualitative scale (Great for you / Good / Okay / Risky / Losing) — numbers this precise are noise before a player has any calibration for what they mean.
- Flag **only** hung pieces, missed mate-in-1, and missed free material. Suppress positional commentary entirely — it's actively confusing at this stage.
- First use of any tactical term (fork, pin, skewer) gets an inline one-line definition, not just the label — most players here haven't learned the vocabulary yet.
- Visual-first: an animated arrow + highlighted square beats a sentence.
- Warm tone. "Blunder" and "??" read as harsh to someone three weeks into the game — reuse the tone patterns already built for Kid Mode (`ai_service.py:372`) for this band generally, not just for kids.

### 800–1200 — novice
- Introduce the eval bar, always paired with a plain-language translation, never numbers alone.
- Stay tactics-heavy — this band improves fastest from repetition of one-move and two-move tactical patterns, which is exactly what a mistake-fingerprint + spaced-repetition queue (Section 5) is built for.
- Opening guidance is principle-based ("develop before you attack," "castle early"), never memorized theory.

### 1200–1600 — intermediate
- Full accuracy score, eval bar, and multi-line engine continuation (what `EngineLinesPanel` already renders today).
- Positional explanations start earning their keep — pawn structure, weak squares, piece coordination. This is DecodeChess's actual sweet spot, and where our `explain_position` themes taxonomy already applies well.
- Deviation-from-theory detection: "you left book on move 6 — here's why the book move mattered."
- Peer benchmarking becomes motivating here: "players near your rating play Nf3 73% of the time in this spot" (Lichess's public opening-explorer API already has this stat, no need to build our own database).

### 1600–2000 — advanced / strong club player
- Deeper search (higher depth / wider MultiPV).
- **Human-playable vs. computer-only move labeling** becomes genuinely useful at this band (Section 6) — this is a player who can act on the distinction.
- Plans, not just moves: "what is this move *for*," not only its immediate tactical point.
- Time-pressure-aware commentary using the `clock_remaining` data already captured in `MoveData` — a blunder with 4 seconds left is a different lesson than the same blunder with 10 minutes on the clock.

### 2000+ — expert
- Minimal narrative hand-holding; the job shifts from catching blunders (rare at this level) to surfacing 10–30cp *precision* leaks a strong player would otherwise miss.
- Opening-novelty detection against a master-game reference set.
- Raw engine depth and multi-PV are the product here — narrative AI becomes optional garnish, not the core value.

## 5. Concrete feature: the mistake fingerprint (highest-leverage build)

We already have the pieces:
- `explain_position`'s `theme` field (`ai_service.py:344`) already classifies every mistake into a fixed taxonomy (Fork, Pin, Back Rank, King Safety, Pawn Structure, …)
- `app.puzzle_progress` (just built this session) already tracks solve state per user per position
- `collect_game_puzzles` in `chess_analysis.py` already extracts puzzle positions from a player's own blunders

What's missing is the connective layer:
1. Persist the `theme` tag alongside every recorded mistake, per user, per game (small schema addition to `app` — a `mistake_pattern` table: `user_id, theme, phase, cp_loss, fen, occurred_at`).
2. Aggregate into a per-user "fingerprint": which 2–3 themes account for the most cumulative Elo loss, ranked by frequency × impact (we already compute Elo-loss-from-squandering in `player_profile_service.py` — extend that ranking logic to per-theme buckets).
3. Feed that ranking into puzzle selection: instead of a generic puzzle queue, prioritize positions tagged with the user's own top-weakness themes, resurfaced on a spaced-repetition schedule (missed → retry tomorrow; solved → retry in a week; solved twice → retry in a month).
4. Surface it explicitly in the coaching report: "Back-rank weaknesses cost you ~140 Elo across your last 20 games — here are 4 puzzles from your own games on exactly this pattern."

This is the single feature that most directly answers "why come here instead of Lichess + Aimchess + blunders.ai separately."

## 6. Concrete feature: human-playable move labeling

A cheap, real heuristic surfaced in the research: a move is "practically playable" when (a) its evaluation is *stable* across search depths rather than swinging on one narrow only-move sequence, and (b) it can be explained in one sentence a club player would recognize ("wins the pawn back with a fork," not "only move maintaining the balance after a 12-ply forced sequence"). Concretely:
- Run each candidate move at two depths (e.g. 14 and the existing default), flag moves whose eval shifts more than ~40cp between them as "computer-only."
- Reuse the existing `why_good` AI explanation (`ai_service.py:343`) as the one-sentence test — if the model can't produce a concrete, position-specific sentence without hedging, treat it as a low-playability signal.
- Show both: the engine's top choice (as today), plus a distinctly labeled "practical choice" when they diverge, aimed at the 1600+ bands where this actually changes decisions.

## 7. Roadmap

**Phase 1 — foundational, builds directly on what exists**
- Rewrite the coaching prompts (`ai_service.py`: `explain_position`, `analyze_game`, `analyze_player_profile`) so ELO genuinely changes vocabulary, depth, and which themes get surfaced — not just a tag in the prompt string. Define the 5 bands above as discrete prompt variants.
- Ship the mistake-fingerprint schema + aggregation (Section 5) and surface it in the existing "Study" tab and coaching report.
- Wire puzzle selection to the fingerprint ranking with spaced-repetition scheduling, using `app.puzzle_progress` (already built) plus the new `mistake_pattern` table.

**Phase 2**
- Human-playable-move labeling (Section 6) in `EngineLinesPanel` and the board arrows.
- Peer-rating benchmarking via Lichess's public opening-explorer API.
- A genuinely separate beginner-mode UI: qualitative eval scale, glossary tooltips, visual-first layout — not just simpler text in the same layout.

**Phase 3**
- Multi-turn conversational follow-up on any position (extends the existing single-shot `explain_position` endpoint).
- "Show Line" narrated continuation playback + master-written opening commentary, matching and exceeding chess.com's version.
- Time-pressure-aware commentary using existing clock data.
- Novelty/database detection for the 2000+ band.

---
This is a design document, not an implementation — nothing here has been built yet. Phase 1's first item (rewriting the coaching prompts to be genuinely ELO-adaptive) is the highest-leverage, lowest-risk starting point: it touches one file, requires no schema changes, and is the most-cited concrete flaw in the entire competitive set.

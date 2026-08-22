import { Chess, type Square } from "chess.js";

export type TimelineEntry = { charStart: number; from: Square; to: Square; san: string };

// Long castling must precede short, or "O-O" matches the first 4 characters
// of "O-O-O" and leaves a dangling "-O" unconsumed.
const SAN_RE = /\b(?:O-O-O|0-0-0|O-O|0-0|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8](?:=[QRBN])?)\b/g;

// "weak on d4", "pressure at f7", "escapes from e4" -- bare pawn-destination
// tokens preceded by these words are a square reference, not a move. Piece
// tokens ("Nd4") don't have this ambiguity -- prose says "the knight on d4"
// for a location, never "Nd4".
const PRECEDING_WORD_STOPLIST = new Set(["on", "at", "from"]);

function normalizeSan(s: string): string {
  return s.replace(/[+#]/g, "").replace(/^0-0-0$/i, "O-O-O").replace(/^0-0$/i, "O-O");
}

function precedingWord(text: string, index: number): string {
  const before = text.slice(0, index).trimEnd();
  const m = before.match(/([A-Za-z']+)$/);
  return m ? m[1].toLowerCase() : "";
}

function isBarePawnToken(token: string): boolean {
  return !/^[KQRBN]/.test(token);
}

function flipSideToMove(fen: string): string {
  const parts = fen.split(" ");
  if (parts.length < 2) return fen;
  parts[1] = parts[1] === "w" ? "b" : "w";
  return parts.join(" ");
}

/** Walks every SAN-shaped token in `text` in order and resolves it to a
 * real {from,to} pair via chess.js legality checks -- never a guess from
 * the text alone. Three tiers, tried in this fixed priority so an
 * ambiguous token can never "steal" a chain from an unrelated comparison:
 *
 * 1. Legal from the actual discussed position (`basePos`)? Use it, and
 *    RESET the running chain to after this move. Always tried first --
 *    this is what keeps "Ng5 is sharp, but d3 is safer" correct (d3
 *    resolves against basePos, not as if Ng5 had already been played).
 * 2. Else legal from the running chain (`chainPos`, natural alternating
 *    side to move)? Use it, advance the chain. Handles real forced
 *    sequences: "Rd8+ forces Kf8, and then Rxf8 is mate."
 * 3. Else, flip only the side-to-move on the chain position (a synthetic
 *    "assume the opponent does nothing") and check legality there. Handles
 *    the common same-side "X threatens Y" idiom: "Ng5 attacks f7...
 *    Nxf7 forks the queen" -- Nxf7 is White's move again, which tiers 1-2
 *    alone get wrong (it's not in Black's reply-move list).
 * 4. Unresolved -> skip silently. No guessing, ever.
 */
export function buildMoveTimeline(text: string, fen: string): TimelineEntry[] {
  let basePos: Chess;
  try {
    basePos = new Chess(fen);
  } catch {
    return [];
  }
  const baseLegal = basePos.moves({ verbose: true });
  let chainPos = new Chess(fen);

  const entries: TimelineEntry[] = [];

  for (const m of text.matchAll(SAN_RE)) {
    const index = m.index ?? 0;
    const token = normalizeSan(m[0]);

    if (isBarePawnToken(token) && PRECEDING_WORD_STOPLIST.has(precedingWord(text, index))) {
      continue;
    }

    const baseMatch = baseLegal.find(mv => normalizeSan(mv.san) === token);
    if (baseMatch) {
      entries.push({ charStart: index, from: baseMatch.from as Square, to: baseMatch.to as Square, san: baseMatch.san });
      chainPos = new Chess(fen);
      try { chainPos.move({ from: baseMatch.from, to: baseMatch.to, promotion: baseMatch.promotion }); } catch { /* leave as-is */ }
      continue;
    }

    const continMatch = chainPos.moves({ verbose: true }).find(mv => normalizeSan(mv.san) === token);
    if (continMatch) {
      entries.push({ charStart: index, from: continMatch.from as Square, to: continMatch.to as Square, san: continMatch.san });
      try { chainPos.move({ from: continMatch.from, to: continMatch.to, promotion: continMatch.promotion }); } catch { /* leave as-is */ }
      continue;
    }

    try {
      const flipped = new Chess(flipSideToMove(chainPos.fen()));
      const threatMatch = flipped.moves({ verbose: true }).find(mv => normalizeSan(mv.san) === token);
      if (threatMatch) {
        entries.push({ charStart: index, from: threatMatch.from as Square, to: threatMatch.to as Square, san: threatMatch.san });
        flipped.move({ from: threatMatch.from, to: threatMatch.to, promotion: threatMatch.promotion });
        chainPos = flipped;
        continue;
      }
    } catch {
      // unresolved -- fall through and skip
    }
  }

  return entries;
}

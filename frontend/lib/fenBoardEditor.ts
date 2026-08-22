import { fenStringToPositionObject, type PositionDataType } from "react-chessboard";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1];

const STARTING_BOARD_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

export function emptyPosition(): PositionDataType {
  return {};
}

export function startingPositionObject(): PositionDataType {
  return fenStringToPositionObject(STARTING_BOARD_FEN, 8, 8);
}

/** react-chessboard's PieceDataType.pieceType is "wP"/"bK"/etc — the letter
 * is always uppercase in the code itself, so FEN case comes purely from the
 * color prefix. */
function pieceToFenChar(pieceType: string): string {
  const letter = pieceType[1];
  return pieceType[0] === "w" ? letter : letter.toLowerCase();
}

export function positionObjectToBoardFen(position: PositionDataType): string {
  const rows: string[] = [];
  for (const rank of RANKS) {
    let row = "";
    let empty = 0;
    for (const file of FILES) {
      const piece = position[`${file}${rank}`];
      if (!piece) { empty++; continue; }
      if (empty > 0) { row += empty; empty = 0; }
      row += pieceToFenChar(piece.pieceType);
    }
    if (empty > 0) row += empty;
    rows.push(row || "8");
  }
  return rows.join("/");
}

/** Same "static occupancy" convention lichess/chess.com's own board editors
 * use — a from-scratch diagram has no move history to infer real castling
 * rights from, so a king+rook still on their home squares is the closest
 * available proxy. Deliberately not exposed as a manual toggle in v1. */
export function inferCastlingRights(position: PositionDataType): string {
  let rights = "";
  if (position.e1?.pieceType === "wK" && position.h1?.pieceType === "wR") rights += "K";
  if (position.e1?.pieceType === "wK" && position.a1?.pieceType === "wR") rights += "Q";
  if (position.e8?.pieceType === "bK" && position.h8?.pieceType === "bR") rights += "k";
  if (position.e8?.pieceType === "bK" && position.a8?.pieceType === "bR") rights += "q";
  return rights || "-";
}

/** En passant target is always "-" (no prior move exists to infer one from
 * on a hand-set-up board), halfmove 0, fullmove 1 — same defaults
 * lichess/chess.com's editors assume. */
export function assembleFen(position: PositionDataType, sideToMove: "w" | "b"): string {
  const board = positionObjectToBoardFen(position);
  const castling = inferCastlingRights(position);
  return `${board} ${sideToMove} ${castling} - 0 1`;
}

"""Deterministic, LLM-free structural tagging for a mistake position --
turns a single tactical_theme string into queryable compound signal (e.g.
"knight moves played into a kingside pawn storm after capturing a bishop").
No engine calls, no network calls: pure python-chess board replay, safe to
run inline in the request that saves a game.

Every field here has a concrete, single-move-correct algorithm. Anything
that would need multi-ply lookahead to get right (e.g. verifying a genuine
bishop *trade*, not just one capture) was deliberately left out rather than
approximated.
"""
import logging

import chess

from chess_analysis import _PIECE_VALUE

logger = logging.getLogger(__name__)

_MINOR_OR_ABOVE = {chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN}


def _is_dark_square(square: int) -> bool:
    return (chess.square_file(square) + chess.square_rank(square)) % 2 == 0


def _king_shield_count(board: chess.Board, color: bool) -> int:
    """Pawns of `color` on the rank directly in front of its own king,
    across the king file and its two neighbours -- a cheap, standard proxy
    for king-side pawn shelter."""
    king_sq = board.king(color)
    if king_sq is None:
        return 0
    king_file, king_rank = chess.square_file(king_sq), chess.square_rank(king_sq)
    shield_rank = king_rank + 1 if color == chess.WHITE else king_rank - 1
    if not 0 <= shield_rank <= 7:
        return 0
    return sum(
        1 for f in (king_file - 1, king_file, king_file + 1)
        if 0 <= f <= 7
        and (p := board.piece_at(chess.square(f, shield_rank)))
        and p.piece_type == chess.PAWN and p.color == color
    )


def extract_position_features(fen_before: str, move_san: str) -> dict:
    """Structural tags for the move actually PLAYED (the mistake), computed
    from fen_before. Returns {} on any parse failure -- never raises, this
    must never be the reason a game save fails."""
    try:
        board = chess.Board(fen_before)
        mover_color = board.turn
        move = board.parse_san(move_san)
    except Exception:
        logger.warning("extract_position_features: could not parse move", exc_info=True)
        return {}

    try:
        moved_piece = board.piece_at(move.from_square)
        is_capture = board.is_capture(move)
        captured = board.piece_at(move.to_square) if is_capture else None
        shield_before = _king_shield_count(board, mover_color)

        features: dict = {
            "piece_type_moved": chess.piece_name(moved_piece.piece_type) if moved_piece else None,
            "is_capture": is_capture,
            "captured_piece_type": chess.piece_name(captured.piece_type) if captured else None,
            "captured_bishop_square_color": (
                ("dark" if _is_dark_square(move.to_square) else "light")
                if captured and captured.piece_type == chess.BISHOP else None
            ),
            "pawn_storm_side": None,
        }

        if moved_piece and moved_piece.piece_type == chess.PAWN:
            to_rank = chess.square_rank(move.to_square)
            advanced = to_rank >= 4 if mover_color == chess.WHITE else to_rank <= 3
            if advanced:
                features["pawn_storm_side"] = (
                    "kingside" if chess.square_file(move.to_square) >= 4 else "queenside"
                )

        board.push(move)

        features["moved_into_pin"] = board.is_pinned(mover_color, move.to_square)
        features["king_shield_pawn_delta"] = _king_shield_count(board, mover_color) - shield_before
        features["created_hanging_piece"] = any(
            p.color == mover_color and p.piece_type in _MINOR_OR_ABOVE
            and board.attackers(not mover_color, sq) and not board.attackers(mover_color, sq)
            for sq, p in board.piece_map().items()
        )
        features["material_imbalance_after"] = (
            sum(_PIECE_VALUE[p.piece_type] for p in board.piece_map().values() if p.color == chess.WHITE)
            - sum(_PIECE_VALUE[p.piece_type] for p in board.piece_map().values() if p.color == chess.BLACK)
        )
        return features
    except Exception:
        logger.warning("extract_position_features: feature computation failed", exc_info=True)
        return {}

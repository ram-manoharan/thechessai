"""Scoresheet scanning — upload a photo, get a validated PGN back."""
import chess
import chess.pgn
import logging
from functools import lru_cache
from pydantic import BaseModel
from fastapi import APIRouter, File, HTTPException, UploadFile

from routers.analysis import _ai  # reuse the lru_cache singleton

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_TYPES = {
    "image/jpeg", "image/jpg", "image/png",
    "image/webp", "image/heic", "image/heif",
}
MAX_BYTES = 10 * 1024 * 1024  # 10 MB


# ── Helpers ───────────────────────────────────────────────────────────────────

def _validate_move_list(
    moves: list[str],
    white_name: str = "?",
    black_name: str = "?",
    date: str = "????.??.??",
    result: str = "*",
    event: str = "Handwritten Game",
) -> dict:
    """Replay a flat SAN list, validate each move, return annotated result + PGN."""
    board = chess.Board()
    annotated: list[dict] = []
    errors: list[dict] = []

    for i, raw_san in enumerate(moves):
        move_num = i // 2 + 1
        side = "White" if i % 2 == 0 else "Black"
        fen_before = board.fen()
        san = (raw_san or "").strip()

        parsed_move = None
        used_san = san

        # Try several fixes in order before giving up
        candidates = [
            san,
            san.replace("0-0-0", "O-O-O").replace("0-0", "O-O"),
            san.rstrip("+#"),
            san.replace("0-0-0", "O-O-O").replace("0-0", "O-O").rstrip("+#"),
        ]
        for candidate in candidates:
            try:
                parsed_move = board.parse_san(candidate)
                used_san = candidate
                break
            except Exception:
                continue

        if parsed_move is not None:
            board.push(parsed_move)
            annotated.append({
                "idx": i, "move_num": move_num, "side": side,
                "san": used_san, "valid": True, "fen_before": fen_before,
            })
        else:
            reason = f"'{san}' is not a legal move in this position"
            if errors:
                reason += " (may be caused by an earlier uncorrected move)"
            errors.append({
                "idx": i, "move_num": move_num, "side": side,
                "san": san, "fen_before": fen_before, "reason": reason,
            })
            annotated.append({
                "idx": i, "move_num": move_num, "side": side,
                "san": san, "valid": False, "fen_before": fen_before,
            })

    # Build clean PGN only when no errors remain
    valid_pgn: str | None = None
    if not errors:
        game = chess.pgn.Game()
        game.headers.update({
            "Event": event, "White": white_name or "?",
            "Black": black_name or "?", "Date": date or "????.??.??",
            "Result": result or "*",
        })
        node = game
        board2 = chess.Board()
        for ann in annotated:
            move = board2.parse_san(ann["san"])
            node = node.add_variation(move)
            board2.push(move)
        game.headers["Result"] = result or "*"
        valid_pgn = str(game)

    return {
        "annotated": annotated,
        "errors": errors,
        "has_errors": bool(errors),
        "valid_pgn": valid_pgn,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/scan")
async def scan_scoresheet(file: UploadFile = File(...)):
    """Upload a scoresheet photo → two-pass OCR → python-chess validation."""
    ct = file.content_type or ""
    ext = (file.filename or "").lower().rsplit(".", 1)[-1]
    if ct not in ALLOWED_TYPES and ext not in {"jpg", "jpeg", "png", "webp", "heic", "heif"}:
        raise HTTPException(400, "Unsupported file type. Upload a JPEG, PNG, or WebP photo.")

    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File too large. Maximum 10 MB.")

    ai = _ai()
    if not ai.vision_client:
        raise HTTPException(503, "Vision model not configured on this server.")

    ocr = ai.transcribe_notation_image(data, ct or "image/jpeg")
    if "error" in ocr:
        raise HTTPException(422, ocr["error"])

    raw_moves = [m["san"] for m in ocr.get("moves_annotated", [])]
    validated = _validate_move_list(
        raw_moves,
        white_name=ocr.get("white_name") or "?",
        black_name=ocr.get("black_name") or "?",
        date=ocr.get("date") or "????.??.??",
        result=ocr.get("result") or "*",
    )

    return {
        "moves":       validated["annotated"],
        "errors":      validated["errors"],
        "has_errors":  validated["has_errors"],
        "valid_pgn":   validated["valid_pgn"],
        "notes":       ocr.get("notes", ""),
        "white_name":  ocr.get("white_name") or "",
        "black_name":  ocr.get("black_name") or "",
        "date":        ocr.get("date") or "",
        "result":      ocr.get("result") or "*",
    }


class ValidateRequest(BaseModel):
    moves: list[str]
    white_name: str = ""
    black_name: str = ""
    date: str = ""
    result: str = "*"
    event: str = "Handwritten Game"


@router.post("/validate")
def validate_moves(req: ValidateRequest):
    """Re-validate a (possibly corrected) move list and return a clean PGN when all valid."""
    validated = _validate_move_list(
        req.moves,
        white_name=req.white_name or "?",
        black_name=req.black_name or "?",
        date=req.date or "????.??.??",
        result=req.result or "*",
        event=req.event or "Handwritten Game",
    )
    return {
        "moves":      validated["annotated"],
        "errors":     validated["errors"],
        "has_errors": validated["has_errors"],
        "valid_pgn":  validated["valid_pgn"],
    }

import os
import re as _re
import math
import platform
import shutil
import logging
import traceback
from typing import Dict, Any, List, Optional
from io import StringIO
import chess
import chess.pgn
import chess.engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from ai_service import AIService

# ─────────────────────────── Clock / Phase helpers ───────────────────────────

_CLK_RE = _re.compile(r'\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]')


def _parse_clock(comment: str) -> Optional[float]:
    """Extract clock remaining in seconds from PGN [%clk H:MM:SS] annotation."""
    m = _CLK_RE.search(comment or "")
    if not m:
        return None
    h, mn = int(m.group(1)), int(m.group(2))
    s = float(m.group(3))
    return h * 3600 + mn * 60 + s


def _get_phase_by_material(board: chess.Board, move_number: int) -> str:
    """Determine game phase using material count (more accurate than move-number heuristic)."""
    if move_number <= 10:
        return "Opening"

    pvals = {chess.QUEEN: 9, chess.ROOK: 5, chess.BISHOP: 3, chess.KNIGHT: 3}
    total = sum(
        pvals[pt] * (len(board.pieces(pt, chess.WHITE)) + len(board.pieces(pt, chess.BLACK)))
        for pt in pvals
    )
    queens = (len(board.pieces(chess.QUEEN, chess.WHITE))
              + len(board.pieces(chess.QUEEN, chess.BLACK)))

    if total <= 20 or (queens == 0 and total <= 30):
        return "Endgame"
    if move_number <= 15 and total >= 50:
        return "Opening"
    if move_number > 35:
        return "Endgame"
    return "Middlegame"


# ─────────────────────────── Opening database ────────────────────────────────
OPENINGS_DB: Dict[str, Dict[str, str]] = {
    # Flank / Irregular
    "Nf3":                                    {"name": "Réti Opening",                "eco": "A04"},
    "c4":                                     {"name": "English Opening",              "eco": "A10"},
    "c4 e5":                                  {"name": "English, King's English",      "eco": "A20"},
    "c4 c5":                                  {"name": "English, Symmetrical",         "eco": "A30"},
    "c4 Nf6":                                 {"name": "English, Anglo-Indian",        "eco": "A15"},
    "b3":                                     {"name": "Nimzo-Larsen Attack",          "eco": "A01"},
    "g3":                                     {"name": "King's Fianchetto Opening",    "eco": "A00"},
    "f4":                                     {"name": "Bird's Opening",               "eco": "A02"},
    "b4":                                     {"name": "Polish Opening",               "eco": "A00"},
    "Nc3":                                    {"name": "Van Geet Opening",             "eco": "A00"},
    # Queen's Pawn / Closed
    "d4":                                     {"name": "Queen's Pawn Opening",         "eco": "A40"},
    "d4 d5":                                  {"name": "Queen's Pawn Game",            "eco": "D00"},
    "d4 d5 c4":                               {"name": "Queen's Gambit",               "eco": "D06"},
    "d4 d5 c4 e6":                            {"name": "Queen's Gambit Declined",      "eco": "D30"},
    "d4 d5 c4 e6 Nc3 Nf6 Bg5":               {"name": "QGD, Orthodox Defense",        "eco": "D60"},
    "d4 d5 c4 dxc4":                          {"name": "Queen's Gambit Accepted",      "eco": "D20"},
    "d4 d5 c4 c6":                            {"name": "Slav Defense",                 "eco": "D10"},
    "d4 d5 c4 c6 Nf3 Nf6 Nc3":               {"name": "Semi-Slav Defense",            "eco": "D43"},
    "d4 d5 Bf4":                              {"name": "London System",                "eco": "D00"},
    "d4 d5 Nf3 Nf6 Bf4":                     {"name": "London System",                "eco": "D02"},
    "d4 d5 Nf3 Nf6 e3":                      {"name": "Colle System",                 "eco": "D05"},
    "d4 d5 e4":                               {"name": "Blackmar-Diemer Gambit",       "eco": "D00"},
    # Indian defenses
    "d4 Nf6":                                 {"name": "Indian Defense",               "eco": "A45"},
    "d4 Nf6 c4":                              {"name": "Indian Game",                  "eco": "E00"},
    "d4 Nf6 c4 g6":                           {"name": "King's Indian Defense",        "eco": "E60"},
    "d4 Nf6 c4 g6 Nc3 Bg7 e4":               {"name": "King's Indian, Main Line",     "eco": "E70"},
    "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O":   {"name": "King's Indian, Classical",     "eco": "E91"},
    "d4 Nf6 c4 g6 Nc3 d5":                   {"name": "Grünfeld Defense",             "eco": "D80"},
    "d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4":     {"name": "Grünfeld, Exchange",           "eco": "D85"},
    "d4 Nf6 c4 e6":                           {"name": "Indian Game, e6",              "eco": "E00"},
    "d4 Nf6 c4 e6 Nc3 Bb4":                  {"name": "Nimzo-Indian Defense",         "eco": "E20"},
    "d4 Nf6 c4 e6 Nc3 Bb4 e3":               {"name": "Nimzo-Indian, Rubinstein",     "eco": "E40"},
    "d4 Nf6 c4 e6 Nc3 Bb4 c5":               {"name": "Nimzo-Indian, Sämisch",        "eco": "E28"},
    "d4 Nf6 c4 e6 Nf3 b6":                   {"name": "Queen's Indian Defense",       "eco": "E10"},
    "d4 Nf6 c4 e6 Nf3 Bb4+":                 {"name": "Bogo-Indian Defense",          "eco": "E11"},
    "d4 Nf6 c4 c5":                           {"name": "Benoni Defense",               "eco": "A56"},
    "d4 Nf6 c4 c5 d5":                        {"name": "Modern Benoni",                "eco": "A60"},
    "d4 Nf6 Nf3 g6":                          {"name": "Neo-Grünfeld",                 "eco": "A04"},
    "d4 f5":                                   {"name": "Dutch Defense",                "eco": "A80"},
    "d4 f5 c4 Nf6 Nc3 e6":                    {"name": "Dutch, Classical",             "eco": "A90"},
    "d4 f5 e4":                               {"name": "Dutch, Staunton Gambit",       "eco": "A82"},
    "d4 e6":                                  {"name": "Queen's Pawn Game",            "eco": "D00"},
    "d4 g6":                                  {"name": "Modern Defense vs d4",         "eco": "A40"},
    "d4 c5":                                  {"name": "Old Benoni",                   "eco": "A43"},
    "d4 d6":                                  {"name": "Wade Defense",                 "eco": "A41"},
    # Sicilian
    "e4":                                     {"name": "King's Pawn Opening",          "eco": "B00"},
    "e4 c5":                                  {"name": "Sicilian Defense",             "eco": "B20"},
    "e4 c5 Nf3 d6":                          {"name": "Sicilian, Najdorf",            "eco": "B90"},
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6": {"name": "Sicilian Najdorf",             "eco": "B90"},
    "e4 c5 Nf3 Nc6":                         {"name": "Sicilian, Classical",          "eco": "B56"},
    "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 d6":{"name": "Sicilian, Scheveningen",       "eco": "B80"},
    "e4 c5 Nf3 e6":                          {"name": "Sicilian, Kan Variation",      "eco": "B41"},
    "e4 c5 c3":                               {"name": "Sicilian, Alapin",             "eco": "B22"},
    "e4 c5 Nc3":                              {"name": "Sicilian, Closed",             "eco": "B23"},
    "e4 c5 f4":                               {"name": "Sicilian, Grand Prix Attack",  "eco": "B21"},
    "e4 c5 d4 cxd4 c3":                       {"name": "Sicilian, Smith-Morra Gambit", "eco": "B21"},
    # Caro-Kann
    "e4 c6":                                  {"name": "Caro-Kann Defense",            "eco": "B10"},
    "e4 c6 d4 d5":                            {"name": "Caro-Kann Defense",            "eco": "B13"},
    "e4 c6 d4 d5 Nc3 dxe4 Nxe4":            {"name": "Caro-Kann, Classical",         "eco": "B18"},
    "e4 c6 d4 d5 e5":                         {"name": "Caro-Kann, Advance",           "eco": "B12"},
    "e4 c6 d4 d5 exd5 cxd5 c4":              {"name": "Caro-Kann, Panov Attack",      "eco": "B13"},
    # French
    "e4 e6":                                  {"name": "French Defense",               "eco": "C00"},
    "e4 e6 d4 d5":                            {"name": "French Defense",               "eco": "C01"},
    "e4 e6 d4 d5 Nc3":                        {"name": "French, Classical",            "eco": "C11"},
    "e4 e6 d4 d5 Nc3 Nf6 Bg5":               {"name": "French, Classical Main Line",  "eco": "C11"},
    "e4 e6 d4 d5 e5":                         {"name": "French, Advance",              "eco": "C02"},
    "e4 e6 d4 d5 exd5":                       {"name": "French, Exchange",             "eco": "C01"},
    "e4 e6 d4 d5 Nd2":                        {"name": "French, Tarrasch",             "eco": "C03"},
    "e4 e6 d4 d5 Nd2 Nf6 e5 Nfd7 Ngf3 c5":  {"name": "French, Tarrasch Closed",      "eco": "C05"},
    # Other 1.e4 defenses
    "e4 d6":                                  {"name": "Pirc Defense",                 "eco": "B07"},
    "e4 d6 d4 Nf6 Nc3 g6":                   {"name": "Pirc, Classical",              "eco": "B08"},
    "e4 g6":                                  {"name": "Modern Defense",               "eco": "B06"},
    "e4 d5":                                  {"name": "Scandinavian Defense",         "eco": "B01"},
    "e4 d5 exd5 Qxd5":                        {"name": "Scandinavian, Main Line",      "eco": "B01"},
    "e4 d5 exd5 Nf6":                         {"name": "Scandinavian, Modern",         "eco": "B01"},
    "e4 Nf6":                                 {"name": "Alekhine's Defense",           "eco": "B02"},
    "e4 Nf6 e5 Nd5 d4 d6 c4 Nb6":            {"name": "Alekhine, Four Pawns Attack",  "eco": "B03"},
    "e4 Nc6":                                 {"name": "Nimzowitsch Defense",          "eco": "B00"},
    # Open games (1.e4 e5)
    "e4 e5":                                  {"name": "Open Game",                    "eco": "C20"},
    "e4 e5 Nf3":                              {"name": "King's Knight Opening",        "eco": "C44"},
    "e4 e5 Nf3 Nc6":                          {"name": "King's Knight Opening",        "eco": "C44"},
    "e4 e5 Nf3 Nc6 Bb5":                      {"name": "Ruy Lopez",                    "eco": "C60"},
    "e4 e5 Nf3 Nc6 Bb5 a6":                   {"name": "Ruy Lopez, Morphy Defense",    "eco": "C68"},
    "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6":          {"name": "Ruy Lopez, Open",              "eco": "C80"},
    "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7":  {"name": "Ruy Lopez, Closed",            "eco": "C88"},
    "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O b5 Bb3 d6 c3 O-O": {
        "name": "Ruy Lopez, Marshall Attack", "eco": "C89"},
    "e4 e5 Nf3 Nc6 Bb5 Nf6":                 {"name": "Berlin Defense",               "eco": "C65"},
    "e4 e5 Nf3 Nc6 Bc4":                      {"name": "Italian Game",                 "eco": "C50"},
    "e4 e5 Nf3 Nc6 Bc4 Bc5":                  {"name": "Giuoco Piano",                 "eco": "C50"},
    "e4 e5 Nf3 Nc6 Bc4 Bc5 c3":              {"name": "Giuoco Piano, Main Line",      "eco": "C54"},
    "e4 e5 Nf3 Nc6 Bc4 Nf6":                  {"name": "Two Knights Defense",          "eco": "C55"},
    "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5":             {"name": "Two Knights, Main Line",       "eco": "C57"},
    "e4 e5 Nf3 Nc6 d4 exd4":                  {"name": "Scotch Game",                  "eco": "C44"},
    "e4 e5 Nf3 Nc6 d4 exd4 Nxd4":            {"name": "Scotch Game",                  "eco": "C45"},
    "e4 e5 Nf3 Nc6 d4 exd4 Bc4":             {"name": "Scotch Gambit",                "eco": "C44"},
    "e4 e5 f4":                               {"name": "King's Gambit",                "eco": "C30"},
    "e4 e5 f4 exf4":                          {"name": "King's Gambit Accepted",       "eco": "C33"},
    "e4 e5 f4 exf4 Nf3":                     {"name": "KGA, King's Knight Gambit",    "eco": "C34"},
    "e4 e5 f4 d5":                            {"name": "Falkbeer Counter-Gambit",      "eco": "C31"},
    "e4 e5 f4 Bc5":                           {"name": "King's Gambit Declined",       "eco": "C30"},
    "e4 e5 Nc3":                              {"name": "Vienna Game",                  "eco": "C25"},
    "e4 e5 Nc3 Nf6 f4":                      {"name": "Vienna Gambit",                "eco": "C28"},
    "e4 e5 d4":                               {"name": "Center Game",                  "eco": "C21"},
    "e4 e5 Bc4":                              {"name": "Bishop's Opening",             "eco": "C23"},
    "e4 e5 Nf3 f5":                           {"name": "Latvian Gambit",               "eco": "C40"},
    "e4 e5 Nf3 d5":                           {"name": "Elephant Gambit",              "eco": "C40"},
    "e4 e5 Nf3 Nf6":                          {"name": "Petrov's Defense",             "eco": "C42"},
    "e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4":    {"name": "Petrov, Main Line",            "eco": "C42"},
    # More Sicilian
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6":  {"name": "Sicilian, Dragon",             "eco": "B70"},
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3": {"name": "Sicilian, Yugoslav Attack",   "eco": "B76"},
    "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 e5 Nb5 d6":  {"name": "Sicilian, Sveshnikov",         "eco": "B33"},
    "e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6":         {"name": "Sicilian, Taimanov",           "eco": "B46"},
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bg5": {"name": "Sicilian, English Attack",  "eco": "B90"},
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be2":  {"name": "Sicilian Najdorf, Opocensky",  "eco": "B92"},
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6":  {"name": "Sicilian, Scheveningen",       "eco": "B80"},
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6": {"name": "Sicilian, Sozin",              "eco": "B56"},
    # More Ruy Lopez
    "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3": {"name": "Ruy Lopez, Chigorin",   "eco": "C97"},
    "e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O":    {"name": "Ruy Lopez, Exchange",          "eco": "C68"},
    "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Nxe4": {"name": "Ruy Lopez, Open / Tarrasch",   "eco": "C82"},
    "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O d4": {"name": "Ruy Lopez, Anti-Marshall", "eco": "C88"},
    "e4 e5 Nf3 Nc6 Bb5 Bc5":                  {"name": "Ruy Lopez, Classical",         "eco": "C64"},
    "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5": {"name": "Berlin Endgame",          "eco": "C67"},
    # More Italian
    "e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 d3":      {"name": "Giuoco Pianissimo",            "eco": "C54"},
    "e4 e5 Nf3 Nc6 Bc4 Bc5 b4":              {"name": "Evans Gambit",                  "eco": "C51"},
    "e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5":  {"name": "Evans Gambit Accepted",        "eco": "C51"},
    "e4 e5 Nf3 Nc6 Bc4 Be7":                  {"name": "Hungarian Defense",            "eco": "C50"},
    "e4 e5 Nf3 Nc6 Bc4 Nf6 d4 exd4 e5":      {"name": "Max Lange Attack",             "eco": "C55"},
    # Four Knights / Three Knights
    "e4 e5 Nf3 Nc6 Nc3 Nf6":                  {"name": "Four Knights Game",            "eco": "C47"},
    "e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5":             {"name": "Four Knights, Spanish",         "eco": "C49"},
    "e4 e5 Nf3 Nc6 Nc3 Nf6 d4":              {"name": "Four Knights, Scotch",          "eco": "C47"},
    "e4 e5 Nf3 Nc6 Nc3":                      {"name": "Three Knights Opening",        "eco": "C46"},
    # More Scotch
    "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5":       {"name": "Scotch, Classical",             "eco": "C45"},
    "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nc3":   {"name": "Scotch, Four Knights",          "eco": "C45"},
    # More Caro-Kann
    "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5":        {"name": "Caro-Kann, Classical",          "eco": "B18"},
    "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nd7":        {"name": "Caro-Kann, Karpov",             "eco": "B17"},
    "e4 c6 d4 d5 Nc3 g6":                    {"name": "Caro-Kann, Bronstein-Larsen",   "eco": "B16"},
    "e4 c6 Nf3 d5 Nc3":                      {"name": "Caro-Kann, Two Knights",        "eco": "B11"},
    # More French
    "e4 e6 d4 d5 Nc3 Bb4":                   {"name": "French, Winawer",               "eco": "C15"},
    "e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3": {"name": "French, Winawer Main Line",  "eco": "C18"},
    "e4 e6 d4 d5 e5 c5 c3 Nc6":              {"name": "French, Advance, Main Line",    "eco": "C02"},
    # More QGD
    "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6": {"name": "QGD, Tartakower",         "eco": "D63"},
    "d4 d5 c4 e6 Nc3 Nf6 Nf3 c5":           {"name": "Semi-Tarrasch Defense",          "eco": "D40"},
    "d4 d5 c4 e6 Nf3 Nf6 Nc3 Bb4":          {"name": "Ragozin Defense",                "eco": "D38"},
    "d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5":    {"name": "QGD, Exchange",                  "eco": "D35"},
    "d4 d5 c4 e6 Nc3 c6":                    {"name": "Semi-Slav, Noteboom",            "eco": "D31"},
    "d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7":   {"name": "Semi-Slav, Meran",              "eco": "D47"},
    "d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4":         {"name": "Slav Gambit",                    "eco": "D15"},
    # Catalan
    "d4 Nf6 c4 e6 Nf3 d5 g3":               {"name": "Catalan Opening",                "eco": "E01"},
    "d4 Nf6 c4 e6 Nf3 d5 g3 Be7 Bg2 O-O":   {"name": "Catalan, Closed",               "eco": "E06"},
    "d4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O":   {"name": "Catalan, Open",                 "eco": "E04"},
    # More KID
    "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f4":        {"name": "King's Indian, Four Pawns",     "eco": "E76"},
    "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Be3":       {"name": "King's Indian, Averbakh",       "eco": "E73"},
    "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3":        {"name": "King's Indian, Sämisch",        "eco": "E86"},
    "d4 Nf6 c4 g6 g3 Bg7 Bg2 O-O Nc3 d6":   {"name": "King's Indian, Fianchetto",    "eco": "E62"},
    "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5": {"name": "KID, Classical, Main Line", "eco": "E91"},
    # More Nimzo-Indian
    "d4 Nf6 c4 e6 Nc3 Bb4 Qc2":             {"name": "Nimzo-Indian, Classical",       "eco": "E32"},
    "d4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3+ Qxc3 b6": {"name": "Nimzo-Indian, Zurich", "eco": "E32"},
    "d4 Nf6 c4 e6 Nc3 Bb4 f3":              {"name": "Nimzo-Indian, Sämisch",         "eco": "E20"},
    "d4 Nf6 c4 e6 Nc3 Bb4 Nf3 c5 O-O":     {"name": "Nimzo-Indian, Kasparov",        "eco": "E43"},
    # More Grünfeld
    "d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Bc4": {"name": "Grünfeld, Exchange, Classical", "eco": "D87"},
    "d4 Nf6 c4 g6 Nc3 d5 Nf3 Bg7 Qb3":     {"name": "Grünfeld, Tchigorin",           "eco": "D82"},
    # More Dutch
    "d4 f5 c4 Nf6 g3 e6 Bg2 Be7 Nf3 O-O":  {"name": "Dutch, Leningrad",              "eco": "A87"},
    "d4 f5 c4 Nf6 g3 e6 Bg2 d5 Nf3":       {"name": "Dutch, Stonewall",              "eco": "A90"},
    # More English
    "c4 e5 Nf3 Nc6 Nc3 Nf6":               {"name": "English, Four Knights",          "eco": "A28"},
    "c4 Nf6 Nc3 d5 cxd5 Nxd5":             {"name": "English, Nimzo-English",         "eco": "A34"},
    "c4 c5 Nf3 Nf6 Nc3 d5 cxd5 Nxd5":     {"name": "English, Symmetrical, Four Knights", "eco": "A33"},
    "c4 e6 Nc3 d5 d4":                     {"name": "English, Transposition to QGD",  "eco": "A10"},
    # Trompowsky
    "d4 Nf6 Bg5":                          {"name": "Trompowsky Attack",              "eco": "A45"},
    "d4 Nf6 Bg5 Ne4 Bf4 c5":              {"name": "Trompowsky, Main Line",           "eco": "A45"},
    # Torre Attack
    "d4 Nf6 Nf3 e6 Bg5":                  {"name": "Torre Attack",                   "eco": "A46"},
    "d4 Nf6 Nf3 g6 Bg5":                  {"name": "Torre Attack vs KID",            "eco": "A48"},
    # Budapest / Benko
    "d4 Nf6 c4 e5":                       {"name": "Budapest Gambit",                "eco": "A51"},
    "d4 Nf6 c4 e5 dxe5 Ng4":             {"name": "Budapest Gambit, Main Line",     "eco": "A52"},
    "d4 Nf6 c4 c5 d5 b5":                {"name": "Benko Gambit",                   "eco": "A57"},
    "d4 Nf6 c4 c5 d5 b5 cxb5 a6":       {"name": "Benko Gambit Accepted",          "eco": "A58"},
    # Colle-Zukertort
    "d4 d5 Nf3 Nf6 e3 e6 Bd3 c5 b3":    {"name": "Colle-Zukertort System",         "eco": "D05"},
    # More Réti / Flank
    "Nf3 d5 c4":                          {"name": "Réti Opening, Main Line",        "eco": "A09"},
    "Nf3 Nf6 c4 g6 b4":                  {"name": "Réti, Reti Gambit",              "eco": "A04"},
    "c4 e5 g3 Nf6 Bg2 d5 cxd5 Nxd5":    {"name": "English, Reversed Dragon",       "eco": "A22"},
    # More Pirc / Modern
    "e4 d6 d4 Nf6 Nc3 g6 Be3":           {"name": "Pirc, Austrian Attack",          "eco": "B09"},
    "e4 g6 d4 Bg7 Nc3 d6":               {"name": "Modern Defense, Main Line",      "eco": "B06"},
    # Chigorin Defense
    "d4 d5 c4 Nc6":                      {"name": "Chigorin Defense",               "eco": "D07"},
    # Benoni more
    "d4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6 Nf3 g6": {"name": "Modern Benoni, Main Line", "eco": "A70"},
    # Alekhine more
    "e4 Nf6 e5 Nd5 d4 d6 Nf3 Bg4":      {"name": "Alekhine, Modern",               "eco": "B04"},
    "e4 Nf6 e5 Nd5 c4 Nb6 d4 d6 f4":    {"name": "Alekhine, Four Pawns",           "eco": "B03"},
    # Scandinavian more
    "e4 d5 exd5 Qxd5 Nc3 Qa5":          {"name": "Scandinavian, Mieses-Kotroc",    "eco": "B01"},
    "e4 d5 exd5 Qxd5 Nc3 Qd6":          {"name": "Scandinavian, Gubinsky-Melts",   "eco": "B01"},
    "e4 d5 exd5 Nf6 d4 Nxd5 Nf3":       {"name": "Scandinavian, Icelandic-Palme",  "eco": "B01"},
    # Owen's / St George
    "e4 b6":                             {"name": "Owen's Defense",                 "eco": "B00"},
    "e4 a6":                             {"name": "St George Defense",              "eco": "B00"},
    # King's Indian Attack
    "Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 d3":  {"name": "King's Indian Attack",           "eco": "A07"},
}


# ─────────────────────────── Win-probability helpers ────────────────────────
# Chess.com uses win probability (not raw centipawns) for accuracy & classification.
# This normalises for game phase: a 200 cp loss at +500 is very different from
# a 200 cp loss in a sharp equal position.

def _win_prob(cp: int) -> float:
    """White's win probability (0–1) from a centipawn score.
    Formula from chess.com / Lichess WDL model.
    """
    cp_c = max(-2000, min(2000, cp))          # clamp to avoid exp overflow
    return 1.0 / (1.0 + math.exp(-0.00368208 * cp_c))


def _classify_move(score_before: int, score_after: int,
                   is_white: bool) -> tuple[str, int, float]:
    """
    Return (classification, cp_loss, accuracy_score).

    score_before / score_after are always from White's perspective
    (using score.white().score(mate_score=10000)).
    is_white = True when the moving player is White.

    accuracy_score is 0–100, matching chess.com's per-move accuracy formula:
        acc = 103.1668 * exp(-0.04354 * wp_drop_pct) - 3.1669
    """
    # Clamp mate scores so win_prob doesn't saturate
    sb = max(-9900, min(9900, score_before))
    sa = max(-9900, min(9900, score_after))

    if is_white:
        wp_before = _win_prob(sb)
        wp_after  = _win_prob(sa)
        cp_loss   = sb - sa          # positive = White lost centipawns
    else:
        wp_before = 1.0 - _win_prob(sb)   # Black's win prob before
        wp_after  = 1.0 - _win_prob(sa)   # Black's win prob after
        cp_loss   = sa - sb          # positive = Black lost (White's score went up)

    # Win-probability change for the moving player
    wp_change_pct = (wp_after - wp_before) * 100.0
    # Drop is the loss (clamped to 0 when position improved)
    wp_drop_pct = max(0.0, -wp_change_pct)

    # Chess.com accuracy formula per move
    raw = 103.1668 * math.exp(-0.04354 * wp_drop_pct) - 3.1669
    accuracy_score = round(max(0.0, min(100.0, raw)), 1)

    # Brilliant: mover's win prob improved ≥5pp from a contested position (not already winning)
    if wp_change_pct >= 5.0 and wp_before < 0.85:
        return "Brilliant", round(cp_loss), 100.0

    # Classification thresholds — calibrated to chess.com's win-probability model:
    #   Blunder    > 20 pp drop  (~hanging a piece from equal: 300 cp ≈ 25% drop)
    #   Mistake   10–20 pp drop  (gives opponent clear advantage)
    #   Inaccuracy 5–10 pp drop  (suboptimal, opponent can improve)
    #   Good       2–5  pp drop  (slightly imprecise)
    #   Excellent  1–2  pp drop  (very close to best)
    #   Best       < 1  pp drop  (engine-matching)
    if wp_drop_pct < 1:
        classification = "Best"
    elif wp_drop_pct < 2:
        classification = "Excellent"
    elif wp_drop_pct < 5:
        classification = "Good"
    elif wp_drop_pct < 10:
        classification = "?! Inaccuracy"
    elif wp_drop_pct < 20:
        classification = "? Mistake"
    else:
        classification = "?? Blunder"

    return classification, round(cp_loss), accuracy_score


def estimate_elo_from_accuracy(avg_cp_loss: float) -> int:
    """Empirical ELO estimate from average centipawn loss per player move.
    Self-contained for the Analyze tab (deliberately not shared with the
    profile service) — used to pick the ELO band for AI coaching prompts and
    as a fallback when a game's PGN headers don't carry a rating.
    """
    if avg_cp_loss <= 0:
        return 2800
    elo = 2850.0 * math.exp(-0.018 * avg_cp_loss)
    return max(400, min(2800, round(elo / 25) * 25))


# ─────────────────────────── Tactical theme heuristics ───────────────────────
# Cheap, no-extra-engine-call classification of what tactical idea the
# engine's recommended move exploits, used to tag puzzles/mistakes for the
# per-user "mistake fingerprint" (which patterns cost this player the most,
# aggregated across games). This is intentionally a heuristic, separate from
# and less nuanced than the LLM-based `theme` field in ai_service.explain_position
# — good enough to bucket puzzles for spaced-repetition without an LLM call
# on every one of them.

_PIECE_VALUE = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


def classify_tactical_theme(fen_before: str, best_move_uci: str, phase: str) -> str:
    """Best-effort tag for the tactical/positional idea behind `best_move`
    played from `fen_before`. Falls back to a phase-based generic bucket."""
    try:
        board = chess.Board(fen_before)
        mover_color = board.turn
        move = chess.Move.from_uci(best_move_uci)
        if move not in board.legal_moves:
            raise ValueError("illegal move for theme classification")

        from_sq, to_sq = move.from_square, move.to_square
        moved_piece = board.piece_at(from_sq)
        is_capture = board.is_capture(move)
        captured_piece = board.piece_at(to_sq) if is_capture else None

        # Undefended capture — the single most common pattern below ~1200 Elo.
        if is_capture and captured_piece:
            defenders = board.attackers(not mover_color, to_sq)
            if len(defenders) == 0:
                return "Hanging Piece"

        board.push(move)

        # Back-rank mate: rook/queen delivers mate on the back rank.
        if board.is_checkmate() and moved_piece and moved_piece.piece_type in (chess.ROOK, chess.QUEEN):
            back_rank = 7 if mover_color == chess.WHITE else 0
            if chess.square_rank(to_sq) == back_rank:
                return "Tactics: Back Rank"

        # Fork — the moved piece now attacks 2+ enemy pieces worth >= a knight,
        # at least one of them undefended or the king (a "royal fork").
        if moved_piece:
            attacked = [
                sq for sq in board.attacks(to_sq)
                if (p := board.piece_at(sq)) and p.color != mover_color and _PIECE_VALUE[p.piece_type] >= 3
            ]
            if len(attacked) >= 2:
                return "Tactics: Fork"

        # Discovered attack — a DIFFERENT piece than the one that moved now
        # attacks the enemy king or a piece worth >= a rook, and didn't before.
        board.pop()
        pre_attackers = {
            sq for sq in board.piece_map()
            if board.piece_at(sq) and board.piece_at(sq).color == mover_color and sq != from_sq
        }
        board.push(move)
        for sq in pre_attackers:
            piece = board.piece_at(sq)
            if not piece:
                continue
            targets = [
                t for t in board.attacks(sq)
                if (p := board.piece_at(t)) and p.color != mover_color
                and (p.piece_type == chess.KING or _PIECE_VALUE[p.piece_type] >= 5)
            ]
            if targets:
                return "Tactics: Discovered Attack"

        # New pin created against the opponent's king.
        opp_color = not mover_color
        for sq, piece in board.piece_map().items():
            if piece.color == opp_color and piece.piece_type != chess.KING and board.is_pinned(opp_color, sq):
                return "Tactics: Pin"

        if board.is_check():
            return "King Safety"

    except Exception:
        pass

    if phase == "Endgame":
        return "Endgame: Technique"
    if phase == "Opening":
        return "Opening Development"
    return "Positional"


def _looks_like_sacrifice(fen_before: str, move_uci: str) -> bool:
    """True when the destination square is defended by more enemy attackers
    than the mover has support for it — i.e. an immediate recapture would
    leave the mover materially worse off. Cheap static check, no search."""
    try:
        board = chess.Board(fen_before)
        move = chess.Move.from_uci(move_uci)
        mover_color = board.turn
        moved_piece = board.piece_at(move.from_square)
        if not moved_piece:
            return False
        to_sq = move.to_square
        captured = board.piece_at(to_sq)
        gained = _PIECE_VALUE[captured.piece_type] if captured else 0
        board.push(move)
        defenders = board.attackers(not mover_color, to_sq)
        if not defenders:
            return False
        attackers = board.attackers(mover_color, to_sq)
        # Opponent recaptures with their cheapest defender; mover recaptures
        # back with their cheapest attacker if any remain — net material swing.
        cheapest_defender = min((_PIECE_VALUE[board.piece_at(sq).piece_type] for sq in defenders), default=0)
        net = gained - _PIECE_VALUE[moved_piece.piece_type]
        return net < -1 and (not attackers or cheapest_defender > 0)
    except Exception:
        return False


def is_practical_move(fen_before: str, top_moves: List[Dict[str, Any]]) -> Dict[str, bool]:
    """Cheap 'human-playable vs. computer-only' heuristic, using data already
    computed for MultiPV plus one static (no-search) check per candidate — no
    extra engine calls. A move is flagged computer-only when it's dramatically
    better than the alternatives (a narrow, only-move-precision situation)
    AND itself gives up material immediately (a real finding from engine-vs-human
    play research: stable-eval, materially-clean moves are practical; razor-
    margin sacrifices usually aren't, even when objectively "best").
    Returns {uci: is_practical} for each of the given top_moves.
    """
    result: Dict[str, bool] = {}
    if not top_moves:
        return result
    best_cp = top_moves[0]["score_cp"]
    for i, tm in enumerate(top_moves):
        looks_forced = i == 0 and len(top_moves) > 1 and (best_cp - top_moves[1]["score_cp"]) > 150
        is_sac = looks_forced and _looks_like_sacrifice(fen_before, tm["uci"])
        result[tm["uci"]] = not is_sac
    return result


# ─────────────────────────── Stockfish locator ───────────────────────────────

def _find_stockfish() -> Optional[str]:
    system_sf = shutil.which("stockfish")
    if system_sf:
        return system_sf
    bundled = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stockfish_14_x64_popcnt")
    if os.path.exists(bundled) and platform.system() == "Linux":
        return bundled
    return None


# ─────────────────────────── StockfishService ────────────────────────────────

class StockfishService:
    def __init__(self, depth: int = 18):
        self.depth = depth
        self.available = False
        self.engine = None
        self._sf_path: Optional[str] = None

        sf_path = _find_stockfish()
        if not sf_path:
            logger.warning(
                "Stockfish not found. Install via: brew install stockfish (macOS) "
                "or apt install stockfish (Linux)."
            )
            return

        self._sf_path = sf_path
        self._start_engine()

    def _start_engine(self) -> bool:
        """Start (or restart) the Stockfish process. Returns True on success."""
        if not self._sf_path:
            return False
        try:
            if not os.access(self._sf_path, os.X_OK):
                os.chmod(self._sf_path, 0o755)
            self.engine = chess.engine.SimpleEngine.popen_uci(self._sf_path)
            self.engine.configure({"Threads": 1, "Hash": 128})
            self.available = True
            logger.info("Stockfish initialised: %s", self._sf_path)
            return True
        except Exception as e:
            logger.error("Stockfish failed to start: %s", e)
            self.available = False
            self.engine = None
            return False

    def _ensure_engine(self) -> bool:
        """Return True if engine is alive; try to restart it if it crashed."""
        if not self.available or self.engine is None:
            return False
        try:
            # Quick health-check: ask the engine to analyse the starting position for 0 nodes
            self.engine.analyse(chess.Board(), chess.engine.Limit(nodes=1))
            return True
        except Exception:
            logger.warning("Stockfish engine appears dead — restarting.")
            try:
                self.engine.quit()
            except Exception:
                pass
            return self._start_engine()

    def analyze_game_moves(self, pgn_text: str, player_color: str = "white",
                           depth: int = 18, progress_callback=None) -> List[Dict[str, Any]]:
        if not self._ensure_engine():
            raise RuntimeError("Stockfish engine is not available. Install via: brew install stockfish")
        try:
            game = chess.pgn.read_game(StringIO(pgn_text))
            if not game:
                return []

            board = game.board()
            moves_data = []

            # Materialise mainline once — avoids a second PGN parse just to count moves
            mainline    = list(game.mainline())
            total_moves = len(mainline)

            # ── Pipelined evaluation with MultiPV=3 ──────────────────────────
            # multipv=3 gives the top-3 candidate moves for every position, used
            # for arrows and the eval strip.  The engine returns a list of InfoDicts
            # ordered from best to worst PV.  We always use pv_list[0] for the
            # pipeline (same score as multipv=1) so move classification is unchanged.
            # Engine calls: N+1 for N half-moves (same as before — no extra calls).
            _MULTI_PV   = 3

            def _analyse(b: chess.Board):
                """Run engine analysis; always return a non-empty list of InfoDicts."""
                result = self.engine.analyse(b, chess.engine.Limit(depth=depth),
                                             multipv=_MULTI_PV)
                if not isinstance(result, list):
                    result = [result]
                return result

            def _score(pv: list) -> Optional[int]:
                """Extract White-POV centipawn score from pv_list[0]; None if unavailable."""
                if not pv:
                    return None
                info = pv[0]
                sc = info.get("score")
                if sc is None:
                    return None
                return sc.white().score(mate_score=10000)

            pv_list      = _analyse(board)
            score_before = _score(pv_list)

            for move_num, node in enumerate(mainline, start=1):
                if progress_callback and total_moves:
                    progress_callback(move_num, total_moves)

                move     = node.move
                san      = board.san(move)
                is_white = (board.turn == chess.WHITE)  # capture BEFORE push
                comment  = getattr(node, 'comment', '') or ''
                clock_remaining = _parse_clock(comment)
                full_move_num   = (move_num + 1) // 2

                # ── Top-3 best moves from the pre-move position ──────────────
                top_moves = []
                for pv_info in pv_list[:_MULTI_PV]:
                    if not pv_info.get("pv"):
                        continue
                    pv_moves = pv_info["pv"]
                    bm       = pv_moves[0]
                    sc_info  = pv_info.get("score")
                    bm_score = sc_info.white().score(mate_score=10000) if sc_info else 0
                    # Build continuation: walk the PV after the best move
                    continuation: List[str] = []
                    try:
                        tmp = board.copy()
                        tmp.push(bm)
                        for pv_mv in pv_moves[1:6]:
                            continuation.append(tmp.san(pv_mv))
                            tmp.push(pv_mv)
                    except Exception:
                        pass
                    top_moves.append({
                        "san":          board.san(bm),
                        "uci":          bm.uci(),
                        "score_cp":     bm_score,
                        "continuation": continuation,
                    })

                best_move_san = top_moves[0]["san"] if top_moves else "N/A"
                best_move_uci = top_moves[0]["uci"] if top_moves else ""

                # Human-playable vs. computer-only labeling (Analyze tab USP —
                # see ANALYSIS_STRATEGY.md section 6): cheap, no extra engine calls.
                fen_before_move = board.fen()
                practical_map = is_practical_move(fen_before_move, top_moves)
                for tm in top_moves:
                    tm["practical"] = practical_map.get(tm["uci"], True)

                board.push(move)

                # One engine call per half-move; result reused as baseline next iteration.
                pv_list     = _analyse(board)
                score_after = _score(pv_list)

                if score_before is not None and score_after is not None:
                    classification, cp_loss, accuracy_score = _classify_move(
                        score_before, score_after, is_white
                    )
                else:
                    classification = "Best"
                    cp_loss        = 0
                    accuracy_score = 100.0

                moves_data.append({
                    "move_number":      full_move_num,
                    "color":            "White" if is_white else "Black",
                    "move_san":         san,
                    "best_move_san":    best_move_san,
                    "best_move_uci":    best_move_uci,
                    "top_moves":        top_moves,
                    "score_before":     score_before,
                    "score_after":      score_after,
                    "cp_loss":          cp_loss,
                    "classification":   classification,
                    "accuracy_score":   accuracy_score,
                    "clock_remaining":  clock_remaining,
                    "phase":            _get_phase_by_material(board, full_move_num),
                })

                # Pipeline: carry this position's analysis forward as next baseline
                score_before = score_after

            return moves_data
        except chess.engine.EngineTerminatedError:
            self.available = False
            self.engine = None
            raise RuntimeError("Stockfish engine crashed during analysis. Please try again.")
        except Exception as e:
            logger.error("Error in analyze_game_moves: %s\n%s", e, traceback.format_exc())
            raise RuntimeError(f"Analysis failed: {e}") from e

    def analyze_position(self, fen: str, multi_pv: int = 1) -> Dict[str, Any]:
        if not self._ensure_engine():
            return {"error": "Stockfish not available"}
        try:
            board = chess.Board(fen)
            info_list = self.engine.analyse(
                board, chess.engine.Limit(depth=self.depth), multipv=multi_pv
            )
            result: Dict[str, Any] = {"fen": fen, "top_moves": []}
            for idx, pv_info in enumerate(info_list):
                score = pv_info["score"].relative
                eval_type = "mate" if score.is_mate() else "cp"
                eval_value = score.mate() if score.is_mate() else score.score()
                if idx == 0:
                    result["evaluation"] = {"type": eval_type, "value": eval_value}
                result["top_moves"].append({
                    "Move": pv_info["pv"][0].uci(),
                    "SAN": board.san(pv_info["pv"][0]),
                    "Evaluation": {"type": eval_type, "value": eval_value},
                })
            return result
        except Exception as e:
            logger.error("Error in analyze_position: %s", e)
            return {"error": str(e)}

    def collect_game_puzzles(
        self,
        pgn_text: str,
        player_color: str,
        depth: int = 10,
        min_cp_loss: int = 75,
        max_puzzles_per_game: int = 5,
        pv_depth: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        Analyse one game at `depth` and return puzzle dicts for positions where
        the specified player made a significant error.

        Each returned dict contains:
            fen            – FEN of the position BEFORE the bad move (what to solve)
            move_number    – full-move number (1-based)
            color          – "White" or "Black"
            played_san     – the bad move actually played
            best_move_san  – engine's top recommendation
            continuation   – list[str] of SAN moves (up to pv_depth from best_move)
            classification – "?? Blunder" / "? Mistake" / "?! Inaccuracy"
            cp_loss        – centipawn loss (int, positive = bad for the mover)
            phase          – "Opening" / "Middlegame" / "Endgame"
            game_white     – White player name from headers
            game_black     – Black player name from headers
            game_date      – Date from headers
        """
        if not self.available:
            return []
        try:
            game = chess.pgn.read_game(StringIO(pgn_text))
            if not game:
                return []

            headers    = game.headers
            game_white = headers.get("White", "?")
            game_black = headers.get("Black", "?")
            game_date  = headers.get("Date",  "?")
            player_cap = player_color.capitalize()

            board   = game.board()
            puzzles: List[Dict[str, Any]] = []

            _MPV = 1   # single PV is enough here — faster for bulk processing
            pv_list = self.engine.analyse(
                board, chess.engine.Limit(depth=depth), multipv=_MPV
            )
            if not isinstance(pv_list, list):
                pv_list = [pv_list]
            score_before = pv_list[0]["score"].white().score(mate_score=10000)
            fen_before   = board.fen()

            for half_move, node in enumerate(game.mainline(), start=1):
                move       = node.move
                san        = board.san(move)
                is_white   = (board.turn == chess.WHITE)
                move_number = (half_move + 1) // 2
                color_str  = "White" if is_white else "Black"

                # ── Capture best move + PV BEFORE pushing ────────────────────
                best_pv       = pv_list[0].get("pv", [])
                best_move_san = board.san(best_pv[0]) if best_pv else "N/A"

                # Build continuation line (starting FROM best_move)
                continuation: List[str] = []
                if best_pv:
                    tmp = board.copy()
                    for pv_mv in best_pv[:pv_depth]:
                        try:
                            continuation.append(tmp.san(pv_mv))
                            tmp.push(pv_mv)
                        except Exception:
                            break

                saved_fen = fen_before   # FEN player sees as puzzle

                # ── Push the actual move ──────────────────────────────────────
                board.push(move)

                pv_list = self.engine.analyse(
                    board, chess.engine.Limit(depth=depth), multipv=_MPV
                )
                if not isinstance(pv_list, list):
                    pv_list = [pv_list]
                score_after = pv_list[0]["score"].white().score(mate_score=10000)

                if score_before is not None and score_after is not None:
                    classification, cp_loss, _ = _classify_move(
                        score_before, score_after, is_white
                    )
                else:
                    classification = "Best"
                    cp_loss        = 0

                if (
                    color_str == player_cap
                    and any(k in classification for k in ("Blunder", "Mistake", "Inaccuracy"))
                    and cp_loss >= min_cp_loss
                    and len(puzzles) < max_puzzles_per_game
                ):
                    phase = _get_phase_by_material(board, move_number)
                    theme = classify_tactical_theme(
                        saved_fen, best_pv[0].uci() if best_pv else "", phase
                    )
                    puzzles.append({
                        "fen":            saved_fen,
                        "move_number":    move_number,
                        "color":          color_str,
                        "played_san":     san,
                        "best_move_san":  best_move_san,
                        "continuation":   continuation,
                        "classification": classification,
                        "cp_loss":        cp_loss,
                        "phase":          phase,
                        "theme":          theme,
                        "game_white":     game_white,
                        "game_black":     game_black,
                        "game_date":      game_date,
                    })

                score_before = score_after
                fen_before   = board.fen()

            return puzzles
        except Exception as e:
            logger.error("collect_game_puzzles error: %s", e)
            return []

    def __del__(self):
        if self.engine:
            try:
                self.engine.quit()
            except Exception:
                pass


# ─────────────────────────── OpeningDBService ────────────────────────────────

class OpeningDBService:
    def __init__(self):
        self.openings_db = OPENINGS_DB
        self.available = True

    def identify_opening(self, moves: List[str]) -> Dict[str, str]:
        moves_str = " ".join(moves)
        best_match, best_len = None, 0
        for key, data in self.openings_db.items():
            if moves_str.startswith(key) and len(key) > best_len:
                best_match = data
                best_len = len(key)
        return {"name": best_match["name"], "eco": best_match["eco"]} if best_match \
            else {"name": "Unknown Opening", "eco": ""}


# ─────────────────────────── GameAnalysisService ─────────────────────────────

class GameAnalysisService:
    def __init__(self, stockfish_service: StockfishService,
                 ai_service: AIService,
                 opening_db_service: OpeningDBService):
        self.stockfish_service = stockfish_service
        self.ai_service = ai_service
        self.opening_db_service = opening_db_service

    def analyze_game(self, pgn_text: str, analysis_depth: str = "standard",
                     player_color: str = "white",
                     player_name: Optional[str] = None) -> Dict[str, Any]:
        try:
            game, moves, uci_moves, positions = _parse_pgn_game_data(pgn_text)
            if game is None:
                return {"error": "Invalid PGN format"}

            opening_info = self.opening_db_service.identify_opening(moves[:12])
            engine_depth = 12 if analysis_depth == "standard" else 18
            moves_data = self.stockfish_service.analyze_game_moves(
                pgn_text, player_color, depth=engine_depth
            )
            ai_analysis = self.ai_service.analyze_game(
                pgn_text, moves_data, player_color, player_name
            )

            return {
                "metadata":   dict(game.headers),
                "moves":      moves,
                "uci_moves":  uci_moves,
                "positions":  positions,
                "opening":    opening_info,
                "moves_data": moves_data,
                "ai_analysis": ai_analysis,
            }
        except Exception as e:
            logger.error("Error in game analysis: %s", e)
            return {"error": str(e)}


# ─────────────────────────── Module-level helpers ────────────────────────────

def _parse_pgn_game_data(pgn_text: str, game_index: int = 0):
    pgn = StringIO(pgn_text)
    game = None
    for _ in range(game_index + 1):
        game = chess.pgn.read_game(pgn)
        if game is None:
            return None, [], [], []

    fen_tag = game.headers.get("FEN")
    if fen_tag and "HAha" in fen_tag:
        game.headers["FEN"] = fen_tag.replace("HAha", "KQkq")

    board = game.board()
    moves, uci_moves, positions = [], [], []
    positions.append(board.fen())

    for node in game.mainline():
        move = node.move
        try:
            moves.append(board.san(move))
            uci_moves.append(move.uci())
            board.push(move)
            positions.append(board.fen())
        except Exception as e:
            logger.warning("Skipping move %s: %s", move, e)

    return game, moves, uci_moves, positions


def count_games_in_pgn(pgn_text: str) -> int:
    pgn = StringIO(pgn_text)
    count = 0
    while chess.pgn.read_game(pgn) is not None:
        count += 1
    return count


def generate_annotated_pgn(pgn_text: str, moves_data: list) -> str:
    try:
        game = chess.pgn.read_game(StringIO(pgn_text))
        if not game:
            return pgn_text
        annotated = chess.pgn.Game()
        annotated.headers.update(game.headers)
        node = annotated
        board = game.board()
        for i, orig_node in enumerate(game.mainline()):
            move = orig_node.move
            node = node.add_variation(move)
            if i < len(moves_data):
                m = moves_data[i]
                parts = []
                clf = m.get("classification", "")
                if clf not in ("Best", "Excellent", "Good", "Accurate"):
                    parts.append(clf)
                score = m.get("score_after")
                if score is not None:
                    parts.append(f"[{score / 100:+.2f}]")
                if parts:
                    node.comment = " ".join(parts)
            board.push(move)
        return str(annotated)
    except Exception as e:
        logger.error("Error generating annotated PGN: %s", e)
        return pgn_text


def initialize_services() -> Dict[str, Any]:
    stockfish_service = StockfishService()
    ai_service = AIService()
    opening_db_service = OpeningDBService()
    game_analysis_service = GameAnalysisService(stockfish_service, ai_service, opening_db_service)
    return {
        "stockfish_service":    stockfish_service,
        "ai_service":           ai_service,
        "opening_db_service":   opening_db_service,
        "game_analysis_service": game_analysis_service,
    }


def analyze_game_in_background(pgn_text: str, analysis_depth: str,
                                services: Dict[str, Any],
                                player_color: str = "white",
                                player_name: Optional[str] = None) -> Dict[str, Any]:
    try:
        return services["game_analysis_service"].analyze_game(
            pgn_text, analysis_depth, player_color, player_name
        )
    except Exception as e:
        logger.error("Error in analyze_game_in_background: %s", e)
        return {"error": str(e)}


def add_debug_info(message: str):
    logger.info(message)


debug_info: list = []

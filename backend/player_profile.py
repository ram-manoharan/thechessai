"""
Player Profile Analysis Module
===============================
Parses a collection of PGN games for a specific player and computes rich
aggregate statistics used to generate a comprehensive GM-coach-level profile.

No Stockfish required — analysis is purely statistical + structural.
"""

from __future__ import annotations

import chess
import chess.pgn
import collections
import re
from io import StringIO
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime

import logging
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# PGN parsing helpers
# ─────────────────────────────────────────────────────────────────────────────

def parse_all_games(pgn_text: str) -> List[chess.pgn.Game]:
    """Parse every game in a (possibly multi-game) PGN string."""
    games: List[chess.pgn.Game] = []
    stream = StringIO(pgn_text)
    while True:
        try:
            game = chess.pgn.read_game(stream)
            if game is None:
                break
            games.append(game)
        except Exception:
            break
    return games


def _result_for_player(result_str: str, player_color: str) -> str:
    if result_str == "1/2-1/2":
        return "draw"
    if result_str == "1-0":
        return "win" if player_color == "white" else "loss"
    if result_str == "0-1":
        return "win" if player_color == "black" else "loss"
    return "unknown"


def _get_player_color(game: chess.pgn.Game, player_name: str) -> Optional[str]:
    """Case-insensitive substring match on White/Black headers."""
    white = game.headers.get("White", "").strip().lower()
    black = game.headers.get("Black", "").strip().lower()
    pname = player_name.strip().lower()
    if not pname:
        return None
    if pname in white:
        return "white"
    if pname in black:
        return "black"
    return None


def _get_opening_moves(game: chess.pgn.Game, n: int = 15) -> List[str]:
    board = game.board()
    moves: List[str] = []
    for i, node in enumerate(game.mainline()):
        if i >= n:
            break
        try:
            san = board.san(node.move)
            board.push(node.move)
            moves.append(san)
        except Exception:
            break
    return moves


def _count_half_moves(game: chess.pgn.Game) -> int:
    return sum(1 for _ in game.mainline())


def _game_phase(total_half_moves: int) -> str:
    """Rough phase proxy based on game length."""
    if total_half_moves <= 30:
        return "opening"
    if total_half_moves <= 70:
        return "middlegame"
    return "endgame"


def _safe_int(s: str) -> Optional[int]:
    try:
        cleaned = re.sub(r"[^\d]", "", str(s))
        return int(cleaned) if cleaned else None
    except (ValueError, TypeError):
        return None


def _safe_date(s: str) -> Optional[datetime]:
    for fmt in ("%Y.%m.%d", "%Y/%m/%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except (ValueError, TypeError):
            pass
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Per-game stat extraction
# ─────────────────────────────────────────────────────────────────────────────

def _extract_game_stats(
    game: chess.pgn.Game,
    player_name: str,
) -> Optional[Dict[str, Any]]:
    """Return a flat dict of stats for *player_name* in *game*, or None."""
    player_color = _get_player_color(game, player_name)
    if player_color is None:
        return None

    h = game.headers
    result_str = h.get("Result", "*")
    result = _result_for_player(result_str, player_color)

    elo_key  = "WhiteElo" if player_color == "white" else "BlackElo"
    opp_key  = "BlackElo" if player_color == "white" else "WhiteElo"
    player_rating = _safe_int(h.get(elo_key, ""))
    opp_rating    = _safe_int(h.get(opp_key, ""))

    eco          = h.get("ECO", "").strip() or None
    opening_name = (h.get("Opening", "").strip()
                    or h.get("Variant", "").strip()) or None

    total_hm     = _count_half_moves(game)
    opening_moves = _get_opening_moves(game, 15)
    opening_key  = " ".join(opening_moves[:6])
    phase_ended  = _game_phase(total_hm)
    date_parsed  = _safe_date(h.get("Date", ""))

    # Pawn structure / castling side (first 30 plies)
    castled_side = _detect_castling_side(game, player_color)
    # Material imbalance at end
    material_imbalance = _compute_material_imbalance(game, player_color)

    return {
        "player_color":     player_color,
        "result":           result,
        "result_str":       result_str,
        "player_rating":    player_rating,
        "opp_rating":       opp_rating,
        "eco":              eco,
        "opening_name":     opening_name,
        "opening_moves":    opening_moves,
        "opening_key":      opening_key,
        "total_half_moves": total_hm,
        "total_moves":      total_hm // 2,
        "phase_ended":      phase_ended,
        "time_control":     h.get("TimeControl", "?").strip(),
        "event":            h.get("Event", "").strip(),
        "date":             h.get("Date", "").strip(),
        "date_parsed":      date_parsed,
        "white_name":       h.get("White", "?"),
        "black_name":       h.get("Black", "?"),
        "castled_side":     castled_side,
        "material_imbalance": material_imbalance,
    }


def _detect_castling_side(game: chess.pgn.Game, player_color: str) -> Optional[str]:
    """Detect whether the player castled kingside, queenside, or not."""
    board = game.board()
    color = chess.WHITE if player_color == "white" else chess.BLACK
    for node in game.mainline():
        try:
            move = node.move
            if board.is_castling(move):
                if board.turn == color:
                    if board.is_kingside_castling(move):
                        return "kingside"
                    return "queenside"
            board.push(move)
        except Exception:
            break
    return "none"


def _compute_material_imbalance(game: chess.pgn.Game, player_color: str) -> int:
    """Material advantage (positive = player ahead) at game end. Quick heuristic."""
    piece_values = {
        chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
        chess.ROOK: 5, chess.QUEEN: 9,
    }
    board = game.board()
    try:
        for node in game.mainline():
            board.push(node.move)
    except Exception:
        pass

    color = chess.WHITE if player_color == "white" else chess.BLACK
    my_mat  = sum(piece_values.get(p.piece_type, 0)
                  for p in board.piece_map().values() if p.color == color)
    opp_mat = sum(piece_values.get(p.piece_type, 0)
                  for p in board.piece_map().values() if p.color != color)
    return my_mat - opp_mat


# ─────────────────────────────────────────────────────────────────────────────
# Aggregate statistics
# ─────────────────────────────────────────────────────────────────────────────

def _pct(num: int | float, den: int | float) -> float:
    return round(100.0 * num / den, 1) if den else 0.0


def _record(games_list: List[Dict]) -> Dict[str, Any]:
    total = len(games_list)
    wins   = sum(1 for g in games_list if g["result"] == "win")
    draws  = sum(1 for g in games_list if g["result"] == "draw")
    losses = sum(1 for g in games_list if g["result"] == "loss")
    return {
        "games":     total,
        "wins":      wins,
        "draws":     draws,
        "losses":    losses,
        "win_pct":   _pct(wins, total),
        "score_pct": _pct(wins + draws * 0.5, total),
    }


def _build_opening_table(games_list: List[Dict]) -> List[Dict[str, Any]]:
    """Group games by opening key and compute W/D/L records."""
    groups: Dict[str, Dict] = {}
    for g in games_list:
        eco  = g.get("eco") or ""
        oname = g.get("opening_name") or ""
        key  = eco or g["opening_key"] or "Unknown"
        label = oname or eco or g["opening_key"] or "Unknown"
        if key not in groups:
            groups[key] = {
                "eco":          eco,
                "name":         label,
                "games":        0,
                "wins":         0,
                "draws":        0,
                "losses":       0,
                "sample_moves": g["opening_moves"][:10],
            }
        groups[key]["games"] += 1
        r = g["result"]
        if r == "win":
            groups[key]["wins"] += 1
        elif r == "draw":
            groups[key]["draws"] += 1
        elif r == "loss":
            groups[key]["losses"] += 1

    rows = []
    for v in groups.values():
        n = v["games"]
        v["win_pct"]   = _pct(v["wins"], n)
        v["score_pct"] = _pct(v["wins"] + v["draws"] * 0.5, n)
        rows.append(v)

    return sorted(rows, key=lambda x: -x["games"])


def aggregate_player_stats(game_stats: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate per-game stats into a complete player profile dict."""
    if not game_stats:
        return {}

    total  = len(game_stats)
    wins   = sum(1 for g in game_stats if g["result"] == "win")
    draws  = sum(1 for g in game_stats if g["result"] == "draw")
    losses = sum(1 for g in game_stats if g["result"] == "loss")

    white_games = [g for g in game_stats if g["player_color"] == "white"]
    black_games = [g for g in game_stats if g["player_color"] == "black"]

    # Rating
    rated  = [g for g in game_stats if g["player_rating"] is not None]
    rtgs   = [g["player_rating"] for g in rated]
    avg_r  = round(sum(rtgs) / len(rtgs)) if rtgs else None
    peak_r = max(rtgs) if rtgs else None
    min_r  = min(rtgs) if rtgs else None

    # Chronological rating trend (last 30 data points)
    dated  = sorted(
        [(g["date_parsed"], g["player_rating"]) for g in rated if g["date_parsed"]],
        key=lambda x: x[0],
    )
    rating_trend = [(d.strftime("%Y-%m"), r) for d, r in dated[-30:]]

    # Date range
    dates = [g["date_parsed"] for g in game_stats if g["date_parsed"]]
    dates.sort()

    # Opposition strength
    opp_rated = [g for g in game_stats
                 if g["opp_rating"] is not None and g["player_rating"] is not None]
    stronger  = [g for g in opp_rated if g["opp_rating"] > g["player_rating"] + 50]
    equal_opp = [g for g in opp_rated if abs(g["opp_rating"] - g["player_rating"]) <= 50]
    weaker    = [g for g in opp_rated if g["opp_rating"] < g["player_rating"] - 50]

    # Game length buckets
    short_g  = [g for g in game_stats if g["total_moves"] < 25]
    medium_g = [g for g in game_stats if 25 <= g["total_moves"] < 50]
    long_g   = [g for g in game_stats if g["total_moves"] >= 50]
    lengths  = [g["total_moves"] for g in game_stats]
    avg_len  = round(sum(lengths) / len(lengths), 1) if lengths else 0

    # Phase-ended breakdown
    op_games = [g for g in game_stats if g["phase_ended"] == "opening"]
    mg_games = [g for g in game_stats if g["phase_ended"] == "middlegame"]
    eg_games = [g for g in game_stats if g["phase_ended"] == "endgame"]

    # Castling preferences
    castle_counts = collections.Counter(g.get("castled_side") for g in game_stats)

    # Time controls
    tc_counts = collections.Counter(g.get("time_control", "?") for g in game_stats)

    # Material balance distribution at game end
    mi_wins  = [g["material_imbalance"] for g in game_stats if g["result"] == "win"]
    mi_loss  = [g["material_imbalance"] for g in game_stats if g["result"] == "loss"]
    avg_mi_win  = round(sum(mi_wins)  / len(mi_wins),  1) if mi_wins  else None
    avg_mi_loss = round(sum(mi_loss)  / len(mi_loss),  1) if mi_loss  else None

    return {
        "total_games": total,
        "overall": {
            "wins":      wins,
            "draws":     draws,
            "losses":    losses,
            "win_pct":   _pct(wins, total),
            "draw_pct":  _pct(draws, total),
            "loss_pct":  _pct(losses, total),
            "score_pct": _pct(wins + draws * 0.5, total),
        },
        "by_color": {
            "white": _record(white_games),
            "black": _record(black_games),
        },
        "rating": {
            "average": avg_r,
            "peak":    peak_r,
            "minimum": min_r,
            "trend":   rating_trend,
            "rated_games": len(rated),
        },
        "date_range": {
            "first": dates[0].strftime("%Y-%m-%d")  if dates else "?",
            "last":  dates[-1].strftime("%Y-%m-%d") if dates else "?",
        },
        "vs_opposition": {
            "stronger": _record(stronger),
            "equal":    _record(equal_opp),
            "weaker":   _record(weaker),
        },
        "openings": {
            "as_white": _build_opening_table(white_games)[:12],
            "as_black": _build_opening_table(black_games)[:12],
        },
        "game_length": {
            "average_moves": avg_len,
            "short":  _record(short_g),
            "medium": _record(medium_g),
            "long":   _record(long_g),
        },
        "phase_ended": {
            "opening":    _record(op_games),
            "middlegame": _record(mg_games),
            "endgame":    _record(eg_games),
        },
        "castling": dict(castle_counts),
        "time_controls": dict(tc_counts.most_common(6)),
        "material": {
            "avg_advantage_in_wins":  avg_mi_win,
            "avg_advantage_in_losses": avg_mi_loss,
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────────────

def detect_player_name(games: List[chess.pgn.Game]) -> str:
    """Return the most frequently occurring player name across all games."""
    counter: collections.Counter = collections.Counter()
    for game in games:
        for key in ("White", "Black"):
            name = game.headers.get(key, "").strip()
            if name and name not in ("?", ""):
                counter[name] += 1
    return counter.most_common(1)[0][0] if counter else "Unknown"


def analyze_player_games(
    pgn_text: str,
    player_name: str = "",
) -> Tuple[Dict[str, Any], str, int, int]:
    """
    Main entry point.

    Parameters
    ----------
    pgn_text   : raw PGN string (single or multi-game)
    player_name: target player (auto-detected if empty)

    Returns
    -------
    (aggregate_stats, resolved_player_name, total_games_parsed, games_matched)
    """
    games = parse_all_games(pgn_text)
    if not games:
        return {}, player_name or "Unknown", 0, 0

    if not player_name:
        player_name = detect_player_name(games)

    per_game: List[Dict[str, Any]] = []
    for game in games:
        stats = _extract_game_stats(game, player_name)
        if stats:
            per_game.append(stats)

    if not per_game:
        return {}, player_name, len(games), 0

    agg = aggregate_player_stats(per_game)
    agg["player_name"]    = player_name
    agg["games_parsed"]   = len(games)
    agg["games_matched"]  = len(per_game)

    return agg, player_name, len(games), len(per_game)


# ─────────────────────────────────────────────────────────────────────────────
# Formatting helpers (used by AI prompt builder in ai_service.py)
# ─────────────────────────────────────────────────────────────────────────────

def format_stats_for_prompt(stats: Dict[str, Any]) -> str:
    """Serialise aggregate stats into a compact, structured text block."""
    lines: List[str] = []
    pname = stats.get("player_name", "Player")

    lines.append(f"=== PLAYER PROFILE DATA FOR: {pname.upper()} ===")
    lines.append(f"Games analysed: {stats.get('games_matched', 0)} "
                 f"(parsed: {stats.get('games_parsed', 0)})")
    dr = stats.get("date_range", {})
    lines.append(f"Date range: {dr.get('first', '?')} → {dr.get('last', '?')}")

    # Rating
    r = stats.get("rating", {})
    if r.get("average"):
        lines.append(f"\n--- RATING ---")
        lines.append(f"Average: {r['average']}  |  Peak: {r['peak']}  |  "
                     f"Min: {r['minimum']}  |  Rated games: {r.get('rated_games', '?')}")
        if r.get("trend"):
            first = r["trend"][0]
            last  = r["trend"][-1]
            delta = last[1] - first[1]
            sign  = "+" if delta >= 0 else ""
            lines.append(f"Rating trend ({first[0]} → {last[0]}): {sign}{delta} pts")

    # Overall performance
    ov = stats.get("overall", {})
    lines.append(f"\n--- OVERALL RESULTS ({stats.get('total_games', 0)} games) ---")
    lines.append(f"Wins: {ov.get('wins')} ({ov.get('win_pct')}%)  "
                 f"Draws: {ov.get('draws')} ({ov.get('draw_pct')}%)  "
                 f"Losses: {ov.get('losses')} ({ov.get('loss_pct')}%)")
    lines.append(f"Overall score: {ov.get('score_pct')}%")

    # By colour
    bc = stats.get("by_color", {})
    w  = bc.get("white", {})
    b  = bc.get("black", {})
    lines.append(f"\n--- PERFORMANCE BY COLOUR ---")
    if w.get("games"):
        lines.append(f"As White ({w['games']} games): "
                     f"{w['wins']}W/{w['draws']}D/{w['losses']}L  "
                     f"Score {w['score_pct']}%  Win% {w['win_pct']}%")
    if b.get("games"):
        lines.append(f"As Black ({b['games']} games): "
                     f"{b['wins']}W/{b['draws']}D/{b['losses']}L  "
                     f"Score {b['score_pct']}%  Win% {b['win_pct']}%")

    # Opposition
    vo = stats.get("vs_opposition", {})
    lines.append(f"\n--- PERFORMANCE VS OPPOSITION ---")
    for label, key in [("Stronger (>50 rating pts)", "stronger"),
                       ("Equal (±50 pts)", "equal"),
                       ("Weaker (>50 below)", "weaker")]:
        rec = vo.get(key, {})
        if rec.get("games"):
            lines.append(f"{label}: {rec['games']} games | "
                         f"Score {rec['score_pct']}% | Win% {rec['win_pct']}%")

    # Opening repertoire
    op = stats.get("openings", {})
    aw = op.get("as_white", [])
    ab = op.get("as_black", [])
    lines.append(f"\n--- OPENING REPERTOIRE (AS WHITE) ---")
    for o in aw[:8]:
        lines.append(f"  [{o['eco'] or 'N/A'}] {o['name'][:40]:40s} | "
                     f"{o['games']:3d}g | {o['wins']}W/{o['draws']}D/{o['losses']}L | "
                     f"Score {o['score_pct']}%")
    lines.append(f"\n--- OPENING REPERTOIRE (AS BLACK) ---")
    for o in ab[:8]:
        lines.append(f"  [{o['eco'] or 'N/A'}] {o['name'][:40]:40s} | "
                     f"{o['games']:3d}g | {o['wins']}W/{o['draws']}D/{o['losses']}L | "
                     f"Score {o['score_pct']}%")

    # Game length
    gl = stats.get("game_length", {})
    lines.append(f"\n--- GAME LENGTH ANALYSIS ---")
    lines.append(f"Average game length: {gl.get('average_moves', '?')} moves")
    for label, key in [("Short (<25 moves)", "short"),
                       ("Medium (25-49 moves)", "medium"),
                       ("Long (50+ moves)", "long")]:
        rec = gl.get(key, {})
        if rec.get("games"):
            lines.append(f"  {label}: {rec['games']} games | "
                         f"Score {rec['score_pct']}% | Win% {rec['win_pct']}%")

    # Phase-ended breakdown
    pe = stats.get("phase_ended", {})
    lines.append(f"\n--- WHERE GAMES ENDED (PHASE PROXY) ---")
    for phase in ("opening", "middlegame", "endgame"):
        rec = pe.get(phase, {})
        if rec.get("games"):
            lines.append(f"  Games decided in {phase.capitalize()}: {rec['games']} | "
                         f"Score {rec['score_pct']}% | Win% {rec['win_pct']}%")

    # Castling
    castle = stats.get("castling", {})
    if castle:
        lines.append(f"\n--- CASTLING PREFERENCES ---")
        total_c = sum(castle.values())
        for side, cnt in sorted(castle.items(), key=lambda x: -x[1]):
            if side and cnt:
                lines.append(f"  {side.capitalize() if side else 'None'}: "
                              f"{cnt} ({_pct(cnt, total_c)}%)")

    # Material
    mat = stats.get("material", {})
    if mat.get("avg_advantage_in_wins") is not None or mat.get("avg_advantage_in_losses") is not None:
        lines.append(f"\n--- MATERIAL BALANCE AT GAME END ---")
        if mat.get("avg_advantage_in_wins") is not None:
            lines.append(f"  Avg material advantage in WINS:   {mat['avg_advantage_in_wins']:+.1f} pawns")
        if mat.get("avg_advantage_in_losses") is not None:
            lines.append(f"  Avg material advantage in LOSSES: {mat['avg_advantage_in_losses']:+.1f} pawns")

    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Multi-game puzzle collector (uses StockfishService.collect_game_puzzles)
# ─────────────────────────────────────────────────────────────────────────────

def collect_profile_puzzles(
    games: List[chess.pgn.Game],
    player_name: str,
    stockfish_service,
    max_games: int = 30,
    depth: int = 10,
    min_cp_loss: int = 75,
    max_puzzles_per_game: int = 5,
    progress_callback=None,
) -> List[Dict[str, Any]]:
    """
    Run StockfishService.collect_game_puzzles() over a sample of games for
    *player_name*, returning a flat list of puzzle dicts.

    Parameters
    ----------
    games            : parsed chess.pgn.Game objects (output of parse_all_games)
    player_name      : used to determine color in each game
    stockfish_service: a StockfishService instance (must have .available == True)
    max_games        : cap on how many games to analyse (most-recent first)
    depth            : Stockfish depth per position (10 is fast & strong enough)
    min_cp_loss      : minimum centipawn loss to classify as a puzzle
    max_puzzles_per_game : cap per game so no single game dominates
    progress_callback: optional callable(current_game, total_games)
    """
    sampled = games[:max_games]
    total   = len(sampled)
    all_puzzles: List[Dict[str, Any]] = []

    for i, game in enumerate(sampled):
        if progress_callback:
            try:
                progress_callback(i + 1, total)
            except Exception:
                pass

        color = _get_player_color(game, player_name)
        if color is None:
            continue

        # Re-export game to a PGN string for collect_game_puzzles
        from io import StringIO as _SIO
        buf = _SIO()
        exporter = chess.pgn.FileExporter(buf)
        game.accept(exporter)
        pgn_str = buf.getvalue()

        try:
            puzzles = stockfish_service.collect_game_puzzles(
                pgn_str,
                color,
                depth=depth,
                min_cp_loss=min_cp_loss,
                max_puzzles_per_game=max_puzzles_per_game,
            )
            all_puzzles.extend(puzzles)
        except Exception as exc:
            logger.warning("Puzzle collection failed for game %d: %s", i + 1, exc)

    return all_puzzles

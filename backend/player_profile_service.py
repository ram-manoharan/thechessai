import io
import math
import chess
import chess.pgn
import chess.engine
import os
from collections import defaultdict
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

load_dotenv()

# Shared opening DB (no Stockfish needed)
_opening_db = None

def _get_opening_db():
    global _opening_db
    if _opening_db is None:
        from chess_analysis import OpeningDBService
        _opening_db = OpeningDBService()
    return _opening_db


def _estimate_elo_from_cp(avg_cp_loss: float) -> int:
    """Empirical ELO estimate from average centipawn loss per player move.
    Calibrated against Lichess accuracy data (Stockfish depth 10-12).
    """
    if avg_cp_loss <= 0:
        return 2800
    elo = 2850.0 * math.exp(-0.018 * avg_cp_loss)
    return max(400, min(2800, round(elo / 25) * 25))

PHASE_OPENING    = "Opening"
PHASE_MIDDLEGAME = "Middlegame"
PHASE_ENDGAME    = "Endgame"

OPENING_THEORY_CUTOFF = 12


def _win_prob_profile(cp: int) -> float:
    cp_c = max(-2000, min(2000, cp))
    return 1.0 / (1.0 + math.exp(-0.00368208 * cp_c))


def _classify_move_profile(score_before: int, score_after: int, is_white: bool):
    """Win-probability–based classification for profile service. Returns (classification, cp_loss)."""
    sb = max(-9900, min(9900, score_before))
    sa = max(-9900, min(9900, score_after))

    if is_white:
        wp_before = _win_prob_profile(sb)
        wp_after  = _win_prob_profile(sa)
        cp_loss   = sb - sa
    else:
        wp_before = 1.0 - _win_prob_profile(sb)
        wp_after  = 1.0 - _win_prob_profile(sa)
        cp_loss   = sa - sb

    wp_change_pct = (wp_after - wp_before) * 100.0
    wp_drop_pct   = max(0.0, -wp_change_pct)

    if wp_change_pct >= 5.0 and wp_before < 0.85:
        return "Strong", round(cp_loss)
    if wp_drop_pct < 5:
        return "Accurate", round(cp_loss)
    if wp_drop_pct < 10:
        return "Inaccuracy", round(cp_loss)
    if wp_drop_pct < 20:
        return "Mistake", round(cp_loss)
    return "Blunder", round(cp_loss)


def _get_phase_material(board: chess.Board, move_number: int) -> str:
    if move_number <= 10:
        return PHASE_OPENING
    pvals = {chess.QUEEN: 9, chess.ROOK: 5, chess.BISHOP: 3, chess.KNIGHT: 3}
    total = sum(
        pvals[pt] * (len(board.pieces(pt, chess.WHITE)) + len(board.pieces(pt, chess.BLACK)))
        for pt in pvals
    )
    queens = (len(board.pieces(chess.QUEEN, chess.WHITE))
              + len(board.pieces(chess.QUEEN, chess.BLACK)))
    if total <= 20 or (queens == 0 and total <= 30):
        return PHASE_ENDGAME
    if move_number <= 15 and total >= 50:
        return PHASE_OPENING
    if move_number > 35:
        return PHASE_ENDGAME
    return PHASE_MIDDLEGAME


# ── ELO tier lookup — deterministic resource recommendations ──────────────────

_ELO_TIERS = [
    (0,    800,  "Absolute beginner",          "beginner"),
    (800,  1000, "Beginner",                   "beginner"),
    (1000, 1200, "Club beginner",              "beginner"),
    (1200, 1400, "Intermediate club player",   "intermediate"),
    (1400, 1600, "Advanced club player",       "advanced_club"),
    (1600, 1800, "Strong club player",         "strong_club"),
    (1800, 2000, "Expert / Class A",           "expert"),
    (2000, 2200, "Candidate Master territory", "cm"),
    (2200, 9999, "Master+ level",              "master"),
]

_RESOURCES = {
    "beginner": {
        "tactics":  "Chess Tactics for Students by John Bain",
        "endgame":  "Silman's Complete Endgame Course (Chapters 1-4) by Jeremy Silman",
        "opening":  "Chess Openings for Beginners by Eric Rosen (YouTube series)",
        "strategy": "Chess Fundamentals by José Raúl Capablanca",
        "games":    "Logical Chess Move by Move by Irving Chernev",
        "mental":   "The Improving Chess Thinker by Dan Heisman",
    },
    "intermediate": {
        "tactics":  "1001 Chess Exercises for Beginners by Franco Masetti & Roberto Messa",
        "endgame":  "Silman's Complete Endgame Course (Chapters 4-7) by Jeremy Silman",
        "opening":  "Winning Chess Openings by Yasser Seirawan",
        "strategy": "Simple Chess by Michael Stean",
        "games":    "My System by Aron Nimzowitsch (Part 1)",
        "mental":   "The Improving Chess Thinker by Dan Heisman",
    },
    "advanced_club": {
        "tactics":  "Chess Tactics for Advanced Players by Yuri Averbakh",
        "endgame":  "Pandolfini's Endgame Course by Bruce Pandolfini",
        "opening":  "Starting Out series (Everyman Chess) for each repertoire opening",
        "strategy": "How to Reassess Your Chess by Jeremy Silman",
        "games":    "Zurich International Chess Tournament 1953 by David Bronstein",
        "mental":   "Practical Chess Psychology by Amatzia Avni",
    },
    "strong_club": {
        "tactics":  "Combinational Motifs by Maxim Blokh (CT-ART levels 10-40)",
        "endgame":  "100 Endgames You Must Know by Jesús de la Villa",
        "opening":  "Grandmaster Repertoire series (Quality Chess) — beginner volumes",
        "strategy": "Secrets of Modern Chess Strategy by John Watson",
        "games":    "My 60 Memorable Games by Bobby Fischer",
        "mental":   "Stress of Chess by Walter Browne",
    },
    "expert": {
        "tactics":  "Dvoretsky's Tactics for Advanced Players by Mark Dvoretsky",
        "endgame":  "Dvoretsky's Endgame Manual by Mark Dvoretsky (Chapters 1-5)",
        "opening":  "Grandmaster Repertoire series (Quality Chess) — main-line volumes",
        "strategy": "Positional Decision Making in Chess by Boris Gelfand",
        "games":    "Kasparov on My Great Predecessors Vol. 1 by Garry Kasparov",
        "mental":   "Think Like a Grandmaster by Alexander Kotov",
    },
    "cm": {
        "tactics":  "Dvoretsky's Tactics for Advanced Players + engine-generated puzzles from own blunders",
        "endgame":  "Dvoretsky's Endgame Manual by Mark Dvoretsky (full text)",
        "opening":  "Grandmaster Repertoire (Quality Chess) + custom novelty preparation with engine",
        "strategy": "Mastering Complex Endgames by Mark Dvoretsky",
        "games":    "Kasparov on My Great Predecessors (all volumes) by Garry Kasparov",
        "mental":   "Pump Up Your Rating by Axel Smith",
    },
    "master": {
        "tactics":  "Custom engine-generated puzzles from own game errors + Deep analysis sessions",
        "endgame":  "Dvoretsky's Endgame Manual + Endgame Technique by Shereshevsky",
        "opening":  "Engine-verified novelty preparation in main repertoire lines",
        "strategy": "Positional Decision Making in Chess by Boris Gelfand",
        "games":    "Engine-annotated games of top players in player's specific opening lines",
        "mental":   "Pump Up Your Rating by Axel Smith + structured tournament preparation",
    },
}

# Deterministic weekly schedule templates keyed by (weakest_phase, second_weakest_phase)
_SCHEDULE_TEMPLATES = {
    "Opening": [
        ("MON", "Opening",   "Study theory lines for top 2 White openings using repertoire book",   60),
        ("TUE", "Tactics",   "Solve 20 puzzles focused on tactical patterns from opening phase",     60),
        ("WED", "Opening",   "Analyse own games where theory exit was before move 12 — find gaps",  90),
        ("THU", "Endgame",   "Study fundamental king & pawn endings from resource book",             60),
        ("FRI", "Middlegame","Review 5 master games in your main opening line to learn pawn plans",  60),
        ("SAT", "Game play", "Play 3 slow games (≥15+10) focusing on reaching familiar structures", 90),
        ("SUN", "Review",    "Annotate one of Saturday's games; identify where prep ended",          60),
    ],
    "Middlegame": [
        ("MON", "Tactics",    "Solve 20 puzzles (pin, fork, skewer, discovered attack themes)",      60),
        ("TUE", "Middlegame", "Study pawn structure plans from strategy resource book",               60),
        ("WED", "Tactics",    "Solve 20 calculation puzzles — minimum 3 moves deep",                 60),
        ("THU", "Endgame",    "Study king & pawn endings + rook endings fundamentals",                60),
        ("FRI", "Middlegame", "Review 5 master games focusing on piece coordination in middlegame",   90),
        ("SAT", "Game play",  "Play 3 slow games; after each, analyse moves 15-30 with engine",      90),
        ("SUN", "Review",     "Study own worst middlegame blunder from recent games with engine",     60),
    ],
    "Endgame": [
        ("MON", "Endgame",   "Study endgame resource book — Lucena and Philidor rook positions",      60),
        ("TUE", "Tactics",   "Solve 20 endgame-specific puzzles (zugzwang, pawn promotion, K&P)",    60),
        ("WED", "Endgame",   "Practice rook endings vs Stockfish at reduced strength (set ELO-100)", 60),
        ("THU", "Opening",   "Review theory in top 2 White openings to avoid opening blunders",      60),
        ("FRI", "Endgame",   "Study 5 annotated master endgames from same opening structures",        90),
        ("SAT", "Game play", "Play 3 slow games; accept piece trades to reach technical endings",     90),
        ("SUN", "Review",    "Analyse Saturday endgames with Stockfish — find the winning plans",     60),
    ],
}


def _elo_tier(elo: int):
    """Return (label, tier_key) for a given ELO."""
    for lo, hi, label, key in _ELO_TIERS:
        if lo <= elo < hi:
            return label, key
    return "Unknown", "intermediate"


def compute_profile_facts(stats: Dict) -> Dict:
    """
    Compute ALL analytical conclusions deterministically from engine stats.
    Returns a dict that the LLM must reproduce verbatim — no re-analysis permitted.
    """
    elo = int(stats.get("display_elo") or stats.get("estimated_elo") or 0)
    elo_source = stats.get("elo_source", "cp_loss_model")
    elo_source_label = "PGN-rated" if elo_source == "pgn_headers" else "CP-loss model"
    tier_label, tier_key = _elo_tier(elo)
    resources = _RESOURCES.get(tier_key, _RESOURCES["intermediate"])

    # Phase ranking — deterministic sort
    phase_err = stats.get("phase_error_rate", {})
    phase_stats = stats.get("phase_stats", {})
    phases_sorted = sorted(phase_err.items(), key=lambda x: x[1], reverse=True)
    weakest_phase = phases_sorted[0][0] if phases_sorted else "Unknown"
    strongest_phase = phases_sorted[-1][0] if phases_sorted else "Unknown"

    # Blunder phase distribution
    bd = stats.get("blunder_by_phase", {})
    total_blunders = sum(bd.values()) or 1
    blunder_pct = {k: round(v / total_blunders * 100) for k, v in bd.items()}
    worst_blunder_phase = max(bd, key=bd.get) if bd else weakest_phase

    # Move range worst bucket
    mra = stats.get("move_range_accuracy", {})
    mra_valid = {k: v for k, v in mra.items() if v is not None and isinstance(v, (int, float))}
    worst_range_name  = max(mra_valid, key=mra_valid.get) if mra_valid else "Unknown"
    best_range_name   = min(mra_valid, key=mra_valid.get) if mra_valid else "Unknown"
    worst_range_val   = mra_valid.get(worst_range_name, 0)
    best_range_val    = mra_valid.get(best_range_name, 0)
    _range_labels = {"1-15": "Early game (moves 1-15)", "16-30": "Middlegame (moves 16-30)",
                     "31-50": "Late middlegame (moves 31-50)", "50+": "Endgame (moves 50+)"}

    # Conversion verdict
    squander = stats.get("squander_rate", 0) or 0
    conv_rate = stats.get("conversion_rate", 0) or 0
    if squander >= 40:
        conversion_verdict = "CRITICAL — primary Elo limiter; winning positions routinely squandered"
    elif squander >= 20:
        conversion_verdict = "CONCERN — improvement in converting advantages will boost Elo significantly"
    else:
        conversion_verdict = "ACCEPTABLE — converting winning advantages at a reasonable rate"

    # Estimated Elo loss from squandering (25-40 Elo per 10% squander)
    elo_loss_from_squander = round(squander / 10 * 32)  # 32 Elo per 10%

    # Color verdict
    w_pct = stats.get("white_score_pct", 50) or 50
    b_pct = stats.get("black_score_pct", 50) or 50
    color_diff = abs(w_pct - b_pct)
    better_color = "White" if w_pct >= b_pct else "Black"
    worse_color  = "Black" if w_pct >= b_pct else "White"
    if color_diff >= 15:
        color_verdict = f"SIGNIFICANT IMBALANCE — {better_color} ({w_pct}%) vs {worse_color} ({b_pct}%); {worse_color} repertoire needs urgent attention"
    elif color_diff >= 7:
        color_verdict = f"MINOR IMBALANCE — {better_color} ({w_pct}%) marginally better than {worse_color} ({b_pct}%); monitor"
    else:
        color_verdict = f"BALANCED — White {w_pct}% vs Black {b_pct}%; no major colour preference detected"

    # Deterministic ELO milestones
    phase1_elo = elo + 100
    phase2_elo = elo + 225
    phase3_elo = elo + 400

    # Weekly schedule (deterministic by weakest phase)
    schedule = _SCHEDULE_TEMPLATES.get(weakest_phase, _SCHEDULE_TEMPLATES["Middlegame"])

    # Phase error rates as readable text
    phase_summary_lines = []
    for phase, err_rate in phases_sorted:
        pc = phase_stats.get(phase, {})
        total_ph = sum(pc.values()) or 1
        blunders = pc.get("Blunder", 0)
        mistakes = pc.get("Mistake", 0)
        strong   = pc.get("Strong", 0) + pc.get("Accurate", 0)
        label = "◀ WEAKEST" if phase == weakest_phase else ("◀ STRONGEST" if phase == strongest_phase else "")
        phase_summary_lines.append(
            f"  {phase}: error rate {round(err_rate*100,1)}%, "
            f"{blunders} blunders, {mistakes} mistakes, "
            f"{round(strong/total_ph*100,1)}% precise moves  {label}"
        )

    return {
        "elo": elo,
        "elo_source_label": elo_source_label,
        "tier_label": tier_label,
        "tier_key": tier_key,
        "weakest_phase": weakest_phase,
        "strongest_phase": strongest_phase,
        "phases_sorted": phases_sorted,
        "phase_summary_lines": phase_summary_lines,
        "worst_blunder_phase": worst_blunder_phase,
        "blunder_pct": blunder_pct,
        "worst_range_name": _range_labels.get(worst_range_name, worst_range_name),
        "worst_range_val": worst_range_val,
        "best_range_name": _range_labels.get(best_range_name, best_range_name),
        "best_range_val": best_range_val,
        "conversion_verdict": conversion_verdict,
        "squander_rate": squander,
        "conv_rate": conv_rate,
        "elo_loss_from_squander": elo_loss_from_squander,
        "color_verdict": color_verdict,
        "phase1_elo": phase1_elo,
        "phase2_elo": phase2_elo,
        "phase3_elo": phase3_elo,
        "resources": resources,
        "schedule": schedule,
    }


class PlayerProfileService:

    def __init__(self, stockfish_path: Optional[str] = None):
        candidates = []
        if stockfish_path:
            candidates.append(stockfish_path)
        candidates += [
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "stockfish_14_x64_popcnt"),
            "/usr/local/bin/stockfish",
            "/usr/bin/stockfish",
            "stockfish",
        ]

        self.engine = None
        self.engine_available = False
        for path in candidates:
            try:
                os.chmod(path, 0o755)
                self.engine = chess.engine.SimpleEngine.popen_uci(path)
                self.engine.configure({"Threads": 2, "Hash": 128})
                self.engine_available = True
                break
            except Exception:
                continue

        self._opening_db = _get_opening_db()

    # ── Parsing ──────────────────────────────────────────────────────────────

    def parse_games(self, pgn_text: str, player_name: str) -> List[Dict]:
        """Parse all games from a multi-game PGN. Returns list of game dicts."""
        games = []
        pgn_io = io.StringIO(pgn_text)

        while True:
            game = chess.pgn.read_game(pgn_io)
            if game is None:
                break

            headers = dict(game.headers)
            white = headers.get("White", "").strip()
            black = headers.get("Black", "").strip()

            player_name_lower = player_name.lower()
            if player_name_lower in white.lower():
                color = chess.WHITE
                color_str = "White"
            elif player_name_lower in black.lower():
                color = chess.BLACK
                color_str = "Black"
            else:
                color = chess.WHITE
                color_str = "White"

            result = headers.get("Result", "*")
            if result == "1-0":
                outcome = "win" if color == chess.WHITE else "loss"
            elif result == "0-1":
                outcome = "win" if color == chess.BLACK else "loss"
            elif result == "1/2-1/2":
                outcome = "draw"
            else:
                outcome = "unknown"

            eco = headers.get("ECO", "")
            opening_name = headers.get("Opening", headers.get("Variant", ""))

            moves_san = []
            board = game.board()
            for node in game.mainline():
                moves_san.append(board.san(node.move))
                board.push(node.move)

            # Detect opening from moves when headers don't provide it
            if not opening_name or opening_name.lower() in ("?", "unknown", "unknown opening"):
                detected = self._opening_db.identify_opening(moves_san[:12])
                opening_name = detected["name"]
                if not eco:
                    eco = detected["eco"]
            elif not eco:
                detected = self._opening_db.identify_opening(moves_san[:12])
                eco = detected["eco"]

            # Read ELO from PGN headers
            try:
                elo = int(headers.get("WhiteElo" if color == chess.WHITE else "BlackElo", 0) or 0)
            except (ValueError, TypeError):
                elo = 0

            games.append({
                "game": game,
                "headers": headers,
                "color": color,
                "color_str": color_str,
                "outcome": outcome,
                "eco": eco,
                "opening_name": opening_name,
                "moves_san": moves_san,
                "num_moves": len(moves_san),
                "elo": elo,
            })

        return games

    # ── Per-game Stockfish analysis ──────────────────────────────────────────

    def analyze_game_moves(self, game_dict: Dict, depth: int = 12) -> List[Dict]:
        """Run Stockfish on every move. Uses pipelining (N+1 calls for N moves)."""
        if not self.engine_available:
            return []

        game         = game_dict["game"]
        player_color = game_dict["color"]
        board        = game.board()
        moves_data   = []

        # Pipeline: analyse starting position once, reuse post-move analysis as next pre-move
        info = self.engine.analyse(board, chess.engine.Limit(depth=depth))
        score_before  = info["score"].white().score(mate_score=10000)
        best_move_obj = info.get("pv", [None])[0]

        for move_num, node in enumerate(game.mainline(), start=1):
            move          = node.move
            san           = board.san(move)
            is_white      = (board.turn == chess.WHITE)
            best_san      = board.san(best_move_obj) if best_move_obj else "N/A"
            best_move_uci = str(best_move_obj) if best_move_obj else ""
            fen_before    = board.fen()
            full_move_num = (move_num + 1) // 2
            move_color    = chess.WHITE if move_num % 2 == 1 else chess.BLACK
            is_player_move = (move_color == player_color)

            board.push(move)

            info = self.engine.analyse(board, chess.engine.Limit(depth=depth))
            score_after   = info["score"].white().score(mate_score=10000)
            best_move_obj = info.get("pv", [None])[0]

            if score_before is not None and score_after is not None:
                classification, cp_loss = _classify_move_profile(score_before, score_after, is_white)
            else:
                classification, cp_loss = "Accurate", 0

            # Positional context: use the moving player's advantage before the move
            if score_before is not None:
                adv = score_before if is_white else -score_before
                if adv > 150:
                    pos_context = "winning"
                elif adv < -150:
                    pos_context = "losing"
                else:
                    pos_context = "equal"
            else:
                pos_context = "unknown"

            moves_data.append({
                "move_number":   full_move_num,
                "san":           san,
                "best_san":      best_san,
                "best_move_uci": best_move_uci,
                "fen":           fen_before,
                "cp_loss":       cp_loss,
                "score_before":  score_before,
                "score_after":   score_after,
                "classification": classification,
                "is_player_move": is_player_move,
                "phase":         _get_phase_material(board, full_move_num),
                "pos_context":   pos_context,
                "is_theory_zone": full_move_num <= OPENING_THEORY_CUTOFF,
            })

            score_before = score_after

        return moves_data

    # ── Aggregate statistics ─────────────────────────────────────────────────

    def aggregate_stats(self, games: List[Dict], all_moves: List[List[Dict]], player_name: str) -> Dict:
        """Aggregate statistics across all analyzed games."""
        total = len(games)
        wins   = sum(1 for g in games if g["outcome"] == "win")
        losses = sum(1 for g in games if g["outcome"] == "loss")
        draws  = sum(1 for g in games if g["outcome"] == "draw")

        as_white = [g for g in games if g["color"] == chess.WHITE]
        as_black = [g for g in games if g["color"] == chess.BLACK]
        white_wins  = sum(1 for g in as_white if g["outcome"] == "win")
        white_draws = sum(1 for g in as_white if g["outcome"] == "draw")
        black_wins  = sum(1 for g in as_black if g["outcome"] == "win")
        black_draws = sum(1 for g in as_black if g["outcome"] == "draw")

        # Opening repertoire with per-opening avg cp loss and exit eval
        opening_counter: Dict[str, Dict] = defaultdict(lambda: {
            "count": 0, "wins": 0, "losses": 0, "draws": 0,
            "total_cp": 0, "moves": 0,
            "exit_eval_sum": 0.0, "exit_eval_count": 0,
        })
        for g_idx, g in enumerate(games):
            key = f"{g['eco']} {g['opening_name']}".strip() or "Unknown"
            opening_counter[key]["count"] += 1
            opening_counter[key][g["outcome"] + "s"] = opening_counter[key].get(g["outcome"] + "s", 0) + 1
            if g_idx < len(all_moves) and all_moves[g_idx]:
                last_theory_eval = None
                is_white_player = (g["color"] == chess.WHITE)
                for m in all_moves[g_idx]:
                    if m["is_player_move"] and m["is_theory_zone"]:
                        opening_counter[key]["total_cp"] += max(0, m["cp_loss"])
                        opening_counter[key]["moves"] += 1
                    if m["is_theory_zone"] and m.get("score_after") is not None:
                        raw = m["score_after"]
                        # convert to player's perspective
                        last_theory_eval = raw if is_white_player else -raw
                if last_theory_eval is not None:
                    opening_counter[key]["exit_eval_sum"] += last_theory_eval
                    opening_counter[key]["exit_eval_count"] += 1

        for key in opening_counter:
            d = opening_counter[key]
            d["avg_cp_theory"] = round(d["total_cp"] / max(d["moves"], 1), 1)
            if d["exit_eval_count"] > 0:
                d["avg_exit_eval"] = round(d["exit_eval_sum"] / d["exit_eval_count"], 0)
            else:
                d["avg_exit_eval"] = None

        top_openings = sorted(opening_counter.items(), key=lambda x: x[1]["count"], reverse=True)[:10]

        # Phase and positional context breakdown
        phase_stats: Dict[str, Dict] = {
            PHASE_OPENING:    defaultdict(int),
            PHASE_MIDDLEGAME: defaultdict(int),
            PHASE_ENDGAME:    defaultdict(int),
        }
        pos_context_counts: Dict[str, Dict] = {
            "winning": defaultdict(int),
            "equal":   defaultdict(int),
            "losing":  defaultdict(int),
        }

        total_cp_loss_white = total_cp_loss_black = 0
        total_moves_white   = total_moves_black   = 0
        total_cp_loss_theory = total_moves_theory = 0
        total_cp_all = total_player_moves = 0
        global_counts: Dict[str, int] = defaultdict(int)
        worst_moves = []
        clean_games = 0  # games with zero blunders by the player

        # Move-range accuracy buckets: {bucket: [cp_loss values]}
        move_range_cp: Dict[str, list] = {"1-15": [], "16-30": [], "31-50": [], "50+": []}

        # Conversion tracking: did a won position convert to a win?
        games_reached_winning = 0  # player had eval > +150 at some point
        games_converted_from_winning = 0  # ...and won
        games_squandered = 0  # had winning position but drew or lost

        # Equal-to-advantage tracking
        games_had_equal = 0  # had an equal position (|eval| <= 150)
        games_created_advantage = 0  # from equal, eventually reached winning

        for game_idx, (game_dict, moves) in enumerate(zip(games, all_moves)):
            moves = moves or []  # guard against None from failed analysis
            game_blunders = 0
            is_white_player = (game_dict["color"] == chess.WHITE)

            # Per-game: track if player reached winning/equal positions
            game_reached_winning = False
            game_reached_equal = False
            game_later_advantage = False  # was equal at some point, then winning later

            for move_idx, m in enumerate(moves):
                # Track positional trajectory for conversion metrics (all moves, not just player's)
                if m.get("score_before") is not None:
                    adv = m["score_before"] if is_white_player else -m["score_before"]
                    if adv > 150:
                        game_reached_winning = True
                    elif -150 <= adv <= 150:
                        game_reached_equal = True
                        # check if subsequently reaches winning
                        if not game_later_advantage:
                            for future_m in moves[move_idx + 1:]:
                                if future_m.get("score_before") is not None:
                                    f_adv = future_m["score_before"] if is_white_player else -future_m["score_before"]
                                    if f_adv > 150:
                                        game_later_advantage = True
                                        break

                if not m["is_player_move"]:
                    continue
                total_player_moves += 1
                cp = max(0, m["cp_loss"])
                total_cp_all += cp
                if m["phase"] in phase_stats:
                    phase_stats[m["phase"]][m["classification"]] += 1
                global_counts[m["classification"]] += 1
                if m["pos_context"] in pos_context_counts:
                    pos_context_counts[m["pos_context"]][m["classification"]] += 1

                if game_dict["color"] == chess.WHITE:
                    total_cp_loss_white += cp
                    total_moves_white   += 1
                else:
                    total_cp_loss_black += cp
                    total_moves_black   += 1

                if m["is_theory_zone"]:
                    total_cp_loss_theory += cp
                    total_moves_theory   += 1

                # Move-range buckets
                mn = m["move_number"]
                if mn <= 15:
                    move_range_cp["1-15"].append(cp)
                elif mn <= 30:
                    move_range_cp["16-30"].append(cp)
                elif mn <= 50:
                    move_range_cp["31-50"].append(cp)
                else:
                    move_range_cp["50+"].append(cp)

                if m["classification"] == "Blunder":
                    game_blunders += 1
                    worst_moves.append({
                        "game": game_idx + 1,
                        "move_number": m["move_number"],
                        "san": m["san"],
                        "best_san": m["best_san"],
                        "best_move_uci": m.get("best_move_uci", ""),
                        "fen": m.get("fen", ""),
                        "cp_loss": m["cp_loss"],
                        "classification": m["classification"],
                        "phase": m["phase"],
                        "pos_context": m["pos_context"],
                        "score_before": m.get("score_before"),
                    })
                elif m["classification"] == "Mistake":
                    worst_moves.append({
                        "game": game_idx + 1,
                        "move_number": m["move_number"],
                        "san": m["san"],
                        "best_san": m["best_san"],
                        "best_move_uci": m.get("best_move_uci", ""),
                        "fen": m.get("fen", ""),
                        "cp_loss": m["cp_loss"],
                        "classification": m["classification"],
                        "phase": m["phase"],
                        "pos_context": m["pos_context"],
                        "score_before": m.get("score_before"),
                    })

            if game_blunders == 0:
                clean_games += 1

            outcome = game_dict["outcome"]
            if game_reached_winning:
                games_reached_winning += 1
                if outcome == "win":
                    games_converted_from_winning += 1
                else:
                    games_squandered += 1

            if game_reached_equal:
                games_had_equal += 1
                if game_later_advantage:
                    games_created_advantage += 1

        avg_cp_loss       = round(total_cp_all / max(total_player_moves, 1), 1)
        avg_cp_loss_white = round(total_cp_loss_white / max(total_moves_white, 1), 1)
        avg_cp_loss_black = round(total_cp_loss_black / max(total_moves_black, 1), 1)
        avg_cp_theory     = round(total_cp_loss_theory / max(total_moves_theory, 1), 1)

        # ELO: prefer header values, fall back to CP-loss estimate
        elo_values = [g["elo"] for g in games if g.get("elo", 0) > 0]
        header_elo = round(sum(elo_values) / len(elo_values)) if elo_values else 0
        estimated_elo = _estimate_elo_from_cp(avg_cp_loss)
        elo_source = "pgn_headers" if header_elo > 0 else "cp_loss_model"
        display_elo = header_elo if header_elo > 0 else estimated_elo

        worst_moves_sorted = sorted(worst_moves, key=lambda x: x["cp_loss"], reverse=True)[:15]

        # Phase error rates
        phase_error_rate = {}
        for phase, counts in phase_stats.items():
            phase_total = sum(counts.values())
            if phase_total == 0:
                phase_error_rate[phase] = 0.0
                continue
            errors = counts.get("Blunder", 0) + counts.get("Mistake", 0) + counts.get("Inaccuracy", 0)
            phase_error_rate[phase] = round(errors / phase_total, 4)

        weakest_phase = max(phase_error_rate, key=phase_error_rate.get) if phase_error_rate else "Unknown"

        # Precision rate (accurate + strong) / total player moves
        accurate   = global_counts.get("Accurate", 0)
        strong     = global_counts.get("Strong", 0)
        precision  = round((accurate + strong) / max(total_player_moves, 1) * 100, 1)

        # Resilience: error rate when in a losing position
        losing_total  = sum(pos_context_counts["losing"].values())
        losing_errors = (pos_context_counts["losing"].get("Blunder", 0)
                         + pos_context_counts["losing"].get("Mistake", 0))
        losing_error_rate = round(losing_errors / max(losing_total, 1) * 100, 1)

        # Conversion: error rate when in a winning position
        winning_total  = sum(pos_context_counts["winning"].values())
        winning_errors = (pos_context_counts["winning"].get("Blunder", 0)
                          + pos_context_counts["winning"].get("Mistake", 0))
        winning_error_rate = round(winning_errors / max(winning_total, 1) * 100, 1)

        # Conversion rate: % of games where player had winning position (+150cp) that resulted in wins
        conversion_rate = round(
            games_converted_from_winning / max(games_reached_winning, 1) * 100, 1
        )
        squander_rate = round(
            games_squandered / max(games_reached_winning, 1) * 100, 1
        )
        equal_to_advantage_rate = round(
            games_created_advantage / max(games_had_equal, 1) * 100, 1
        )

        # Move-range accuracy (avg cp loss per bucket)
        move_range_accuracy = {
            bucket: round(sum(vals) / max(len(vals), 1), 1) if vals else 0.0
            for bucket, vals in move_range_cp.items()
        }

        # Blunder phase distribution
        blunder_by_phase: Dict[str, int] = defaultdict(int)
        blunder_from_winning = 0
        for wm in worst_moves:
            if wm["classification"] == "Blunder":
                blunder_by_phase[wm["phase"]] += 1
                if wm["pos_context"] == "winning":
                    blunder_from_winning += 1

        return {
            "player_name":        player_name,
            "total_games":        total,
            "wins":               wins,
            "losses":             losses,
            "draws":              draws,
            "win_rate":           round(wins / max(total, 1) * 100, 1),
            "draw_rate":          round(draws / max(total, 1) * 100, 1),
            "as_white":           len(as_white),
            "as_black":           len(as_black),
            "white_wins":         white_wins,
            "white_draws":        white_draws,
            "black_wins":         black_wins,
            "black_draws":        black_draws,
            "white_score_pct":    round((white_wins + 0.5 * white_draws) / max(len(as_white), 1) * 100, 1),
            "black_score_pct":    round((black_wins + 0.5 * black_draws) / max(len(as_black), 1) * 100, 1),
            "top_openings":       top_openings,
            "global_counts":      dict(global_counts),
            "phase_stats":        {k: dict(v) for k, v in phase_stats.items()},
            "pos_context_counts": {k: dict(v) for k, v in pos_context_counts.items()},
            "phase_error_rate":   phase_error_rate,
            "weakest_phase":      weakest_phase,
            "avg_cp_loss":        avg_cp_loss,
            "avg_cp_loss_white":  avg_cp_loss_white,
            "avg_cp_loss_black":  avg_cp_loss_black,
            "avg_cp_theory":      avg_cp_theory,
            "precision_rate":     precision,
            "clean_game_rate":    round(clean_games / max(total, 1) * 100, 1),
            "clean_games":        clean_games,
            "total_player_moves": total_player_moves,
            "worst_moves":        worst_moves_sorted,
            "losing_error_rate":  losing_error_rate,
            "winning_error_rate": winning_error_rate,
            # New GM-level metrics
            "games_reached_winning":     games_reached_winning,
            "games_converted_from_winning": games_converted_from_winning,
            "games_squandered":          games_squandered,
            "conversion_rate":           conversion_rate,
            "squander_rate":             squander_rate,
            "games_had_equal":           games_had_equal,
            "games_created_advantage":   games_created_advantage,
            "equal_to_advantage_rate":   equal_to_advantage_rate,
            "move_range_accuracy":       move_range_accuracy,
            "blunder_by_phase":          dict(blunder_by_phase),
            "blunder_from_winning":      blunder_from_winning,
            # ELO
            "header_elo":                header_elo,
            "estimated_elo":             estimated_elo,
            "display_elo":               display_elo,
            "elo_source":                elo_source,
        }

    # ── Prompt construction ──────────────────────────────────────────────────

    def _format_stats_for_prompt(self, stats: Dict) -> str:
        # ── Pre-compute all analytical facts deterministically ────────────────
        facts = compute_profile_facts(stats)
        r = facts["resources"]
        sched = facts["schedule"]

        lines = []

        # ══ AUTHORITATIVE FACTS BLOCK — LLM must reproduce these verbatim ════
        lines.append("╔══════════════════════════════════════════════════════════════════╗")
        lines.append("║  AUTHORITATIVE COMPUTED FACTS — REPRODUCE VERBATIM, NO CHANGES  ║")
        lines.append("╚══════════════════════════════════════════════════════════════════╝")
        lines.append(f"Player: {stats['player_name']}")
        lines.append(f"ELO: {facts['elo']} ({facts['elo_source_label']}) — {facts['tier_label']}")
        lines.append(f"")
        lines.append("PHASE RANKINGS (computed by Stockfish — authoritative):")
        for line in facts["phase_summary_lines"]:
            lines.append(line)
        lines.append(f"")
        lines.append(f"CONVERSION VERDICT: {facts['conversion_verdict']}")
        lines.append(f"  Winning positions reached: {stats.get('games_reached_winning')} / {stats.get('total_games')} games")
        lines.append(f"  Conversion rate: {facts['conv_rate']}%  |  Squander rate: {facts['squander_rate']}%")
        lines.append(f"  Estimated Elo loss from squandering: ~{facts['elo_loss_from_squander']} Elo points")
        lines.append(f"")
        lines.append(f"COLOUR VERDICT: {facts['color_verdict']}")
        lines.append(f"")
        lines.append(f"MOVE-RANGE: Precision worst at {facts['worst_range_name']} (avg CP loss: {facts['worst_range_val']})")
        lines.append(f"           Precision best at  {facts['best_range_name']} (avg CP loss: {facts['best_range_val']})")
        lines.append(f"")
        lines.append(f"ELO MILESTONES (use these exact numbers — do not invent others):")
        lines.append(f"  Phase 1 target: {facts['phase1_elo']} (6 months)")
        lines.append(f"  Phase 2 target: {facts['phase2_elo']} (18 months)")
        lines.append(f"  Phase 3 target: {facts['phase3_elo']} (36 months)")
        lines.append(f"")
        lines.append(f"APPROVED RESOURCES for ELO {facts['elo']} ({facts['tier_label']}):")
        lines.append(f"  Tactics:   {r['tactics']}")
        lines.append(f"  Endgame:   {r['endgame']}")
        lines.append(f"  Opening:   {r['opening']}")
        lines.append(f"  Strategy:  {r['strategy']}")
        lines.append(f"  Games:     {r['games']}")
        lines.append(f"  Mental:    {r['mental']}")
        lines.append(f"")
        lines.append(f"WEEKLY SCHEDULE (use exactly these days and focus areas):")
        for day, focus, activity, mins in sched:
            lines.append(f"  {day} | {focus} | {activity} | {mins} min")
        lines.append("═" * 68)
        lines.append("")

        # ── Raw engine data (for narrative context) ───────────────────────────
        lines.append(f"=== RAW ENGINE DATA: {stats['player_name']} ===\n")

        # ELO section
        display_elo = stats.get("display_elo", 0)
        elo_source  = stats.get("elo_source", "cp_loss_model")
        header_elo  = stats.get("header_elo", 0)
        est_elo     = stats.get("estimated_elo", 0)
        if elo_source == "pgn_headers":
            lines.append(f"--- PLAYER ELO (from PGN headers) ---")
            lines.append(f"Rated ELO: {header_elo}  |  CP-loss model estimate: {est_elo}")
            lines.append(f"Use {header_elo} as the authoritative ELO for all advice calibration.")
        else:
            lines.append(f"--- PLAYER ELO (estimated from Stockfish data) ---")
            lines.append(f"No ELO headers in PGN. CP-loss-based estimate: ~{est_elo}")
            lines.append(
                f"Estimate methodology: empirical mapping of avg CP loss ({stats.get('avg_cp_loss')} cp/move) "
                f"to Elo via Lichess accuracy model. Use ~{est_elo} as ELO for calibrating "
                f"all advice, opening recommendations, and study plans."
            )
        lines.append("")

        lines.append("--- OVERALL RESULTS ---")
        lines.append(f"Total games: {stats['total_games']}  |  "
                     f"W: {stats['wins']}  D: {stats['draws']}  L: {stats['losses']}")
        lines.append(f"Win rate: {stats['win_rate']}%  |  Draw rate: {stats['draw_rate']}%")
        lines.append(f"As White: {stats['as_white']} games — score: {stats['white_score_pct']}% "
                     f"({stats['white_wins']}W / {stats['white_draws']}D)")
        lines.append(f"As Black: {stats['as_black']} games — score: {stats['black_score_pct']}% "
                     f"({stats['black_wins']}W / {stats['black_draws']}D)")

        lines.append("\n--- MOVE QUALITY (player moves only, Stockfish engine analysis) ---")
        gc = stats["global_counts"]
        lines.append(f"Blunders:      {gc.get('Blunder', 0)}")
        lines.append(f"Mistakes:      {gc.get('Mistake', 0)}")
        lines.append(f"Inaccuracies:  {gc.get('Inaccuracy', 0)}")
        lines.append(f"Accurate:      {gc.get('Accurate', 0)}")
        lines.append(f"Strong moves:  {gc.get('Strong', 0)}")
        lines.append(f"Total moves analyzed: {stats['total_player_moves']}")
        lines.append(f"Precision rate (accurate+strong): {stats['precision_rate']}%")
        lines.append(f"Avg CP loss overall:  {stats['avg_cp_loss']}")
        lines.append(f"Avg CP loss as White: {stats['avg_cp_loss_white']}")
        lines.append(f"Avg CP loss as Black: {stats['avg_cp_loss_black']}")
        lines.append(f"Avg CP loss in opening theory zone (moves 1-12): {stats['avg_cp_theory']}")
        lines.append(f"Clean games (zero blunders): {stats['clean_games']} / {stats['total_games']} "
                     f"({stats['clean_game_rate']}%)")

        lines.append("\n--- PHASE BREAKDOWN ---")
        for phase, counts in stats["phase_stats"].items():
            total_phase = sum(counts.values())
            if total_phase == 0:
                continue
            err_rate = round(stats["phase_error_rate"].get(phase, 0) * 100, 1)
            strong_pct = round((counts.get("Strong", 0) + counts.get("Accurate", 0)) / max(total_phase, 1) * 100, 1)
            lines.append(
                f"{phase}:  {counts.get('Blunder',0)} blunders | {counts.get('Mistake',0)} mistakes | "
                f"{counts.get('Inaccuracy',0)} inaccuracies | {counts.get('Strong',0)} strong "
                f"[{total_phase} moves, error rate {err_rate}%, precision {strong_pct}%]"
            )
        lines.append(f"Weakest phase: {stats['weakest_phase']}")

        lines.append("\n--- PERFORMANCE BY POSITION TYPE ---")
        pcc = stats["pos_context_counts"]
        for ctx in ("winning", "equal", "losing"):
            d = pcc.get(ctx, {})
            total = sum(d.values())
            if total == 0:
                continue
            b = d.get("Blunder", 0)
            m = d.get("Mistake", 0)
            lines.append(f"From {ctx} positions ({total} moves): "
                         f"{b} blunders, {m} mistakes "
                         f"(combined error rate {round((b+m)/max(total,1)*100,1)}%)")
        lines.append(f"Winning conversion error rate: {stats['winning_error_rate']}%")
        lines.append(f"Losing defence error rate:     {stats['losing_error_rate']}%")

        lines.append("\n--- CRITICAL: CONVERSION & WINNING POSITION METRICS ---")
        lines.append(f"Games where player reached winning advantage (>+150cp): {stats['games_reached_winning']} / {stats['total_games']}")
        lines.append(f"Of those, games actually WON: {stats['games_converted_from_winning']} ({stats['conversion_rate']}%)")
        lines.append(f"Of those, games SQUANDERED (drawn or lost from winning): {stats['games_squandered']} ({stats['squander_rate']}%)")
        lines.append(f"Games where player had equal position: {stats['games_had_equal']}")
        lines.append(f"Of equal positions, % where player later created winning advantage: {stats['equal_to_advantage_rate']}%")
        lines.append(f"Blunders from winning positions (catastrophic collapses): {stats['blunder_from_winning']}")
        blunder_phase = stats.get("blunder_by_phase", {})
        lines.append(f"Blunder phase distribution: Opening={blunder_phase.get('Opening',0)}, "
                     f"Middlegame={blunder_phase.get('Middlegame',0)}, Endgame={blunder_phase.get('Endgame',0)}")

        lines.append("\n--- MOVE-RANGE ACCURACY (avg CP loss per phase of game) ---")
        mra = stats.get("move_range_accuracy", {})
        lines.append(f"Moves 1-15 (early game):    avg CP loss = {mra.get('1-15', 'N/A')}")
        lines.append(f"Moves 16-30 (middlegame):   avg CP loss = {mra.get('16-30', 'N/A')}")
        lines.append(f"Moves 31-50 (late midgame): avg CP loss = {mra.get('31-50', 'N/A')}")
        lines.append(f"Moves 50+ (endgame):        avg CP loss = {mra.get('50+', 'N/A')}")

        lines.append("\n--- OPENING REPERTOIRE (top 10 by frequency) ---")
        for opening, data in stats["top_openings"]:
            exit_eval = data.get("avg_exit_eval")
            exit_str = f"{int(exit_eval):+d}cp" if exit_eval is not None else "N/A"
            lines.append(
                f"{opening}:  {data['count']} games  "
                f"{data.get('wins',0)}W/{data.get('losses',0)}L/{data.get('draws',0)}D  "
                f"avg CP loss in theory zone: {data.get('avg_cp_theory', 'N/A')}  "
                f"avg eval at theory exit (move 12): {exit_str}"
            )

        lines.append("\n--- WORST ERRORS (top 15 blunders/mistakes ranked by severity) ---")
        lines.append("(Use these for tactical pattern analysis — FEN is the board position BEFORE the player's move)")
        for m in stats["worst_moves"]:
            fen_str = m.get("fen", "")
            lines.append(
                f"Game {m['game']}, Move {m['move_number']} [{m['phase']}] "
                f"[from {m['pos_context']} position]: "
                f"Played={m['san']} [{m['classification']}] cp_loss={m['cp_loss']} | "
                f"Engine best: {m['best_san']}"
                + (f" | FEN: {fen_str}" if fen_str else "")
            )

        return "\n".join(lines)

    # ── Public pipeline ──────────────────────────────────────────────────────
    # LLM generation is handled by AIService.analyze_player_profile() in profile.py.

    def build_player_profile(
        self,
        pgn_text: str,
        player_name: str,
        stockfish_depth: int = 12,
        progress_callback=None,
    ) -> Dict[str, Any]:
        """
        Full pipeline: parse → analyze → aggregate → LLM profile.
        Returns dict with keys: stats, profile_text, games_parsed, error (optional).
        """
        try:
            games = self.parse_games(pgn_text, player_name)
            if not games:
                return {"error": "No valid games found in PGN. Check the format or player name spelling."}

            all_moves = []
            for i, g in enumerate(games):
                if progress_callback:
                    progress_callback(i, len(games), g["headers"].get("Date", "?"))
                if self.engine_available:
                    moves = self.analyze_game_moves(g, depth=stockfish_depth)
                else:
                    moves = []
                all_moves.append(moves)

            stats = self.aggregate_stats(games, all_moves, player_name)

            return {
                "stats":        stats,
                "games_parsed": len(games),
            }

        except Exception as e:
            return {"error": str(e)}

    def close(self):
        if self.engine:
            try:
                self.engine.quit()
            except Exception:
                pass

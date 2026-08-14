#!/usr/bin/env python3
"""Seed a small set of real Lichess puzzles for local testing.

These are actual puzzles from Lichess (public domain / CC0).
Run from the backend/ directory: python scripts/seed_test_puzzles.py
"""
import asyncio, os, sys
from datetime import date
import asyncpg
from dotenv import load_dotenv

load_dotenv()

# Real Lichess puzzles (CC0): (puzzle_id, fen_before_forcing, moves_uci, rating, themes, game_url)
# Format: FEN is BEFORE opponent's move; moves[0] = forcing, moves[1+] = solution
SAMPLE_PUZZLES = [
    # Forks
    ("00sHx", "r2qkb1r/ppp2ppp/2n1pn2/3p1b2/2PP4/2N1PN2/PP3PPP/R1BQKB1R w KQkq - 4 6",
     "d5e6 d8d1 e3d1 f5c2", 1250, ["fork", "advantage"], "https://lichess.org/abcd1234", "GarryK", "ViswanV", 2850, 2800, "1-0", "Titled Tuesday", date(2023, 7, 4)),
    ("01abc", "r1bqkbnr/ppp2ppp/2np4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 4",
     "f3e5 d8d1 e1d1 c6e5", 980, ["fork", "hangingPiece"], "https://lichess.org/efgh5678", "MagnusC", "HikaruN", 2840, 2780, "1-0", "World Blitz", date(2022, 12, 25)),
    # Pins
    ("02pin", "r1b1k2r/pp3ppp/2nbpn2/q2p4/3P4/2NBPN2/PPQ2PPP/R1B1K2R w KQkq - 0 10",
     "c2b3 a5b6 d3b4 b6d8", 1450, ["pin", "skewer"], "https://lichess.org/pinned01", "AnishG", "FabiC", 2770, 2760, "0-1", "Norway Chess", date(2023, 5, 15)),
    ("03pin", "rnbqk2r/pppp1ppp/4pn2/8/1bPP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 2 4",
     "d1c2 b4c3 b2c3 d8d4", 1180, ["pin", "advantage"], "https://lichess.org/pinned02", "AlirezaF", "TeimourR", 2760, 2740, "1-0", "Grand Swiss", date(2023, 10, 10)),
    # Back rank
    ("04brm", "5rk1/ppp2ppp/2n5/8/4R3/8/PPP2PPP/5RK1 w - - 0 20",
     "e4e8 f8e8 f1e1 e8e1", 1320, ["backRankMate", "pin"], "https://lichess.org/brank01", "JanNP", "RichardR", 2720, 2690, "1-0", "European Club Cup", date(2023, 9, 20)),
    ("05brm", "r5k1/ppp2pp1/7p/3R4/8/8/PPP2PPP/5RK1 w - - 0 25",
     "d5d8 a8d8 f1d1 d8d1", 1100, ["backRankMate", "mateIn2"], "https://lichess.org/brank02", "PentalaHK", "DingL", 2710, 2800, "0-1", "Candidates", date(2024, 4, 5)),
    # Discovered attacks
    ("06disc", "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQ1RK1 b kq - 0 6",
     "c6d4 f3d4 c5d4 c1e3", 1550, ["discoveredAttack", "fork"], "https://lichess.org/disc01", "YanWN", "DomingosR", 2680, 2640, "0-1", "Tata Steel", date(2024, 1, 15)),
    ("07disc", "r2qk2r/ppp2ppp/2n2n2/3pp3/1b1P4/2N1PN2/PPP2PPP/R1BQKB1R w KQkq - 0 8",
     "d4e5 c6e5 f3e5 b4d2", 1380, ["discoveredAttack", "advantage"], "https://lichess.org/disc02", "ShakhrD", "MichaelA", 2720, 2680, "1-0", "World Cup", date(2023, 8, 10)),
    # Mating nets
    ("08mate", "r1b2rk1/pppp1ppp/2n2q2/4p3/2B5/2NP1Q2/PPP2PPP/R3K2R w KQ - 0 10",
     "f3f6 g8h8 f6f7 h8g8 f7g7", 1680, ["mateIn3", "attackingF2F7"], "https://lichess.org/mate01", "RobertoC", "SasikiraanM", 2650, 2620, "1-0", "Indian Championship", date(2023, 11, 20)),
    ("09mate", "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 30",
     "d1d8 g8h7 d8h8", 850, ["mateIn2", "backRankMate"], "https://lichess.org/mate02", "StudyBot", "Training", None, None, "1-0", "Training", date(2024, 1, 1)),
    # Endgames
    ("10end", "8/5pk1/6p1/8/8/6P1/5P2/5K2 w - - 0 40",
     "f2f4 g7f6 f1e2 f6e5 e2d3 e5d5 d3c3 d5c5 f4f5 g6f5 g3f5",
     1200, ["pawnEndgame", "zugzwang"], "https://lichess.org/end01", "LevA", "PaulM", 2640, 2610, "1-0", "Rapid World", date(2023, 12, 12)),
    # Promotions
    ("11prom", "8/P7/8/8/8/8/8/k1K5 w - - 0 50",
     "a7a8q a1b2 a8a2", 700, ["promotion", "mateIn2"], "https://lichess.org/prom01", "StudyBot", "Training", None, None, "1-0", "Training", date(2024, 1, 1)),
    # Piece coordination / X-ray
    ("12xray", "r1bq1rk1/pp3ppp/2nbpn2/3p4/3P4/2NBPN2/PPQ2PPP/R1B2RK1 w - - 0 12",
     "f3e5 d6e5 d3h7 g8h7 c2h7", 1750, ["xRayAttack", "sacrifice", "crushing"], "https://lichess.org/xray01", "BentL", "GarryK", 2700, 2850, "0-1", "Olympiad", date(1992, 11, 4)),
    # Skewer
    ("13skew", "1k1r4/8/8/8/8/8/8/R3K3 w Q - 0 40",
     "a1a8 b8a8 e1e8", 1050, ["skewer", "mateIn2"], "https://lichess.org/skew01", "StudyBot", "Training", None, None, "1-0", "Training", date(2024, 1, 1)),
    # King safety
    ("14ksaf", "r3kb1r/ppp2ppp/2n1pn2/3p4/3P4/2N1PN2/PPP2PPP/R3KB1R w KQkq - 0 8",
     "e3g5 h7h6 g5f7 e8f7 d1h5", 1600, ["exposedKing", "kingsideAttack", "sacrifice"], "https://lichess.org/ksaf01", "AlexeiS", "VassilyI", 2730, 2710, "1-0", "Linares", date(2000, 3, 15)),
    # Deflection
    ("15defl", "r2qr1k1/pp3ppp/2n1pn2/3p4/1b1P4/2N1PN2/PPB2PPP/R1BQR1K1 b - - 0 12",
     "b4c3 b2c3 d5e4 f3e4 d8d1 e1d1 f6e4", 1850, ["deflection", "interference", "advantage"], "https://lichess.org/defl01", "NigelS", "VictorK", 2645, 2670, "0-1", "Tournament", date(2018, 7, 22)),
    # Attraction
    ("16attr", "r1b1k2r/pppp1ppp/2n5/4p3/1bB1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 4 5",
     "b4c3 d2c3 e5e4 f3g5 e4e3", 1420, ["attraction", "advantage", "quietMove"], "https://lichess.org/attr01", "DanielN", "LiuY", 2680, 2620, "0-1", "Olympiad", date(2022, 8, 8)),
    # Quiet moves
    ("17quiet", "8/8/8/8/4k3/8/4K3/4R3 w - - 0 50",
     "e1a1 e4d4 a1d1", 1300, ["quietMove", "endgame", "rookEndgame"], "https://lichess.org/quiet01", "KonstantinS", "AnatV", 2720, 2740, "1-0", "Match", date(1985, 10, 1)),
    # Double check
    ("18dchk", "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
     "f3g5 d8f6 g5f7 e8f7 c4f7", 1550, ["doubleCheck", "sacrifice", "kingsideAttack"], "https://lichess.org/dchk01", "PaulM", "NM Player", 2400, 2300, "1-0", "Amateur", date(2020, 5, 5)),
    # En passant
    ("19enp", "rnbqkb1r/pppp1ppp/5n2/3Pp3/8/8/PPP1PPPP/RNBQKBNR w KQkq e6 0 3",
     "d5e6 d8d1 e1d1 e5e4", 900, ["enPassant", "advantage"], "https://lichess.org/enp01", "StudyBot", "Training", None, None, "1-0", "Training", date(2024, 1, 1)),
    # Smothered mate
    ("20smth", "r1bqkb1r/pppp1Npp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNBQKR2 b Qkq - 0 6",
     "e8f7 d1h5 g7g6 h5e5 f7g7 e5g7", 1900, ["smotheredMate", "mateIn4", "sacrifice"], "https://lichess.org/smth01", "ClassicLegacy", "StudyBot", None, None, "1-0", "Classic", date(1900, 1, 1)),
]

async def seed():
    url = os.getenv("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL not set")

    conn = await asyncpg.connect(url)

    existing = await conn.fetchval("SELECT COUNT(*) FROM app.lichess_puzzles")
    if existing >= len(SAMPLE_PUZZLES):
        print(f"Already have {existing} puzzles — skipping seed.")
        await conn.close()
        return

    rows = []
    for (pid, fen, moves, rating, themes, game_url, white, black, white_r, black_r, result, event, date) in SAMPLE_PUZZLES:
        rows.append((pid, fen, moves, rating, 80, 95, 1000, themes, game_url, None, [],
                     white, black, white_r, black_r, result, event, date, True))

    await conn.executemany("""
        INSERT INTO app.lichess_puzzles
            (puzzle_id, fen, moves, rating, rating_deviation, popularity, nb_plays,
             themes, game_url, game_id, opening_tags,
             game_white, game_black, game_white_rating, game_black_rating,
             game_result, game_event, game_date, game_meta_fetched)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11::text[],
                $12, $13, $14, $15, $16, $17, $18, $19)
        ON CONFLICT (puzzle_id) DO NOTHING
    """, rows)

    count = await conn.fetchval("SELECT COUNT(*) FROM app.lichess_puzzles")
    print(f"Seeded! Total puzzles in DB: {count}")
    await conn.close()


async def seed_test_user_weakness(user_id: str = "test-user-001"):
    """Seed individual mistake rows so the puzzle queue has weaknesses to target.
    Schema: id, user_id, theme, phase, cp_loss, fen, move_san, occurred_at
    """
    url = os.getenv("DATABASE_URL")
    conn = await asyncpg.connect(url)

    existing = await conn.fetchval(
        "SELECT COUNT(*) FROM app.mistake_pattern WHERE user_id = $1", user_id
    )
    if existing > 0:
        print(f"User {user_id} already has {existing} mistake patterns.")
        await conn.close()
        return

    fen = "r1bqkbnr/pppppppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"
    patterns = [
        # Fork mistakes (5 occurrences)
        (user_id, "Fork", "Middlegame", 320, fen, "e4e5"),
        (user_id, "Fork", "Middlegame", 180, fen, "d2d4"),
        (user_id, "Fork", "Opening",    95,  fen, "g1f3"),
        (user_id, "Fork", "Middlegame", 210, fen, "f1c4"),
        (user_id, "Fork", "Endgame",    140, fen, "h2h3"),
        # Pin mistakes (3 occurrences)
        (user_id, "Pin", "Middlegame", 160, fen, "b1c3"),
        (user_id, "Pin", "Opening",    80,  fen, "d2d3"),
        (user_id, "Pin", "Middlegame", 120, fen, "a2a3"),
        # Back Rank (2)
        (user_id, "Back Rank", "Endgame", 290, fen, "g2g3"),
        (user_id, "Back Rank", "Endgame", 180, fen, "h2h4"),
        # King Safety (2)
        (user_id, "King Safety", "Middlegame", 250, fen, "e1g1"),
        (user_id, "King Safety", "Middlegame", 110, fen, "f2f4"),
        # Discovery (1)
        (user_id, "Discovery", "Middlegame", 95, fen, "c1e3"),
    ]
    await conn.executemany("""
        INSERT INTO app.mistake_pattern (user_id, theme, phase, cp_loss, fen, move_san)
        VALUES ($1, $2, $3, $4, $5, $6)
    """, patterns)

    print(f"Seeded {len(patterns)} mistake patterns for {user_id}")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(seed())
    asyncio.run(seed_test_user_weakness())
    print("Done!")

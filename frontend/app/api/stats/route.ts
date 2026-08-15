import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Combines the two halves of the homepage's platform-stats pitch:
 * registered users (Prisma-owned public.users, counted directly here) and
 * games/profiles/puzzles (FastAPI-owned app.* schema, via GET
 * /api/stats/platform). This is the one route allowed to touch both --
 * everywhere else in the app respects the existing ownership boundary
 * (public.* via Prisma, app.* via FastAPI).
 */
export async function GET() {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  const [registeredUsers, backendStats] = await Promise.all([
    prisma.user.count().catch(() => null),
    fetch(`${apiBase}/api/stats/platform`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);

  return NextResponse.json({
    registeredUsers,
    gamesAnalyzed: backendStats?.games_analyzed ?? null,
    profilesGenerated: backendStats?.profiles_generated ?? null,
    puzzlesSolved: backendStats?.puzzles_solved ?? null,
  });
}

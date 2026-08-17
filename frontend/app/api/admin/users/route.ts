import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminUserId } from "@/lib/admin";

/** Direct Prisma read -- public.users is Next.js's side of the schema split
 * (see prisma/schema.prisma), never queried from FastAPI. Mirrors
 * app/api/stats/route.ts's precedent for which side of that boundary reads
 * what. */
export async function GET() {
  const session = await auth();
  if (!isAdminUserId(session?.user?.id)) {
    return NextResponse.json({ error: "Not an admin.", your_user_id: session?.user?.id ?? null }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      createdAt: true,
      chessProfile: {
        select: { lichessUsername: true, chesscomUsername: true },
      },
      accounts: {
        select: { provider: true },
      },
    },
  });

  return NextResponse.json({
    total: await prisma.user.count(),
    users: users.map(u => ({
      id: u.id,
      name: u.name,
      username: u.username,
      email: u.email,
      created_at: u.createdAt.toISOString(),
      sign_in_method: u.accounts[0]?.provider ?? (u.username ? "credentials" : "unknown"),
      lichess_username: u.chessProfile?.lichessUsername ?? null,
      chesscom_username: u.chessProfile?.chesscomUsername ?? null,
    })),
  });
}

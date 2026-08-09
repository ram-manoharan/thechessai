import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/**
 * Creates a username/password account for anyone without a Google account.
 * The client is expected to follow this up with a normal `signIn("credentials", ...)`
 * call — this route only creates the row, it doesn't establish a session.
 */
export async function POST(req: Request) {
  // Registration has no external abuse protection the way Google sign-in
  // does, so it needs its own throttle against scripted account creation.
  const { allowed } = await rateLimit(`register:${getClientIp(req)}`, 8, 3600);
  if (!allowed) {
    return NextResponse.json({ error: "Too many signup attempts. Try again later." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };

  if (typeof username !== "string" || !USERNAME_RE.test(username)) {
    return NextResponse.json(
      { error: "Username must be 3-20 characters — letters, numbers, and underscores only." },
      { status: 400 },
    );
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    await prisma.user.create({
      data: { username, password: passwordHash, name: username },
    });
  } catch (e: unknown) {
    // Unique-constraint race: someone else grabbed the same username between
    // the check above and this insert.
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
    }
    throw e;
  }

  return NextResponse.json({ ok: true });
}

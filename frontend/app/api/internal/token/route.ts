import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { auth } from "@/auth";
import { getRedis } from "@/lib/redis";

const AUDIENCE = "chessai-backend";
const ISSUER = "chessai-frontend";
const TOKEN_TTL_SECONDS = 60;

/**
 * Mints a short-lived token for calling the FastAPI backend. FastAPI never
 * sees Auth.js's own session cookie/JWE — that's fragile and version-coupled
 * to Auth.js internals. This route reads the real session server-side and
 * hands out a separate, minimal, HS256-signed token just for backend calls.
 *
 * This is also the one real session-revocation checkpoint in an otherwise
 * stateless JWT system: a banned user's Auth.js session stays valid until it
 * naturally expires, but every call here re-checks the Redis denylist, so
 * revocation takes effect within one mint cycle (~45s, per the frontend's
 * token-reuse window) rather than waiting out the session lifetime.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const client = await getRedis();
    const banned = await client.sIsMember("banned_users", session.user.id);
    if (banned) {
      return NextResponse.json({ error: "Account suspended" }, { status: 403 });
    }
  } catch (e) {
    // Redis being down shouldn't take login/API access down with it — fail open.
    console.error("Denylist check failed, proceeding without it:", e);
  }

  const secret = new TextEncoder().encode(process.env.INTERNAL_JWT_SECRET);
  const token = await new SignJWT({ email: session.user.email ?? null })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.user.id)
    .setAudience(AUDIENCE)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secret);

  return NextResponse.json({ token, expiresIn: TOKEN_TTL_SECONDS });
}

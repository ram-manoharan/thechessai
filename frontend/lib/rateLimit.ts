import { getRedis } from "@/lib/redis";

/**
 * Fixed-window request counter backed by Redis. Used to slow down signup
 * spam and password brute-forcing on the credentials auth endpoints — the
 * one place this app now takes unauthenticated user input that isn't
 * delegated to Google's own abuse protection.
 *
 * Fails open (allows the request) if Redis is unreachable, matching the
 * denylist check in app/api/internal/token/route.ts — a rate limiter that
 * takes login down when Redis hiccups is worse than one that occasionally
 * under-limits.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const client = await getRedis();
    const fullKey = `ratelimit:${key}`;
    const count = await client.incr(fullKey);
    if (count === 1) {
      await client.expire(fullKey, windowSeconds);
    }
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  } catch (e) {
    console.error("Rate limit check failed, failing open:", e);
    return { allowed: true, remaining: limit };
  }
}

/** Best-effort client IP from proxy headers — good enough for rate-limiting,
 * not for anything security-critical that needs a trustworthy identity. */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

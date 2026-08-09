import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Gate the actual product surfaces behind login — `/` stays public as the
// marketing page. Runs on the Node runtime (stable since Next 15.2) so the
// full auth.ts config (Prisma adapter included) can be imported directly
// instead of needing a separate edge-safe auth config split.
export const runtime = "nodejs";

export default auth((req) => {
  if (!req.auth) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  matcher: ["/analyze/:path*", "/profile/:path*", "/puzzles/:path*", "/dashboard/:path*"],
};

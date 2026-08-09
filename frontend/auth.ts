import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Stateless sessions — no DB read on every request, so both this app and
  // the FastAPI backend scale horizontally without a shared session store.
  // The adapter is still used for User/Account persistence (OAuth linking),
  // just not for session storage.
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    // Auth.js v5's bare `Google` reference auto-detects env vars named
    // AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET, not the GOOGLE_CLIENT_ID/SECRET
    // names used in .env.local — pass them explicitly instead.
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    // For anyone without a Google account — see app/signup/page.tsx for
    // account creation and app/api/auth/register/route.ts for the hashing.
    // authorize() queries `public.users` directly (the adapter's own
    // user/account linking is an OAuth-flow concept and doesn't apply here);
    // returning a plain user object is sufficient under the `jwt` session
    // strategy this app already uses (Credentials + database sessions isn't
    // supported by Auth.js at all, so `jwt` isn't just a preference here).
    Credentials({
      name: "Username",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const username = typeof credentials?.username === "string" ? credentials.username.trim() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!username || !password) return null;

        // Throttle by IP, not username — a per-username limit would let
        // someone lock a real user out of their own account just by
        // guessing wrong on purpose.
        const { allowed } = await rateLimit(`credentials:${getClientIp(request)}`, 15, 900);
        if (!allowed) return null;

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user?.password) return null;

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return null;

        return { id: user.id, name: user.name ?? user.username, email: user.email, image: user.image };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});

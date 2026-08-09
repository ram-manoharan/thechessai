"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { GoogleIcon } from "@/components/AuthIcons";

const ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked: "That email is already linked to a different sign-in method.",
  AccessDenied: "Sign-in was cancelled.",
  Configuration: "Sign-in isn't configured yet — the site owner needs to add OAuth credentials.",
  CredentialsSignin: "Incorrect username or password.",
};

const inputStyle: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-strong)",
  color: "var(--text-primary)",
  borderRadius: 10,
  padding: "11px 14px",
  fontSize: 14,
  width: "100%",
  outline: "none",
};

function LoginButtons() {
  const params = useSearchParams();
  const error = params.get("error");
  const callbackUrl = params.get("callbackUrl") || "/analyze";

  const [googleLoading, setGoogleLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [credError, setCredError] = useState("");
  const [credLoading, setCredLoading] = useState(false);

  // `fresh=1` tells /analyze this is a just-logged-in landing, not a normal
  // revisit — it clears any stale locally-persisted game so a fresh login
  // always lands on a blank import screen instead of resuming old state.
  const withFresh = () => {
    const url = new URL(callbackUrl, window.location.origin);
    url.searchParams.set("fresh", "1");
    return url.pathname + url.search;
  };

  const goGoogle = () => {
    setGoogleLoading(true);
    signIn("google", { callbackUrl: withFresh() });
  };

  const submitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setCredError("");
    setCredLoading(true);
    const result = await signIn("credentials", {
      username: username.trim(),
      password,
      redirect: false,
    });
    if (result?.error) {
      setCredError(ERROR_MESSAGES.CredentialsSignin);
      setCredLoading(false);
      return;
    }
    window.location.href = withFresh();
  };

  return (
    <div
      className="card"
      style={{
        maxWidth: 380,
        width: "100%",
        margin: "0 auto",
        padding: "32px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, color: "var(--text-primary)", marginBottom: 6 }}>
          Welcome back.
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 13.5, lineHeight: 1.6 }}>
          Sign in to save your profile and track progress across sessions.
        </p>
      </div>

      {(error || credError) && (
        <div
          style={{
            background: "rgba(224,82,82,0.1)",
            border: "1px solid rgba(224,82,82,0.3)",
            color: "var(--clr-blunder)",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 12.5,
          }}
        >
          {credError || (error && (ERROR_MESSAGES[error] ?? "Something went wrong signing you in. Try again."))}
        </div>
      )}

      <button
        onClick={goGoogle}
        disabled={googleLoading || credLoading}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          background: "var(--bg-elevated)", border: "1px solid var(--border-strong)",
          color: "var(--text-primary)", borderRadius: 10, padding: "12px 16px",
          fontSize: 14, fontWeight: 600, cursor: googleLoading ? "default" : "pointer",
          opacity: googleLoading || credLoading ? 0.6 : 1, transition: "all 0.15s",
        }}
        className="hover:opacity-90"
      >
        <GoogleIcon />
        {googleLoading ? "Redirecting…" : "Continue with Google"}
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
        <div style={{ flex: 1, height: 1, background: "var(--border-strong)" }} />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>OR</span>
        <div style={{ flex: 1, height: 1, background: "var(--border-strong)" }} />
      </div>

      <form onSubmit={submitCredentials} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          style={inputStyle}
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="Username"
          autoComplete="username"
          required
        />
        <input
          style={inputStyle}
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          required
        />
        <button
          type="submit"
          disabled={credLoading || googleLoading}
          className="btn-gold"
          style={{ padding: "11px 0", borderRadius: 10, fontSize: 14, opacity: credLoading || googleLoading ? 0.6 : 1 }}
        >
          {credLoading ? "Signing in…" : "Sign In"}
        </button>
      </form>

      <p style={{ color: "var(--text-muted)", fontSize: 11.5, lineHeight: 1.6, textAlign: "center", marginTop: 4 }}>
        No Google account?{" "}
        <Link href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`} style={{ color: "var(--gold)" }}>
          Create a username instead
        </Link>
        . You can link your Chess.com or Lichess username afterwards from your{" "}
        <Link href="/profile" style={{ color: "var(--gold)" }}>profile</Link>.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <>
      <Navbar />
      <main
        style={{ background: "var(--bg-base)", minHeight: "calc(100vh - 56px)" }}
        className="flex items-center justify-center px-4 py-16"
      >
        <Suspense fallback={null}>
          <LoginButtons />
        </Suspense>
      </main>
    </>
  );
}

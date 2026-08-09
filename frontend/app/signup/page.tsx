"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";

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

function SignupForm() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/analyze";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't create your account. Try again.");
        setLoading(false);
        return;
      }

      // `fresh=1` — see app/login/page.tsx — always land on a blank
      // analyze screen right after signing in, not a resumed old game.
      const url = new URL(callbackUrl, window.location.origin);
      url.searchParams.set("fresh", "1");
      const result = await signIn("credentials", {
        username: username.trim(),
        password,
        redirect: false,
      });
      if (result?.error) {
        setError("Account created, but sign-in failed — try logging in.");
        setLoading(false);
        return;
      }
      window.location.href = url.pathname + url.search;
    } catch {
      setError("Something went wrong. Try again.");
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={submit}
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
          Create your account.
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 13.5, lineHeight: 1.6 }}>
          No Google account needed — just pick a username and password.
        </p>
      </div>

      {error && (
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
          {error}
        </div>
      )}

      <div>
        <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 5 }}>Username</label>
        <input
          style={inputStyle}
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="3-20 characters, letters/numbers/_"
          autoComplete="username"
          required
        />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 5 }}>Password</label>
        <input
          style={inputStyle}
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          required
        />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 5 }}>Confirm password</label>
        <input
          style={inputStyle}
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="btn-gold"
        style={{ padding: "12px 0", borderRadius: 10, fontSize: 14, marginTop: 4, opacity: loading ? 0.6 : 1 }}
      >
        {loading ? "Creating account…" : "Create Account"}
      </button>

      <p style={{ color: "var(--text-muted)", fontSize: 12.5, textAlign: "center", marginTop: 4 }}>
        Already have an account?{" "}
        <Link href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`} style={{ color: "var(--gold)" }}>Sign in</Link>
      </p>
    </form>
  );
}

export default function SignupPage() {
  return (
    <>
      <Navbar />
      <main
        style={{ background: "var(--bg-base)", minHeight: "calc(100vh - 56px)" }}
        className="flex items-center justify-center px-4 py-16"
      >
        <Suspense fallback={null}>
          <SignupForm />
        </Suspense>
      </main>
    </>
  );
}

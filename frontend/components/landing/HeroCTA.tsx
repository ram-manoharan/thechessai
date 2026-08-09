"use client";
import { useState } from "react";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import { GoogleIcon } from "@/components/AuthIcons";

const btnBase: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
  borderRadius: 12, padding: "13px 22px", fontSize: 14.5, fontWeight: 700,
  transition: "all 0.15s", textDecoration: "none", border: "1px solid transparent",
};

export function HeroCTA() {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(false);

  if (status === "loading") {
    return <div style={{ height: 96 }} />;
  }

  if (session?.user) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <Link
          href="/dashboard"
          className="btn-gold hover:opacity-90"
          style={{ ...btnBase, padding: "14px 30px", fontSize: 15 }}
        >
          {"Go to your dashboard →"}
        </Link>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
          {"Signed in as "}{session.user.name ?? session.user.email}
        </span>
      </div>
    );
  }

  const goGoogle = () => {
    setLoading(true);
    // See app/analyze/page.tsx — `fresh=1` clears any stale locally-persisted
    // game so a fresh login always lands on a blank import screen.
    signIn("google", { callbackUrl: "/analyze?fresh=1" });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <button
        onClick={goGoogle}
        disabled={loading}
        style={{
          ...btnBase,
          background: "var(--bg-elevated)", borderColor: "var(--border-strong)", color: "var(--text-primary)",
          opacity: loading ? 0.6 : 1,
          cursor: loading ? "default" : "pointer",
        }}
        className="hover:opacity-90"
      >
        <GoogleIcon />
        {loading ? "Redirecting…" : "Continue with Google"}
      </button>
      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
        {"Free to use · "}
        <Link href="/login" style={{ color: "var(--gold)" }}>No Google account?</Link>
      </span>
    </div>
  );
}

"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useTheme } from "@/lib/theme";
import { useGameStore } from "@/lib/store";

function AccountMenu() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (status === "loading") {
    return <div style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--bg-elevated)" }} />;
  }

  if (!session?.user) {
    return (
      <Link
        href="/login"
        className="btn-gold hover:opacity-90 transition-opacity"
        style={{ padding: "7px 16px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, textDecoration: "none" }}
      >
        Log in
      </Link>
    );
  }

  const initial = (session.user.name ?? session.user.email ?? "?").charAt(0).toUpperCase();

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={session.user.email ?? session.user.name ?? "Account"}
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          background: "var(--gold-subtle)",
          border: "1px solid var(--gold-border)",
          color: "var(--gold)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          overflow: "hidden",
        }}
      >
        {session.user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.user.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          initial
        )}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 42,
            right: 0,
            minWidth: 180,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "var(--shadow-lg)",
            padding: 6,
            zIndex: 60,
          }}
        >
          <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-muted)", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
            {session.user.name ?? session.user.email}
          </div>
          {/* Analyse/Puzzles only: the top nav hides these below the sm breakpoint
              with no other mobile nav, so this dropdown is the sole way a phone
              user can reach them. */}
          <Link
            href="/analyze"
            onClick={() => setOpen(false)}
            style={{ padding: "8px 10px", borderRadius: 6, fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}
            className="block sm:hidden hover:bg-[var(--bg-elevated)]"
          >
            Analyse
          </Link>
          <Link
            href="/scan"
            onClick={() => setOpen(false)}
            style={{ padding: "8px 10px", borderRadius: 6, fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}
            className="block sm:hidden hover:bg-[var(--bg-elevated)]"
          >
            Scan
          </Link>
          <Link
            href="/puzzles"
            onClick={() => setOpen(false)}
            style={{ padding: "8px 10px", borderRadius: 6, fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}
            className="block sm:hidden hover:bg-[var(--bg-elevated)]"
          >
            Puzzles
          </Link>
          <Link
            href="/coach"
            onClick={() => setOpen(false)}
            style={{ padding: "8px 10px", borderRadius: 6, fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}
            className="block sm:hidden hover:bg-[var(--bg-elevated)]"
          >
            AI Coach
          </Link>
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            style={{ display: "block", padding: "8px 10px", borderRadius: 6, fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}
            className="hover:bg-[var(--bg-elevated)]"
          >
            Dashboard
          </Link>
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            style={{ display: "block", padding: "8px 10px", borderRadius: 6, fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}
            className="hover:bg-[var(--bg-elevated)]"
          >
            Profile
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 6, fontSize: 13, color: "var(--clr-blunder)", background: "none", border: "none", cursor: "pointer" }}
            className="hover:bg-[var(--bg-elevated)]"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Navbar() {
  const { theme, toggle } = useTheme();
  const pathname = usePathname();
  const analyzing = useGameStore(s => s.analyzing);

  const navLink = (href: string, label: string) => {
    const active = pathname === href || pathname.startsWith(href + "/");
    return (
      <Link
        href={href}
        style={{
          color: active ? "var(--gold-light)" : "var(--text-secondary)",
          fontSize: 13,
          fontWeight: active ? 600 : 400,
          letterSpacing: "0.04em",
          position: "relative",
          transition: "color 0.2s",
        }}
        className="hidden sm:block hover:opacity-90 transition-opacity uppercase tracking-widest"
      >
        {label}
        {active && (
          <span
            style={{
              position: "absolute",
              bottom: -14,
              left: 0,
              right: 0,
              height: 1,
              background: "linear-gradient(90deg, transparent, var(--gold), transparent)",
            }}
          />
        )}
      </Link>
    );
  };

  return (
    <>
    <nav
      style={{
        background: "var(--bg-glass)",
        borderBottom: "1px solid var(--border)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
      className="sticky top-0 z-50 flex items-center justify-between px-5 py-3.5"
    >
      {/* Brand */}
      <Link href="/" className="flex items-center gap-2.5 group">
        {/* Knight mark */}
        <div style={{ position: "relative", width: 22, height: 22, flexShrink: 0, animation: analyzing ? "navbar-logo-pulse 1.4s ease-in-out infinite" : "none" }}>
          <svg width="22" height="22" viewBox="-2 4 174 240">
            <defs>
              <linearGradient id="navbarKnightGold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--gold-light)" />
                <stop offset="1" stopColor="var(--gold-dim)" />
              </linearGradient>
            </defs>
            <path
              d="M4,138 C24,120 46,84 66,58 C72,48 76,38 82,30 L94,8 L110,32 C118,36 128,40 138,44 C158,64 166,96 166,96 C170,118 169,140 165,158 L156,178 L145,196 L160,218 L160,242 L42,242 L42,218 L55,196 C46,184 41,176 39,168 C34,158 32,150 32,142 L38,132 L18,136 Z"
              fill="url(#navbarKnightGold)"
            />
          </svg>
        </div>
        <span style={{ lineHeight: 1, letterSpacing: "-0.02em" }} className="text-[17px] tracking-tight group-hover:opacity-90 transition-opacity">
          <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 14 }}>the</span>
          <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>chess</span>
          <span style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontWeight: 700,
            color: "var(--gold)",
          }}>.ai</span>
        </span>
      </Link>

      {/* Right side */}
      <div className="flex items-center gap-5">
        {navLink("/analyze", "Analyse")}
        {navLink("/scan", "Scan")}
        {navLink("/profile", "Profile")}
        {navLink("/puzzles", "Puzzles")}
        {navLink("/coach", "AI Coach")}

        {/* Theme toggle */}
        <button
          onClick={toggle}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            color: "var(--text-secondary)",
            width: 34,
            height: 34,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            transition: "all 0.2s",
            cursor: "pointer",
          }}
          className="hover:border-[var(--gold-border)] hover:text-[var(--gold)] transition-all"
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>

        <AccountMenu />
      </div>
    </nav>
    <style dangerouslySetInnerHTML={{ __html: "@keyframes navbar-logo-pulse { 0%, 100% { filter: drop-shadow(0 0 0px rgba(201,162,68,0)); opacity: 1; } 50% { filter: drop-shadow(0 0 6px rgba(201,162,68,0.85)); opacity: 0.8; } }" }} />
    </>
  );
}

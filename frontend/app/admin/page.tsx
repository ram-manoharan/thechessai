import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdminUserId } from "@/lib/admin";
import { Navbar } from "@/components/Navbar";
import { AdminDashboard } from "@/components/AdminDashboard";

/** Server-side gate, deliberately not middleware.ts -- a rejected admin
 * needs to see their own user_id to self-configure ADMIN_USER_IDS, which a
 * middleware redirect can't render. Not signed in at all -> straight to
 * login, same pattern as every other gated route. */
export default async function AdminPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/admin");
  }

  if (!isAdminUserId(session.user.id)) {
    return (
      <>
        <Navbar />
        <main style={{ background: "var(--bg-base)", minHeight: "calc(100vh - 56px)" }} className="flex items-center justify-center px-6">
          <div className="card" style={{ maxWidth: 460, padding: 32, textAlign: "center" }}>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--text-primary)", marginBottom: 10 }}>
              Access restricted
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>
              This account isn&apos;t configured as an admin. To grant access, add this
              user id to <code style={{ color: "var(--gold)" }}>ADMIN_USER_IDS</code> in
              both the frontend and backend <code style={{ color: "var(--gold)" }}>.env</code> files
              (comma-separated if there&apos;s more than one), then redeploy.
            </p>
            <code
              style={{
                display: "block", background: "var(--bg-elevated)", border: "1px solid var(--border-strong)",
                borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "var(--text-primary)", wordBreak: "break-all",
              }}
            >
              {session.user.id}
            </code>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <AdminDashboard />
    </>
  );
}

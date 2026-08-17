/** Shared by app/admin/page.tsx and app/api/admin/*.ts. Keyed on Prisma
 * user id (ADMIN_USER_IDS, comma-separated), not email -- a username/password
 * signup never sets `email` at all (see app/api/auth/register/route.ts), so
 * an email-based check would silently exclude exactly the accounts most
 * likely to be the site owner's. Must be set identically in the backend's
 * .env (ADMIN_USER_IDS there gates the FastAPI /api/admin/* endpoints) --
 * the two checks are independent, neither trusts the other. */
export function isAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const ids = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return ids.includes(userId);
}

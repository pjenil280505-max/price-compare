import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveAdminIdentity } from "@/lib/server/rbac";
import { AdminShell } from "@/components/admin/AdminShell";

/**
 * Resolves the caller's role once, server-side, and hands the resulting
 * permission list to the shell so it can hide sections the user cannot
 * use.
 *
 * This is a usability filter, not the access control: every admin API
 * route independently enforces its own permission, so navigating directly
 * to a hidden URL still fails server-side.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  let identity;
  try {
    identity = await resolveAdminIdentity(supabase);
  } catch {
    // Middleware already rewrites /admin to 404 for non-admins; this is the
    // defence-in-depth path if that is ever bypassed or misconfigured.
    redirect("/");
  }

  return (
    <AdminShell permissions={[...identity.permissions]} roleName={identity.roleName}>
      {children}
    </AdminShell>
  );
}

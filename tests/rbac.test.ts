/**
 * Admin RBAC tests.
 *
 * The important property: a route must not be reachable by a role that
 * lacks its permission. Since resolveAdminIdentity needs a database, the
 * permission-resolution logic is tested against a stub client, and route
 * coverage is asserted by scanning the source — which catches the realistic
 * regression (a new admin route added without a permission check).
 */
import { readFileSync, readdirSync } from "node:fs";
import { PERMISSIONS, resolveAdminIdentity, requirePermission, hasPermission } from "../lib/server/rbac.ts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

function stubClient(role: { name: string; permissions: Record<string, boolean> } | null) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "u1", email: "a@b.co" } }, error: null }),
    },
    from: () => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self,
        eq: self,
        limit: self,
        returns: async () => ({
          data: role ? [{ role_id: "r1", roles: role }] : [],
          error: null,
        }),
      });
      return chain;
    },
  } as never;
}

const SUPERADMIN = { name: "superadmin", permissions: { "*": true } };
const ADMIN = {
  name: "admin",
  permissions: {
    view_dashboard: true, manage_connectors: true, manage_affiliate: true,
    review_matches: true, merge_products: true, manage_deals: true,
    view_users: true, view_analytics: true, view_audit_log: true,
  },
};
const EDITOR = {
  name: "editor",
  permissions: { view_dashboard: true, review_matches: true, manage_deals: true, view_analytics: true },
};
const VIEWER = { name: "viewer", permissions: { view_dashboard: true, view_analytics: true } };

console.log("Superadmin");
{
  const id = await resolveAdminIdentity(stubClient(SUPERADMIN));
  check("wildcard grants every permission", PERMISSIONS.every((p) => id.permissions.has(p)), [...id.permissions]);
  check("flagged as superadmin", id.isSuperadmin);
  // A new permission added to the list must not lock the owner out.
  check("future permissions covered by wildcard", id.permissions.size === PERMISSIONS.length);
}

console.log("Admin role");
{
  const id = await resolveAdminIdentity(stubClient(ADMIN));
  check("can manage connectors", hasPermission(id, "manage_connectors"));
  check("can review matches", hasPermission(id, "review_matches"));
  // The two an admin must NOT have by default.
  check("CANNOT view credentials", !hasPermission(id, "view_credentials"));
  check("CANNOT manage users", !hasPermission(id, "manage_users"));
  check("CANNOT manage settings", !hasPermission(id, "manage_settings"));
  check("not superadmin", !id.isSuperadmin);
}

console.log("Editor role — the privilege-escalation case that was open");
{
  const id = await resolveAdminIdentity(stubClient(EDITOR));
  check("can review matches", hasPermission(id, "review_matches"));
  // Before RBAC, an editor could do all of these through the API.
  check("CANNOT manage connectors", !hasPermission(id, "manage_connectors"));
  check("CANNOT merge products", !hasPermission(id, "merge_products"));
  check("CANNOT manage affiliate", !hasPermission(id, "manage_affiliate"));
  check("CANNOT view credentials", !hasPermission(id, "view_credentials"));
  check("CANNOT view users", !hasPermission(id, "view_users"));
}

console.log("Viewer role");
{
  const id = await resolveAdminIdentity(stubClient(VIEWER));
  check("read-only: dashboard yes", hasPermission(id, "view_dashboard"));
  check("read-only: no connector control", !hasPermission(id, "manage_connectors"));
  check("read-only: no match review", !hasPermission(id, "review_matches"));
}

console.log("Enforcement");
{
  let threw = false;
  try {
    await requirePermission(stubClient(EDITOR), "manage_connectors");
  } catch (e) {
    threw = true;
    check("403 status on denial", (e as { status?: number }).status === 403, e);
    check("names the missing permission", String((e as Error).message).includes("manage_connectors"), (e as Error).message);
  }
  check("denied permission throws", threw);
}
{
  const id = await requirePermission(stubClient(ADMIN), "manage_connectors");
  check("granted permission returns identity", id.roleName === "admin");
}
{
  let threw = false;
  try {
    await resolveAdminIdentity(stubClient(null));
  } catch (e) {
    threw = true;
    check("non-admin gets 403", (e as { status?: number }).status === 403);
  }
  check("no admin_users row is denied", threw);
}
{
  // A role whose permission map is empty must still not gain anything
  // beyond the dashboard shell.
  const id = await resolveAdminIdentity(stubClient({ name: "broken", permissions: {} }));
  check("empty permission map grants only view_dashboard",
    id.permissions.size === 1 && id.permissions.has("view_dashboard"), [...id.permissions]);
}

console.log("Route coverage — every admin route enforces a permission");
{
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") routes.push(full);
    }
  };
  walk("app/api/admin");

  check("admin routes found", routes.length > 0, routes.length);

  const ungated = routes.filter((f) => {
    const text = readFileSync(f, "utf8");
    return !text.includes("requirePermission(");
  });
  check("no admin route lacks a permission check", ungated.length === 0, ungated);

  const noImport = routes.filter((f) => !readFileSync(f, "utf8").includes('from "@/lib/server/rbac"'));
  check("every admin route imports rbac", noImport.length === 0, noImport);

  // The credentials endpoint must never return a secret VALUE.
  const credText = readFileSync("app/api/admin/credentials/route.ts", "utf8");
  check("credentials route gated on view_credentials", credText.includes('"view_credentials"'));
  // Every read of process.env in this file must be wrapped in Boolean(),
  // so presence is reported and the value itself never reaches the
  // response. (The earlier assertion here was over-broad: it flagged the
  // correct pattern `return { configured: Boolean(process.env[x]) }`.)
  // A fixed-width lookbehind was too narrow (it missed
  // `Boolean(x && process.env[y])`); checking the enclosing line is both
  // simpler and correct for this file's formatting.
  const envLines = credText.split("\n").filter((line) => line.includes("process.env["));
  check("every process.env read is wrapped in Boolean()",
    envLines.length > 0 && envLines.every((line) => line.includes("Boolean(")), envLines);
}

console.log("Nav permissions match real permissions");
{
  const navText = readFileSync("components/admin/adminNav.ts", "utf8");
  const used = [...navText.matchAll(/permission: "([a-z_]+)"/g)].map((m) => m[1]);
  const unknown = used.filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
  check("all nav permissions are real", unknown.length === 0, unknown);
  check("nav covers all 17 sections", used.length === 17, used.length);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

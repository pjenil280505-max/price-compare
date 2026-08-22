import type { Permission } from "@/lib/server/rbac";

/**
 * Admin navigation definition, shared by the shell and the mobile drawer.
 *
 * Kept as data (not JSX) so the same list drives desktop nav, mobile
 * drawer, and the "you don't have access" filtering — one source of truth
 * for what sections exist and who may see them.
 *
 * Permission is advisory in the UI: hiding a link is a usability courtesy,
 * NOT the access control. Every section's API route enforces its own
 * permission server-side, so a hand-typed URL gains nothing.
 */

export interface AdminNavItem {
  label: string;
  href: string;
  /** Lucide icon name, resolved in AdminShell to keep this file JSX-free. */
  icon: string;
  permission: Permission;
  group: "Operations" | "Catalog" | "Commerce" | "Insight" | "System";
  /** Sections still to be built out — shown, but honestly labelled. */
  comingSoon?: boolean;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { label: "Overview", href: "/admin", icon: "LayoutDashboard", permission: "view_dashboard", group: "Operations" },

  { label: "Merchants", href: "/admin/merchants", icon: "Store", permission: "manage_connectors", group: "Operations" },
  { label: "Sync jobs", href: "/admin/connectors", icon: "Plug", permission: "manage_connectors", group: "Operations" },
  { label: "Sync errors", href: "/admin/sync-errors", icon: "TriangleAlert", permission: "manage_connectors", group: "Operations" },
  { label: "API credentials", href: "/admin/credentials", icon: "KeyRound", permission: "view_credentials", group: "Operations" },

  { label: "Products", href: "/admin/products", icon: "Package", permission: "review_matches", group: "Catalog" },
  { label: "Matching review", href: "/admin/matches", icon: "GitMerge", permission: "review_matches", group: "Catalog" },
  { label: "Prices", href: "/admin/prices", icon: "IndianRupee", permission: "view_analytics", group: "Catalog" },
  { label: "Price history", href: "/admin/history", icon: "History", permission: "view_analytics", group: "Catalog" },

  { label: "Affiliate config", href: "/admin/affiliate", icon: "Link2", permission: "manage_affiliate", group: "Commerce" },
  { label: "Deals", href: "/admin/deals", icon: "Tag", permission: "manage_deals", group: "Commerce" },

  { label: "Analytics", href: "/admin/analytics", icon: "BarChart3", permission: "view_analytics", group: "Insight" },
  { label: "SEO", href: "/admin/seo", icon: "Search", permission: "view_analytics", group: "Insight" },

  { label: "Users", href: "/admin/users", icon: "Users", permission: "view_users", group: "System" },
  { label: "Alerts", href: "/admin/alerts", icon: "Bell", permission: "view_users", group: "System" },
  { label: "System health", href: "/admin/health", icon: "Activity", permission: "view_dashboard", group: "System" },
  { label: "Settings", href: "/admin/settings", icon: "Settings", permission: "manage_settings", group: "System" },
];

export const ADMIN_GROUPS = ["Operations", "Catalog", "Commerce", "Insight", "System"] as const;

/** Longest-prefix match, so /admin doesn't highlight for every subpage. */
export function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Store, Plug, TriangleAlert, KeyRound, Package, GitMerge,
  IndianRupee, History, Link2, Tag, BarChart3, Search, Users, Bell, Activity,
  Settings, Menu, ChevronLeft, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ADMIN_GROUPS, ADMIN_NAV, isActiveHref, type AdminNavItem } from "./adminNav";
import { Modal } from "@/components/ui/Modal";

const ICONS: Record<string, typeof LayoutDashboard> = {
  LayoutDashboard, Store, Plug, TriangleAlert, KeyRound, Package, GitMerge,
  IndianRupee, History, Link2, Tag, BarChart3, Search, Users, Bell, Activity, Settings,
};

/**
 * Admin shell, designed phone-first because that is where it is operated.
 *
 * Mobile: a sticky top bar showing the CURRENT section name (so you always
 * know where you are), with navigation in a full-height drawer. The
 * previous horizontally-scrolling strip was unusable at 17 sections —
 * items scrolled off-screen with no indication they existed.
 *
 * Desktop: a persistent grouped sidebar.
 */
export function AdminShell({
  children,
  permissions,
  roleName,
}: {
  children: ReactNode;
  /** Permissions of the signed-in admin, from the server. */
  permissions: string[];
  roleName: string;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer whenever navigation happens, otherwise it stays open
  // over the new page on mobile.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const permissionSet = new Set(permissions);
  const visible = ADMIN_NAV.filter((item) => permissionSet.has(item.permission));
  const current = visible.find((item) => isActiveHref(pathname, item.href));

  return (
    <div className="min-h-screen bg-ink-50/40 dark:bg-ink-950">
      <div className="lg:grid lg:grid-cols-[260px_1fr]">
        {/* ---------- Desktop sidebar ---------- */}
        <aside className="hidden border-r border-ink-100 bg-paper dark:border-ink-800 dark:bg-ink-900 lg:block lg:min-h-screen">
          <div className="sticky top-0 flex max-h-screen flex-col overflow-y-auto px-4 py-5">
            <Link href="/admin" className="mb-1 font-display text-lg font-semibold text-ink dark:text-paper">
              Admin
            </Link>
            <RoleBadge roleName={roleName} className="mb-5" />
            <NavGroups items={visible} pathname={pathname} />
            <BackToSite className="mt-6" />
          </div>
        </aside>

        {/* ---------- Mobile top bar ---------- */}
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-100 bg-paper/95 px-4 py-3 backdrop-blur dark:border-ink-800 dark:bg-ink-900/95 lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open admin menu"
            aria-expanded={drawerOpen}
            // 44px minimum touch target.
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-md text-ink hover:bg-ink-100 dark:text-paper dark:hover:bg-ink-800"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-ink-400">Admin</p>
            <p className="truncate text-sm font-semibold text-ink dark:text-paper">
              {current?.label ?? "Dashboard"}
            </p>
          </div>

          <RoleBadge roleName={roleName} />
        </div>

        {/* ---------- Mobile drawer ---------- */}
        <Modal
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title="Admin sections"
          description={`Signed in as ${roleName}`}
          variant="sheet"
          className="max-h-[88vh]"
        >
          <NavGroups items={visible} pathname={pathname} onNavigate={() => setDrawerOpen(false)} large />
          <BackToSite className="mt-6" />
        </Modal>

        <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-10">{children}</main>
      </div>
    </div>
  );
}

function NavGroups({
  items,
  pathname,
  onNavigate,
  large,
}: {
  items: AdminNavItem[];
  pathname: string;
  onNavigate?: () => void;
  large?: boolean;
}) {
  return (
    <nav aria-label="Admin" className="flex flex-col gap-5">
      {ADMIN_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (groupItems.length === 0) return null;

        return (
          <div key={group}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
              {group}
            </p>
            <ul className="flex flex-col gap-0.5">
              {groupItems.map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard;
                const active = isActiveHref(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                        large ? "h-12" : "h-10",
                        active
                          ? "bg-ink text-paper dark:bg-saffron dark:text-ink-950"
                          : "text-ink-500 hover:bg-ink-50 hover:text-ink dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-paper",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.comingSoon && (
                        <span className="shrink-0 rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold text-ink-500 dark:bg-ink-800 dark:text-ink-400">
                          soon
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function RoleBadge({ roleName, className }: { roleName: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full bg-saffron-50 px-2.5 py-1 text-xs font-semibold text-saffron-700 dark:bg-saffron-700/15 dark:text-saffron-300",
        className,
      )}
    >
      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
      {roleName}
    </span>
  );
}

function BackToSite({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-400 transition-colors hover:text-ink dark:hover:text-paper",
        className,
      )}
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      Back to site
    </Link>
  );
}

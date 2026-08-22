"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Heart, LayoutDashboard, Bell, BellRing, Settings, LogOut } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Container } from "@/components/layout/Container";
import type { NavItem } from "@/components/layout/Navigation";

const navItems: NavItem[] = [
  { label: "Overview", href: "/account" },
  { label: "Wishlist", href: "/wishlist" },
  { label: "Price alerts", href: "/alerts" },
  { label: "Notifications", href: "/notifications" },
  { label: "Settings", href: "/account/settings" },
];

const navIcons = [LayoutDashboard, Heart, Bell, BellRing, Settings];

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    // refresh() re-runs middleware so the now-signed-out session is
    // reflected server-side, not just in client state.
    router.push("/");
    router.refresh();
  }

  return (
    <Container className="py-8 sm:py-10">
      <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-10">
        <aside className="mb-8 lg:mb-0">
          <nav aria-label="Account" className="lg:sticky lg:top-24">
            <ul className="flex gap-1 overflow-x-auto scrollbar-thin lg:flex-col lg:overflow-visible">
              {navItems.map((item, index) => {
                const Icon = navIcons[index];
                const isActive = pathname === item.href;
                return (
                  <li key={item.href} className="shrink-0 lg:w-full">
                    <Link
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={
                        "flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2.5 text-sm font-medium transition-colors " +
                        (isActive
                          ? "bg-ink text-paper dark:bg-saffron dark:text-ink-950"
                          : "text-ink-500 hover:bg-ink-50 hover:text-ink dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-paper")
                      }
                    >
                      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
                      {item.label}
                    </Link>
                  </li>
                );
              })}
              <li className="shrink-0 lg:mt-4 lg:w-full lg:border-t lg:border-ink-100 lg:pt-4 lg:dark:border-ink-800">
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2.5 text-sm font-medium text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-paper"
                >
                  <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Sign out
                </button>
              </li>
            </ul>
          </nav>
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </Container>
  );
}

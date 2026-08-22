"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Heart, Menu, Moon, Sun, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Navigation, type NavItem } from "./Navigation";
import { Modal } from "@/components/ui/Modal";

export interface HeaderProps {
  navItems: NavItem[];
  activeHref?: string;
  logoHref?: string;
  logoLabel?: string;
  /** Rendered as a full-width row under the header on mobile, inline on desktop — pass a <SearchBar />. */
  search: ReactNode;
  wishlistHref?: string;
  wishlistCount?: number;
  accountHref?: string;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  className?: string;
}

export function Header({
  navItems,
  activeHref,
  logoHref = "/",
  logoLabel = "Price Compare",
  search,
  wishlistHref = "/wishlist",
  wishlistCount = 0,
  accountHref = "/account",
  theme,
  onToggleTheme,
  className,
}: HeaderProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <header
      className={cn(
        "header-blur sticky top-0 z-30 border-b border-ink-100 bg-paper/90 backdrop-blur-md dark:border-ink-800 dark:bg-ink-950/90",
        className,
      )}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="-ml-1.5 rounded-md p-1.5 text-ink hover:bg-ink-100 dark:text-paper dark:hover:bg-ink-800 lg:hidden"
            aria-label="Open menu"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>

          <Link
            href={logoHref}
            className="shrink-0 font-display text-xl font-semibold tracking-tight text-ink dark:text-paper"
          >
            {logoLabel}
          </Link>

          <Navigation
            items={navItems}
            activeHref={activeHref}
            orientation="horizontal"
            className="hidden lg:block"
          />

          {/* Rendered again for mobile below — two independent instances, one
              visible per breakpoint via CSS, not a single relocated node. */}
          <div className="hidden flex-1 lg:block">{search}</div>

          <div className="ml-auto flex items-center gap-1">
            {onToggleTheme && (
              <button
                type="button"
                onClick={onToggleTheme}
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                className="rounded-md p-2 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-paper"
              >
                {theme === "dark" ? (
                  <Sun className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Moon className="h-5 w-5" aria-hidden="true" />
                )}
              </button>
            )}

            <Link
              href={wishlistHref}
              aria-label={`Wishlist${wishlistCount ? `, ${wishlistCount} items` : ""}`}
              className="relative rounded-md p-2 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-paper"
            >
              <Heart className="h-5 w-5" aria-hidden="true" />
              {wishlistCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-vermilion px-1 text-[10px] font-semibold text-white">
                  {wishlistCount > 99 ? "99+" : wishlistCount}
                </span>
              )}
            </Link>

            <Link
              href={accountHref}
              aria-label="Your account"
              className="rounded-md p-2 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-paper"
            >
              <User className="h-5 w-5" aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className="lg:hidden">{search}</div>
      </div>

      <Modal
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        title={logoLabel}
        variant="sheet"
        className="max-h-[80vh]"
      >
        <Navigation
          items={navItems}
          activeHref={activeHref}
          orientation="vertical"
          onNavigate={() => setMobileNavOpen(false)}
        />
      </Modal>
    </header>
  );
}

"use client";

import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Header } from "./Header";
import { ConnectedSearchBar } from "@/components/search/ConnectedSearchBar";
import type { NavItem } from "./Navigation";

const navItems: NavItem[] = [
  { label: "Deals", href: "/deals" },
  { label: "Categories", href: "/categories" },
  { label: "Stores", href: "/stores" },
  { label: "AI Assistant", href: "/assistant" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  // Avoids a hydration mismatch: the server can't know the user's persisted
  // theme, so the toggle only renders once the client has resolved it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <Header
      navItems={navItems}
      activeHref={pathname}
      search={<ConnectedSearchBar />}
      theme={mounted ? (resolvedTheme as "light" | "dark") : undefined}
      onToggleTheme={
        mounted ? () => setTheme(resolvedTheme === "dark" ? "light" : "dark") : undefined
      }
    />
  );
}

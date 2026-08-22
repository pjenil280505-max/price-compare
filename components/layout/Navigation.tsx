"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useReducedMotionSafe } from "@/lib/motion";

export interface NavItem {
  label: string;
  href: string;
  badge?: string | number;
}

export interface NavigationProps {
  items: NavItem[];
  activeHref?: string;
  orientation?: "horizontal" | "vertical";
  onNavigate?: () => void;
  className?: string;
}

export function Navigation({
  items,
  activeHref,
  orientation = "horizontal",
  onNavigate,
  className,
}: NavigationProps) {
  const reduced = useReducedMotionSafe();
  const isHorizontal = orientation === "horizontal";

  return (
    <nav aria-label="Main" className={className}>
      <ul
        className={cn(
          "flex",
          isHorizontal ? "items-center gap-1" : "flex-col gap-1",
        )}
      >
        {items.map((item) => {
          const isActive = item.href === activeHref;
          return (
            <li key={item.href} className="relative">
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200",
                  isActive
                    ? "text-ink dark:text-paper"
                    : "text-ink-500 hover:text-ink dark:text-ink-300 dark:hover:text-paper",
                  !isHorizontal && "w-full py-3 text-base",
                )}
              >
                {item.label}
                {item.badge != null && (
                  <span className="rounded-full bg-saffron px-1.5 py-0.5 text-[11px] font-semibold text-ink-950">
                    {item.badge}
                  </span>
                )}
              </Link>
              {isActive && (
                <motion.span
                  layoutId={`nav-indicator-${orientation}`}
                  transition={{ duration: reduced ? 0.01 : 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "absolute bg-saffron",
                    isHorizontal
                      ? "inset-x-3 -bottom-[1px] h-0.5 rounded-full"
                      : "inset-y-1.5 left-0 w-0.5 rounded-full",
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

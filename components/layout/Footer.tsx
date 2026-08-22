import Link from "next/link";
import { cn } from "@/lib/utils";

export interface FooterLinkGroup {
  title: string;
  links: { label: string; href: string }[];
}

export interface FooterProps {
  logoLabel?: string;
  tagline?: string;
  groups: FooterLinkGroup[];
  className?: string;
}

export function Footer({
  logoLabel = "Price Compare",
  tagline = "Every price, every store, one search.",
  groups,
  className,
}: FooterProps) {
  return (
    <footer className={cn("border-t border-ink-100 bg-paper dark:border-ink-800 dark:bg-ink-950", className)}>
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
          <div className="col-span-2 sm:col-span-3 lg:col-span-2">
            <span className="font-display text-lg font-semibold text-ink dark:text-paper">
              {logoLabel}
            </span>
            <p className="mt-2 max-w-xs text-sm text-ink-500 dark:text-ink-400">{tagline}</p>
          </div>

          {groups.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h3 className="text-sm font-semibold text-ink dark:text-paper">{group.title}</h3>
              <ul className="mt-3 flex flex-col gap-2.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-ink-500 transition-colors hover:text-ink dark:text-ink-400 dark:hover:text-paper"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-ink-100 pt-6 dark:border-ink-800">
          <p className="text-xs leading-relaxed text-ink-400 dark:text-ink-500">
            Some links on this site are affiliate links. If you buy through them, we may earn a
            commission at no extra cost to you. Prices and availability are shown as last checked
            and may change on the merchant&apos;s site.
          </p>
          <p className="text-xs text-ink-400 dark:text-ink-500">
            © {new Date().getFullYear()} {logoLabel}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

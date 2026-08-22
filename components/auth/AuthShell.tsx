import type { ReactNode } from "react";
import Link from "next/link";

export interface AuthShellProps {
  children: ReactNode;
  title: string;
  subtitle: string;
}

export function AuthShell({ children, title, subtitle }: AuthShellProps) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink px-10 py-10 dark:bg-ink-950 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(226,163,59,0.25), transparent 45%), radial-gradient(circle at 80% 70%, rgba(46,158,104,0.2), transparent 45%)",
          }}
          aria-hidden="true"
        />
        <Link href="/" className="relative font-display text-xl font-semibold text-paper">
          Price Compare
        </Link>
        <div className="relative max-w-sm">
          <p className="font-display text-3xl font-semibold leading-tight text-paper">
            Every price, every store, one search.
          </p>
          <p className="mt-4 text-sm text-ink-300">
            We track prices across every store we support, so the price you see is
            the price you&apos;ll actually pay — not a guess from last week.
          </p>
        </div>
        <p className="relative text-xs text-ink-400">
          Some links are affiliate links — see our disclosure in the footer.
        </p>
      </div>

      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="mb-8 inline-block font-display text-lg font-semibold text-ink dark:text-paper lg:hidden">
            Price Compare
          </Link>
          <h1 className="font-display text-2xl font-semibold text-ink dark:text-paper">{title}</h1>
          <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

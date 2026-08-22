import Link from "next/link";
import { Section } from "@/components/layout/Section";
import { ConnectedSearchBar } from "@/components/search/ConnectedSearchBar";

export default function MarketingNotFound() {
  return (
    <Section className="flex flex-col items-center text-center">
      <p className="font-mono text-sm text-ink-400">404</p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink dark:text-paper sm:text-4xl">
        We couldn&apos;t find that page
      </h1>
      <p className="mt-3 max-w-md text-ink-500 dark:text-ink-400">
        It might have moved, or the link might be off. Try searching for what you were
        looking for, or head back to browsing categories.
      </p>
      <div className="mt-8 w-full max-w-md">
        <ConnectedSearchBar />
      </div>
      <Link
        href="/categories"
        className="mt-6 text-sm font-medium text-ink underline underline-offset-4 dark:text-paper"
      >
        Browse categories instead
      </Link>
    </Section>
  );
}

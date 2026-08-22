import Link from "next/link";

export default function RootNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-sm text-ink-400">404</p>
      <h1 className="text-2xl font-semibold text-ink dark:text-paper">Page not found</h1>
      <Link href="/" className="text-sm font-medium text-ink underline underline-offset-4 dark:text-paper">
        Go back home
      </Link>
    </div>
  );
}

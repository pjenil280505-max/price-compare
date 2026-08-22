import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

/**
 * Confirmation page for a human following an unsubscribe link.
 *
 * The unsubscribe itself is performed by the API route, which this page
 * calls server-side. Rendered outside the marketing layout: someone
 * unsubscribing shouldn't be shown a full site header inviting them back in.
 */
export const metadata = { title: "Unsubscribed", robots: { index: false, follow: false } };

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  let done = false;
  if (token) {
    try {
      const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
      const res = await fetch(`${base}/api/unsubscribe?token=${encodeURIComponent(token)}`, {
        method: "POST",
        cache: "no-store",
      });
      done = res.ok;
    } catch {
      done = false;
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        {done ? (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10 text-jade-600 dark:text-jade-400" aria-hidden="true" />
            <h1 className="mt-4 font-display text-2xl font-semibold text-ink dark:text-paper">
              You&apos;re unsubscribed
            </h1>
            <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
              We won&apos;t email you about price alerts any more. Your saved products and alerts are
              untouched — you can still see them in your account, and you can turn emails back on any
              time in settings.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-semibold text-ink dark:text-paper">
              This link didn&apos;t work
            </h1>
            <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
              It may have expired. You can change your notification preferences directly in your
              account settings.
            </p>
          </>
        )}

        <div className="mt-8 flex flex-col items-center gap-3">
          <Link
            href="/account/settings"
            className="text-sm font-medium text-ink underline underline-offset-4 dark:text-paper"
          >
            Notification settings
          </Link>
          <Link href="/" className="text-sm text-ink-400 hover:text-ink dark:hover:text-paper">
            Back to site
          </Link>
        </div>
      </div>
    </main>
  );
}

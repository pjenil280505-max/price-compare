import { Section } from "@/components/layout/Section";
import { LegalNotice } from "@/components/layout/LegalNotice";

export const metadata = {
  title: "Cookies",
  description: "Which cookies this site sets and why.",
};

export default function CookiesPage() {
  return (
    <Section containerSize="narrow">
      <h1 className="font-display text-3xl font-semibold text-ink dark:text-paper">Cookies</h1>

      <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
        <p>
          This site sets a small number of cookies. It does not use advertising cookies, third-party
          trackers, or cross-site analytics.
        </p>

        <div className="overflow-x-auto rounded-lg border border-ink-100 dark:border-ink-800">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <caption className="sr-only">Cookies set by this site</caption>
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50 dark:border-ink-800 dark:bg-ink-800/60">
                <th scope="col" className="px-4 py-3 text-left font-semibold text-ink dark:text-paper">Cookie</th>
                <th scope="col" className="px-4 py-3 text-left font-semibold text-ink dark:text-paper">Purpose</th>
                <th scope="col" className="px-4 py-3 text-left font-semibold text-ink dark:text-paper">Retained</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-ink-100 dark:border-ink-800">
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <code className="text-xs">sb-*</code>
                </th>
                <td className="px-4 py-3">
                  Keeps you signed in. Set only after you create an account or sign in. Managed by
                  our authentication provider.
                </td>
                <td className="px-4 py-3 text-ink-400">Until sign-out or expiry</td>
              </tr>
              <tr className="border-b border-ink-100 last:border-b-0 dark:border-ink-800">
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <code className="text-xs">pc_sid</code>
                </th>
                <td className="px-4 py-3">
                  An opaque random token used to group outbound retailer clicks from one browsing
                  session, so we can tell repeat clicks from distinct ones. Not linked to your
                  account and not usable to identify you.
                </td>
                <td className="px-4 py-3 text-ink-400">30 days</td>
              </tr>
              <tr>
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <code className="text-xs">theme</code>
                </th>
                <td className="px-4 py-3">Remembers your light/dark preference.</td>
                <td className="px-4 py-3 text-ink-400">Until cleared</td>
              </tr>
            </tbody>
          </table>
        </div>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">Consent</h2>
          <p className="mt-2">
            All of the above are strictly necessary or functional — they exist to make the site work
            or to remember a preference you expressed. There are no advertising or profiling
            cookies, so no consent banner is currently shown.
          </p>
          <p className="mt-2">
            If advertising, embedded third-party content, or cross-site analytics are ever added, a
            consent mechanism would be required before those load, and this page would need updating
            first.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">Declining them</h2>
          <p className="mt-2">
            You can block or clear cookies in your browser settings. Blocking them means you
            won&apos;t be able to stay signed in, so wishlists and price alerts won&apos;t work;
            everything else on the site will.
          </p>
        </section>

        <LegalNotice />
      </div>
    </Section>
  );
}

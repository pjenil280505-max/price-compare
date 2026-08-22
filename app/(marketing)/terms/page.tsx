import { Section } from "@/components/layout/Section";
import { LegalNotice } from "@/components/layout/LegalNotice";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <Section containerSize="narrow">
      <h1 className="font-display text-3xl font-semibold text-ink dark:text-paper">Terms</h1>

      <div className="mt-8 flex flex-col gap-6 text-sm text-ink-600 dark:text-ink-300">
        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">About prices shown here</h2>
          <p className="mt-2">
            Prices and availability come from retailers&apos; own authorized data feeds and are shown
            as of the time we last verified them — every price on this site is labelled with that
            time. Prices change frequently; the retailer&apos;s own page is always authoritative.
            We do not sell anything ourselves and are not party to your purchase.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">Affiliate relationships</h2>
          <p className="mt-2">
            Some outbound links are affiliate links. If you buy through one we may earn a commission
            at no additional cost to you. This does not affect which retailer we show as cheapest —
            that is determined solely by verified current price.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">Your account</h2>
          <p className="mt-2">
            You are responsible for keeping your password secure. Do not use this service to scrape,
            resell, or bulk-extract the comparison data.
          </p>
        </section>

        <LegalNotice />
      </div>
    </Section>
  );
}

import { Section } from "@/components/layout/Section";
import { LegalNotice } from "@/components/layout/LegalNotice";

export const metadata = {
  title: "Affiliate Disclosure",
  description: "How this site earns money, and how that does and doesn't affect what you see.",
};

export default function AffiliateDisclosurePage() {
  return (
    <Section containerSize="narrow">
      <h1 className="font-display text-3xl font-semibold text-ink dark:text-paper">Affiliate Disclosure</h1>

      <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
        <p>
          Some of the links on this site are affiliate links. If you click one and buy something, the
          retailer may pay us a commission. This costs you nothing extra — the price you pay is the
          same as it would be if you had gone to the retailer directly.
        </p>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">
            What this does not affect
          </h2>
          <p className="mt-2">
            Commission does not influence which retailer we show as cheapest. That is determined
            solely by the lowest verified current price among retailers that have the item in stock.
            We do not accept payment to rank a retailer higher, and there is no paid placement
            anywhere on this site.
          </p>
          <p className="mt-2">
            If the cheapest price is at a retailer we earn nothing from, that is still the one shown
            as cheapest.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">How to tell</h2>
          <p className="mt-2">
            Outbound links pass through our own redirect so we can record the click. Affiliate links
            carry <code className="rounded bg-ink-50 px-1 py-0.5 text-xs dark:bg-ink-800">rel=&quot;sponsored&quot;</code>,
            which is the standard way of marking a paid link. Not every retailer we track has an
            affiliate programme; links to those earn us nothing.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">What we record</h2>
          <p className="mt-2">
            When you click through we record which offer was clicked, a coarse device type, and an
            opaque session token. We do not record your IP address or your browser&apos;s User-Agent
            string. See our{" "}
            <a href="/privacy" className="underline underline-offset-2">Privacy</a> page for detail.
          </p>
        </section>

        <LegalNotice />
      </div>
    </Section>
  );
}

import { Section } from "@/components/layout/Section";
import { LegalNotice } from "@/components/layout/LegalNotice";

export const metadata = {
  title: "Price & Availability Disclaimer",
  description: "How our prices are sourced, how current they are, and what to check before buying.",
};

export default function PriceDisclaimerPage() {
  return (
    <Section containerSize="narrow">
      <h1 className="font-display text-3xl font-semibold text-ink dark:text-paper">
        Price &amp; Availability Disclaimer
      </h1>

      <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
        <p>
          <strong className="font-semibold text-ink dark:text-paper">
            The retailer&apos;s own page is always authoritative.
          </strong>{" "}
          Always check the price and availability on the retailer&apos;s site before completing a
          purchase. We are not a party to your transaction and cannot honour a price shown here.
        </p>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">Where prices come from</h2>
          <p className="mt-2">
            Every price is imported automatically from a retailer&apos;s own authorized data feed or
            API. Nothing is entered by hand. We do not scrape retailer websites.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">How current they are</h2>
          <p className="mt-2">
            Prices are refreshed on a schedule that varies by retailer. Every price on this site is
            labelled with when we last verified it. Where a price has not been verified recently we
            say so on the listing, and where it is too old to rely on we stop presenting it as a
            current price at all rather than showing you a figure we don&apos;t trust.
          </p>
          <p className="mt-2">
            A price can still change between our last check and your visit. Retailers also apply
            offers, coupons, delivery charges, and regional pricing that may not appear in their
            feed.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">Price history</h2>
          <p className="mt-2">
            Where shown, price history reflects only what we recorded — it begins when we started
            tracking that item and cannot show movements before that. We show a &ldquo;lowest
            recorded price&rdquo; only once we have enough observations for the figure to mean
            something.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">Product information</h2>
          <p className="mt-2">
            Titles, images, descriptions and specifications come from retailer feeds and may contain
            errors we did not introduce. We match listings across retailers automatically; where a
            match is uncertain we keep listings separate rather than risk showing you prices for a
            different variant. Even so, always confirm the exact model, size or capacity on the
            retailer&apos;s page.
          </p>
        </section>

        <LegalNotice />
      </div>
    </Section>
  );
}

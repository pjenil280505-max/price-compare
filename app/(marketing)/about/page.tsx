import Link from "next/link";
import { Section } from "@/components/layout/Section";

export const metadata = {
  title: "About",
  description: "What this service does, where its data comes from, and how it makes money.",
};

export default function AboutPage() {
  return (
    <Section containerSize="narrow">
      <h1 className="font-display text-3xl font-semibold text-ink dark:text-paper">About</h1>

      <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
        <p>
          We compare prices for the same product across multiple Indian retailers, so you can see
          who is actually cheapest right now rather than checking each site yourself.
        </p>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">Where the data comes from</h2>
          <p className="mt-2">
            Everything is imported automatically from retailers&apos; own authorized APIs and
            affiliate product feeds. No product, price, image or link is entered by hand, and we do
            not scrape retailer websites.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">How we treat prices</h2>
          <p className="mt-2">
            Every price carries the time we last verified it. When a price gets too old to trust, we
            stop presenting it as current rather than showing you a number we no longer believe.
            That is a deliberate trade: sometimes we show fewer prices, but the ones shown mean
            something. See the{" "}
            <Link href="/price-disclaimer" className="underline underline-offset-2">
              price disclaimer
            </Link>{" "}
            for detail.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">Different variants stay separate</h2>
          <p className="mt-2">
            A 256GB phone and a 512GB phone are different products, and we never merge their prices.
            Where an automatic match is uncertain, we keep the listings apart rather than risk
            quoting you a price for something you didn&apos;t want.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">How this is funded</h2>
          <p className="mt-2">
            Some outbound links earn us a commission at no extra cost to you. That never affects
            which retailer we show as cheapest. Full detail in the{" "}
            <Link href="/affiliate-disclosure" className="underline underline-offset-2">
              affiliate disclosure
            </Link>
            .
          </p>
        </section>
      </div>
    </Section>
  );
}

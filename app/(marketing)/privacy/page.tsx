import { Section } from "@/components/layout/Section";
import { LegalNotice } from "@/components/layout/LegalNotice";

export const metadata = { title: "Privacy" };

/**
 * This page describes what the system ACTUALLY does — it is derived from
 * the schema and code, not boilerplate. It is not a substitute for a
 * lawyer-reviewed policy; see the notice at the end.
 */
export default function PrivacyPage() {
  return (
    <Section containerSize="narrow">
      <h1 className="font-display text-3xl font-semibold text-ink dark:text-paper">Privacy</h1>

      <div className="mt-8 flex flex-col gap-6 text-ink-600 dark:text-ink-300">
        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">What we store</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            <li>Your email address and password, handled by our authentication provider. We never see or store your password.</li>
            <li>An optional display name and avatar URL, if you set one.</li>
            <li>Products you save to your wishlist, and price alerts you create.</li>
            <li>Products you recently viewed — the product and a timestamp only, capped at 50 items and deleted after 90 days.</li>
            <li>Your notification preferences.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">What we deliberately do not store</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            <li>Your IP address.</li>
            <li>Your browser&apos;s User-Agent string. We record only a coarse device type (mobile, tablet, desktop).</li>
            <li>Search terms tied to your account.</li>
            <li>Where you came from before arriving here. External referrers are discarded.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">Outbound retailer links</h2>
          <p className="mt-2 text-sm">
            When you click through to a retailer we record which offer was clicked, a coarse device
            type, and an opaque session token that is not linked to your identity across sessions.
            Some links are affiliate links and may earn us a commission at no extra cost to you.
            Sub-identifiers sent to affiliate networks are stripped of anything that could identify
            you. These records are deleted after 180 days.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">Your data</h2>
          <p className="mt-2 text-sm">
            You can view and change your profile and notification preferences in your account
            settings, clear your recently viewed history at any time, and delete your wishlist items
            and price alerts individually.
          </p>
        </section>

        <LegalNotice />
      </div>
    </Section>
  );
}

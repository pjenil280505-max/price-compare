import { Section } from "@/components/layout/Section";

export const metadata = {
  title: "Contact",
  description: "How to reach us about a wrong price, a listing problem, or your data.",
};

export default function ContactPage() {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

  return (
    <Section containerSize="narrow">
      <h1 className="font-display text-3xl font-semibold text-ink dark:text-paper">Contact</h1>

      <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
        {email ? (
          <p>
            Email us at{" "}
            <a href={`mailto:${email}`} className="font-medium text-ink underline underline-offset-2 dark:text-paper">
              {email}
            </a>
            .
          </p>
        ) : (
          // Inventing a contact address would be worse than admitting one
          // isn't configured — mail to a made-up address silently vanishes.
          <p className="rounded-lg border border-saffron-300 bg-saffron-50 p-4 dark:border-saffron-700/40 dark:bg-saffron-700/10">
            <strong className="font-semibold text-ink dark:text-paper">
              No contact address is configured yet.
            </strong>{" "}
            Set <code className="text-xs">NEXT_PUBLIC_CONTACT_EMAIL</code> before launch — a
            comparison service that publishes prices needs a working route for correction requests
            and data enquiries.
          </p>
        )}

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">Reporting a wrong price</h2>
          <p className="mt-2">
            Prices come from retailer feeds and are labelled with when we last verified them. If a
            listing looks wrong, tell us the product page URL and what you saw at the retailer. That
            usually points to a feed problem worth fixing for everyone.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">Wrong product match</h2>
          <p className="mt-2">
            We match listings across retailers automatically. If two different products — or two
            different variants, like different storage sizes — have been merged into one listing,
            that is a bug we want to know about.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">Your data</h2>
          <p className="mt-2">
            You can change your notification preferences and clear your recently viewed history in
            your account settings. For anything else about your data, email us at the address above.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink dark:text-paper">Retailers</h2>
          <p className="mt-2">
            We only import data through authorized APIs, affiliate feeds, and networks. If you
            represent a retailer and want to correct or remove your data, get in touch.
          </p>
        </section>
      </div>
    </Section>
  );
}

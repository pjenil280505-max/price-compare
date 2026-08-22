import Link from "next/link";
import { fetchMerchants } from "@/lib/server/catalog";
import { createPublicClient } from "@/lib/supabase/public";
import { Star } from "lucide-react";
import { Section } from "@/components/layout/Section";
import { PageHeader } from "@/components/layout/PageHeader";
import { MerchantLogo } from "@/components/merchant/Merchant";
import { EmptyState } from "@/components/ui/EmptyState";

export const revalidate = 3600;

export const metadata = {
  title: "Stores",
  description: "Every store we track prices from.",
  alternates: { canonical: "/stores" },
};

export default async function StoresPage() {
  const merchants = await fetchMerchants(createPublicClient());

  return (
    <Section>
      <PageHeader title="Stores" description="Every store we track prices from, in one place." />

      {merchants.length === 0 ? (
        <EmptyState className="mt-10" title="No stores yet" />
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {merchants.map((merchant) => (
            <Link
              key={merchant.id}
              href={`/search?merchant=${merchant.id}`}
              className="flex items-center gap-4 rounded-lg border border-ink-100 p-4 transition-colors hover:border-saffron-300 dark:border-ink-800"
            >
              <MerchantLogo merchant={merchant} size={48} />
              <div>
                <p className="font-medium text-ink dark:text-paper">{merchant.name}</p>
                <div className="mt-1 flex items-center gap-3 text-sm text-ink-400">
                  {merchant.trustRating != null && (
                    <span className="flex items-center gap-1">
                      <Star className="h-3.5 w-3.5 fill-saffron text-saffron" aria-hidden="true" />
                      {merchant.trustRating.toFixed(1)}
                    </span>
                  )}
                  {merchant.productCount != null && (
                    <span>{merchant.productCount.toLocaleString("en-IN")} products</span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Section>
  );
}

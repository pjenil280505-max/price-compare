"use client";

import { useEffect, useState } from "react";
import type { WishlistItem } from "@/lib/types";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonProductGrid } from "@/components/ui/Skeleton";
import { InteractiveProductGrid } from "@/components/product/InteractiveProductGrid";

export default function WishlistPage() {
  const [items, setItems] = useState<WishlistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    setItems(null);
    api
      .getWishlist()
      .then(setItems)
      .catch(() => setError("Couldn't load your wishlist."));
  }

  useEffect(load, []);

  return (
    <>
      <PageHeader title="Wishlist" description="Products you've saved, with their current best price." />
      <div className="mt-8">
        {error ? (
          <ErrorState description={error} onRetry={load} />
        ) : items === null ? (
          <SkeletonProductGrid />
        ) : (
          <InteractiveProductGrid
            initialProducts={items.map((item) => ({ ...item.product, isWishlisted: true }))}
            emptyTitle="Your wishlist is empty"
            emptyDescription="Save products from search or a product page and they'll show up here."
          />
        )}
      </div>
    </>
  );
}

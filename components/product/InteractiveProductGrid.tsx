"use client";

import { useState } from "react";
import type { MerchantOffer, Product } from "@/lib/types";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { ProductGrid } from "./ProductGrid";

export interface InteractiveProductGridProps {
  initialProducts: Product[];
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

/**
 * Wraps the presentational ProductGrid with the one piece of client state
 * every listing page needs: toggling a product's wishlist membership. The
 * grid itself stays a pure/reusable component — this is the thin, reused
 * "glue" layer described in README.md's usage pattern.
 */
export function InteractiveProductGrid({
  initialProducts,
  emptyTitle,
  emptyDescription,
  className,
}: InteractiveProductGridProps) {
  const [products, setProducts] = useState(initialProducts);
  const { toast } = useToast();

  async function handleToggleWishlist(product: Product) {
    const wasWishlisted = Boolean(product.isWishlisted);

    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, isWishlisted: !wasWishlisted } : p)),
    );

    try {
      if (wasWishlisted) {
        await api.removeFromWishlist(product.id);
        toast({ title: "Removed from wishlist" });
      } else {
        await api.addToWishlist(product.id);
        toast({ title: "Saved to wishlist", variant: "success" });
      }
    } catch {
      // Roll back the optimistic update if the request failed.
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, isWishlisted: wasWishlisted } : p)),
      );
      toast({ title: "Couldn't update wishlist", description: "Please try again.", variant: "error" });
    }
  }

  function handleBuyClick(offer: MerchantOffer) {
    // Placeholder for client-side analytics — the actual click is already
    // logged server-side by the /go/{listingId} redirect endpoint itself.
    void offer;
  }

  return (
    <ProductGrid
      products={products}
      onToggleWishlist={handleToggleWishlist}
      onBuyClick={handleBuyClick}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      className={className}
    />
  );
}

"use client";

import { useState } from "react";
import type { Product } from "@/lib/types";
import { api } from "@/lib/api";
import { getCheapestOffer, getDiscountPercent } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { PriceBadge, DiscountBadge } from "@/components/badges/PriceBadges";
import { BuyButton } from "./BuyButton";
import { WishlistButton } from "@/components/wishlist/WishlistButton";
import { PriceAlertButton } from "@/components/alerts/PriceAlert";

export function ProductBuyBox({ product }: { product: Product }) {
  const { toast } = useToast();
  const [isWishlisted, setIsWishlisted] = useState(Boolean(product.isWishlisted));
  const cheapest = getCheapestOffer(product);
  const discount = cheapest ? getDiscountPercent(cheapest) : undefined;

  async function handleToggleWishlist() {
    const next = !isWishlisted;
    setIsWishlisted(next);
    try {
      if (next) {
        await api.addToWishlist(product.id);
        toast({ title: "Saved to wishlist", variant: "success" });
      } else {
        await api.removeFromWishlist(product.id);
        toast({ title: "Removed from wishlist" });
      }
    } catch {
      setIsWishlisted(!next);
      toast({ title: "Couldn't update wishlist", variant: "error" });
    }
  }

  async function handleSaveAlert(targetPrice: number) {
    try {
      await api.createPriceAlert({ productId: product.id, targetPrice, active: true });
      toast({ title: "Price alert set", description: "We'll email you when it hits your target.", variant: "success" });
    } catch {
      toast({ title: "Couldn't set that alert", variant: "error" });
    }
  }

  if (!cheapest) {
    return <p className="text-sm text-ink-400">Currently unavailable at any store we track.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <PriceBadge price={cheapest.price} mrp={cheapest.mrp} size="lg" />
        {discount != null && discount > 0 && <DiscountBadge percent={discount} />}
      </div>
      <p className="text-sm text-ink-500 dark:text-ink-400">
        Lowest price at <span className="font-medium text-ink dark:text-paper">{cheapest.merchant.name}</span>
        {product.offers.length > 1 && ` · ${product.offers.length} stores compared`}
      </p>

      <BuyButton offer={cheapest} size="lg" fullWidth />

      <div className="flex items-center gap-2">
        <WishlistButton isWishlisted={isWishlisted} onToggle={handleToggleWishlist} />
        <PriceAlertButton
          productTitle={product.title}
          currentPrice={cheapest.price}
          onSave={handleSaveAlert}
          className="flex-1"
        />
      </div>
    </div>
  );
}

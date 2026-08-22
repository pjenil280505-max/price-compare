"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Star } from "lucide-react";
import type { MerchantOffer, Product } from "@/lib/types";
import { cn, getCheapestOffer, getDiscountPercent } from "@/lib/utils";
import { useReducedMotionSafe } from "@/lib/motion";
import { WishlistButton } from "@/components/wishlist/WishlistButton";
import { PriceBadge, DiscountBadge, CheapestBadge } from "@/components/badges/PriceBadges";
import { BuyButton } from "./BuyButton";

export interface ProductCardProps {
  product: Product;
  onToggleWishlist?: (product: Product) => void | Promise<void>;
  onBuyClick?: (offer: MerchantOffer) => void;
  /** Pass true for the first row of an above-the-fold grid to skip lazy-loading. */
  priority?: boolean;
  className?: string;
}

export function ProductCard({ product, onToggleWishlist, onBuyClick, priority, className }: ProductCardProps) {
  const reduced = useReducedMotionSafe();
  const cheapest = getCheapestOffer(product);
  const discount = cheapest ? getDiscountPercent(cheapest) : undefined;
  const merchantCount = product.offers.length;

  return (
    <motion.article
      whileHover={reduced ? undefined : { y: -4 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "card-contain hover-lift group relative flex flex-col overflow-hidden rounded-lg border border-ink-100 bg-paper shadow-card transition-shadow duration-200 hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900",
        className,
      )}
    >
      <div className="relative aspect-square overflow-hidden bg-ink-50 dark:bg-ink-800">
        {discount != null && discount > 0 && <DiscountBadge percent={discount} variant="ribbon" />}

        {onToggleWishlist && (
          <div className="absolute right-2 top-2 z-10">
            <WishlistButton
              size="sm"
              isWishlisted={Boolean(product.isWishlisted)}
              onToggle={() => onToggleWishlist(product)}
            />
          </div>
        )}

        <Link href={`/products/${product.slug}`} aria-label={product.title}>
          <Image
            src={product.imageUrl}
            alt={product.title}
            fill
            priority={priority}
            sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 46vw"
            className="object-contain p-4 transition-transform duration-300 group-hover:scale-105"
          />
        </Link>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <Link href={`/products/${product.slug}`} className="line-clamp-2 text-sm font-medium text-ink hover:underline dark:text-paper">
          {product.title}
        </Link>

        {product.rating != null && (
          <div className="flex items-center gap-1 text-xs text-ink-400">
            <Star className="h-3.5 w-3.5 fill-saffron text-saffron" aria-hidden="true" />
            <span>{product.rating.toFixed(1)}</span>
            {product.reviewCount != null && <span>({product.reviewCount.toLocaleString("en-IN")})</span>}
          </div>
        )}

        {cheapest ? (
          <div className="mt-auto flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <PriceBadge price={cheapest.price} mrp={cheapest.mrp} />
              {merchantCount > 1 && <CheapestBadge />}
            </div>

            {merchantCount > 1 ? (
              <Link
                href={`/products/${product.slug}#compare`}
                className="text-xs font-medium text-ink-500 hover:text-ink hover:underline dark:text-ink-400 dark:hover:text-paper"
              >
                Compare {merchantCount} offers
              </Link>
            ) : (
              <span className="text-xs text-ink-400">at {cheapest.merchant.name}</span>
            )}

            <BuyButton offer={cheapest} size="sm" fullWidth onBeforeNavigate={onBuyClick} />
          </div>
        ) : (
          <p className="mt-auto text-xs text-ink-400">Currently unavailable</p>
        )}
      </div>
    </motion.article>
  );
}

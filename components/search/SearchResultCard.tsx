"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Star, Clock, AlertTriangle, ExternalLink } from "lucide-react";
import type { SearchResultItem } from "@/lib/search/types";
import { describeAge } from "@/lib/pricing/engine";
import { cn, formatPrice } from "@/lib/utils";
import { useReducedMotionSafe } from "@/lib/motion";
import { WishlistButton } from "@/components/wishlist/WishlistButton";
import { DiscountBadge } from "@/components/badges/PriceBadges";
import { PriceAlertButton } from "@/components/alerts/PriceAlert";

export interface SearchResultCardProps {
  item: SearchResultItem;
  isWishlisted?: boolean;
  onToggleWishlist?: (item: SearchResultItem) => void | Promise<void>;
  /** Persists a price alert. The button owns its own dialog. */
  onSaveAlert?: (item: SearchResultItem, targetPrice: number) => void | Promise<void>;
  priority?: boolean;
  className?: string;
}

/**
 * One search result. Price presentation follows the price engine's rules
 * exactly:
 *   - a product with no eligible offer shows NO price, not a stale one
 *   - stale prices are shown but explicitly labelled
 *   - the price shown is for ONE variant, labelled, never mixed
 */
export function SearchResultCard({
  item,
  isWishlisted = false,
  onToggleWishlist,
  onSaveAlert,
  priority,
  className,
}: SearchResultCardProps) {
  const reduced = useReducedMotionSafe();
  const hasPrice = item.bestPrice != null;
  const isStale = item.freshness === "stale";

  return (
    <motion.article
      whileHover={reduced ? undefined : { y: -3 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "card-contain hover-lift group relative flex gap-4 rounded-lg border border-ink-100 bg-paper p-3 shadow-card transition-shadow hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900 sm:flex-col sm:p-3.5",
        className,
      )}
    >
      <div className="relative aspect-square h-24 w-24 shrink-0 overflow-hidden rounded-md bg-ink-50 dark:bg-ink-800 sm:h-auto sm:w-full">
        {item.discountPercent != null && item.discountPercent > 0 && (
          <DiscountBadge percent={item.discountPercent} variant="ribbon" />
        )}
        {onToggleWishlist && (
          <div className="absolute right-1.5 top-1.5 z-10">
            <WishlistButton
              size="sm"
              isWishlisted={isWishlisted}
              onToggle={() => onToggleWishlist(item)}
            />
          </div>
        )}
        <Link href={`/products/${item.slug}`} aria-label={item.title}>
          {item.imageUrl ? (
            <Image
              src={item.imageUrl}
              alt={item.title}
              fill
              priority={priority}
              sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 96px"
              className="object-contain p-2 transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <span className="flex h-full items-center justify-center text-xs text-ink-300">No image</span>
          )}
        </Link>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {item.brand && (
          <span className="text-xs font-medium uppercase tracking-wide text-ink-400">{item.brand}</span>
        )}

        <Link
          href={`/products/${item.slug}`}
          className="line-clamp-2 text-sm font-medium text-ink hover:underline dark:text-paper"
        >
          {item.title}
        </Link>

        {/* Which variant this price refers to — never leave it ambiguous. */}
        {item.variantLabel && item.variantLabel !== "Standard" && (
          <span className="w-fit rounded bg-ink-50 px-1.5 py-0.5 text-xs text-ink-500 dark:bg-ink-800 dark:text-ink-300">
            {item.variantLabel}
          </span>
        )}

        {item.rating != null && (
          <span className="flex items-center gap-1 text-xs text-ink-400">
            <Star className="h-3.5 w-3.5 fill-saffron text-saffron" aria-hidden="true" />
            {item.rating.toFixed(1)}
            {item.reviewCount ? ` (${item.reviewCount.toLocaleString("en-IN")})` : ""}
          </span>
        )}

        <div className="mt-auto flex flex-col gap-1.5 pt-1">
          {hasPrice ? (
            <>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-tabular text-lg font-semibold text-ink dark:text-paper">
                  {formatPrice(item.bestPrice as number)}
                </span>
                {item.mrp != null && item.mrp > (item.bestPrice as number) && (
                  <span className="font-tabular text-xs text-ink-400 line-through">
                    {formatPrice(item.mrp)}
                  </span>
                )}
              </div>

              <span className="text-xs text-ink-500 dark:text-ink-400">
                {item.merchantName ? `Cheapest at ${item.merchantName}` : "Best available price"}
                {item.offerCount > 1 && ` · ${item.offerCount} offers`}
              </span>

              {/* Freshness label is mandatory whenever a price is shown. */}
              <span
                className={cn(
                  "flex items-center gap-1 text-xs",
                  isStale ? "text-saffron-700 dark:text-saffron-300" : "text-ink-400",
                )}
              >
                <Clock className="h-3 w-3" aria-hidden="true" />
                {isStale
                  ? `Checked ${describeAge(item.lastCheckedAt)} — may have changed`
                  : `Updated ${describeAge(item.lastCheckedAt)}`}
              </span>
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-ink-400">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              No current price — check the product page
            </span>
          )}

          <div className="flex items-center gap-2 pt-1">
            {hasPrice && item.buyUrl ? (
              <a
                href={item.buyUrl}
                target="_blank"
                rel="sponsored noopener noreferrer"
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-paper transition-colors hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron dark:bg-saffron dark:text-ink-950 dark:hover:bg-saffron-500"
              >
                Buy now
                <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
              </a>
            ) : (
              <Link
                href={`/products/${item.slug}`}
                className="inline-flex h-9 flex-1 items-center justify-center rounded-md border border-ink-200 px-3 text-sm font-medium text-ink-600 dark:border-ink-700 dark:text-ink-300"
              >
                View details
              </Link>
            )}

            {onSaveAlert && hasPrice && (
              // Reuses the existing PriceAlertButton, which owns its own
              // dialog — wrapping it in another modal would nest dialogs.
              <PriceAlertButton
                productTitle={item.title}
                currentPrice={item.bestPrice as number}
                onSave={(targetPrice) => onSaveAlert(item, targetPrice)}
                className="h-9 shrink-0 px-2.5 text-xs"
              />
            )}
          </div>
        </div>
      </div>
    </motion.article>
  );
}

import Link from "next/link";
import { ArrowDown } from "lucide-react";
import type { Deal } from "@/lib/types";
import { cn, formatPrice, getDiscountPercent } from "@/lib/utils";

export interface PriceTickerProps {
  deals: Deal[];
  className?: string;
}

/**
 * Deliberately built with a CSS `animate-marquee` utility, not framer-motion:
 * it's a continuous/infinite animation, and the global
 * `prefers-reduced-motion` rule in globals.css already caps every CSS
 * animation's iteration count to 1 — so reduced-motion support here is free,
 * with no client-side JS check needed. See the animation architecture notes
 * in premium-ui-ux-architecture.md.
 */
export function PriceTicker({ deals, className }: PriceTickerProps) {
  if (deals.length === 0) return null;

  // Rendered twice back-to-back so the -50% translate loops seamlessly.
  const track = [...deals, ...deals];

  return (
    <div
      className={cn(
        "group overflow-hidden border-y border-ink-100 bg-ink-50/60 py-2.5 dark:border-ink-800 dark:bg-ink-900/60",
        className,
      )}
    >
      <div className="flex w-max animate-marquee gap-8 group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]">
        {track.map((deal, index) => {
          const discount = getDiscountPercent(deal.offer);
          return (
            <Link
              key={`${deal.id}-${index}`}
              href={`/products/${deal.product.slug}`}
              aria-hidden={index >= deals.length || undefined}
              tabIndex={index >= deals.length ? -1 : 0}
              className="flex shrink-0 items-center gap-2 text-sm text-ink-600 hover:text-ink dark:text-ink-300 dark:hover:text-paper"
            >
              <ArrowDown className="h-3.5 w-3.5 text-jade-600 dark:text-jade-400" aria-hidden="true" />
              <span className="font-medium">{deal.product.title}</span>
              <span className="font-tabular text-ink-400">{formatPrice(deal.offer.price)}</span>
              {discount != null && discount > 0 && (
                <span className="font-tabular text-jade-600 dark:text-jade-400">−{discount}%</span>
              )}
              <span className="text-ink-300 dark:text-ink-600">on {deal.offer.merchant.name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

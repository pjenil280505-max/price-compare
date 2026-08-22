"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Clock } from "lucide-react";
import type { Deal, MerchantOffer } from "@/lib/types";
import { cn, getDiscountPercent } from "@/lib/utils";
import { useReducedMotionSafe } from "@/lib/motion";
import { DiscountBadge, PriceBadge } from "@/components/badges/PriceBadges";
import { BuyButton } from "@/components/product/BuyButton";

export interface DealCardProps {
  deal: Deal;
  onBuyClick?: (offer: MerchantOffer) => void;
  className?: string;
}

function useCountdown(endsAt?: string): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!endsAt) {
      setLabel(null);
      return;
    }

    function tick() {
      const diffMs = new Date(endsAt as string).getTime() - Date.now();
      if (diffMs <= 0) {
        setLabel("Deal ended");
        return;
      }
      const hours = Math.floor(diffMs / 3_600_000);
      const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
      setLabel(hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`);
    }

    tick();
    const interval = window.setInterval(tick, 60_000);
    return () => window.clearInterval(interval);
  }, [endsAt]);

  return label;
}

export function DealCard({ deal, onBuyClick, className }: DealCardProps) {
  const reduced = useReducedMotionSafe();
  const countdown = useCountdown(deal.endsAt);
  const discount = getDiscountPercent(deal.offer);

  return (
    <motion.article
      whileHover={reduced ? undefined : { y: -4 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "card-contain hover-lift flex flex-col overflow-hidden rounded-lg border border-ink-100 bg-paper shadow-card transition-shadow duration-200 hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900",
        className,
      )}
    >
      <div className="relative aspect-square bg-ink-50 dark:bg-ink-800">
        <Link href={`/products/${deal.product.slug}`} aria-label={deal.product.title}>
          <Image
            src={deal.product.imageUrl}
            alt={deal.product.title}
            fill
            sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 46vw"
            className="object-contain p-4"
          />
        </Link>
        {deal.label && (
          <span className="absolute left-3 top-3 rounded-full bg-ink px-2.5 py-1 text-xs font-semibold text-paper dark:bg-saffron dark:text-ink-950">
            {deal.label}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <Link
          href={`/products/${deal.product.slug}`}
          className="line-clamp-2 text-sm font-medium text-ink hover:underline dark:text-paper"
        >
          {deal.product.title}
        </Link>

        <div className="flex items-center gap-2">
          <PriceBadge price={deal.offer.price} mrp={deal.offer.mrp} />
          {discount != null && discount > 0 && <DiscountBadge percent={discount} />}
        </div>

        <span className="text-xs text-ink-400">at {deal.offer.merchant.name}</span>

        {countdown && (
          <span className="flex items-center gap-1 text-xs font-medium text-vermilion-600 dark:text-vermilion-400">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {countdown}
          </span>
        )}

        <div className="mt-auto pt-1">
          <BuyButton offer={deal.offer} size="sm" fullWidth onBeforeNavigate={onBuyClick} />
        </div>
      </div>
    </motion.article>
  );
}

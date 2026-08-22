"use client";

import { Check, X, Clock, AlertTriangle } from "lucide-react";
import Image from "next/image";
import type { MerchantPrice, ProductPricing } from "@/lib/pricing/engine";
import { describeAge } from "@/lib/pricing/engine";
import { cn, formatPrice } from "@/lib/utils";

export interface MerchantPriceTableProps {
  pricing: ProductPricing;
  className?: string;
}

/**
 * All merchant prices side by side. Every row carries its own freshness
 * state — a stale or expired row is visually demoted and explicitly
 * labelled rather than being silently mixed in with current prices.
 */
export function MerchantPriceTable({ pricing, className }: MerchantPriceTableProps) {
  if (pricing.offers.length === 0) return null;

  return (
    <div className={cn("overflow-x-auto rounded-lg border border-ink-100 dark:border-ink-800", className)}>
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <caption className="sr-only">Prices at every store we track</caption>
        <thead>
          <tr className="border-b border-ink-100 bg-ink-50 dark:border-ink-800 dark:bg-ink-800/60">
            <th scope="col" className="px-4 py-3 text-left font-semibold text-ink dark:text-paper">Store</th>
            <th scope="col" className="px-4 py-3 text-left font-semibold text-ink dark:text-paper">Price</th>
            <th scope="col" className="px-4 py-3 text-left font-semibold text-ink dark:text-paper">vs. best</th>
            <th scope="col" className="px-4 py-3 text-left font-semibold text-ink dark:text-paper">Stock</th>
            <th scope="col" className="px-4 py-3 text-left font-semibold text-ink dark:text-paper">Last checked</th>
            <th scope="col" className="px-4 py-3 text-right font-semibold text-ink dark:text-paper">
              <span className="sr-only">Buy</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {pricing.offers.map((offer) => (
            <MerchantPriceRow key={offer.offerId} offer={offer} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MerchantPriceRow({ offer }: { offer: MerchantPrice }) {
  const isExpired = offer.freshness === "expired";
  const isUnavailable = !offer.inStock || offer.price == null;
  // Demote anything we can't vouch for, so the eye doesn't treat it as a
  // live comparable price.
  const demoted = isExpired || isUnavailable;

  return (
    <tr
      className={cn(
        "border-b border-ink-100 last:border-b-0 dark:border-ink-800",
        offer.isCheapest && "bg-jade-50/60 dark:bg-jade-700/10",
        demoted && "opacity-60",
      )}
    >
      <th scope="row" className="whitespace-nowrap px-4 py-3 text-left font-normal">
        <div className="flex items-center gap-2.5">
          {offer.merchantLogoUrl ? (
            <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded bg-white ring-1 ring-ink-100 dark:ring-ink-700">
              <Image src={offer.merchantLogoUrl} alt="" fill sizes="24px" className="object-contain p-0.5" />
            </span>
          ) : null}
          <span className="font-medium text-ink dark:text-paper">{offer.merchantName}</span>
          {offer.isCheapest && (
            <span className="rounded-full bg-jade-100 px-2 py-0.5 text-xs font-semibold text-jade-700 dark:bg-jade-700/20 dark:text-jade-300">
              Cheapest
            </span>
          )}
        </div>
      </th>

      <td className="px-4 py-3">
        {offer.price == null ? (
          <span className="text-ink-400">No price listed</span>
        ) : (
          <div className="flex flex-col">
            <span className="font-tabular font-semibold text-ink dark:text-paper">{formatPrice(offer.price)}</span>
            {offer.mrp != null && offer.mrp > offer.price && (
              <span className="font-tabular text-xs text-ink-400 line-through">{formatPrice(offer.mrp)}</span>
            )}
          </div>
        )}
      </td>

      <td className="px-4 py-3 font-tabular text-ink-500 dark:text-ink-300">
        {offer.differenceFromBest == null || offer.price == null
          ? "—"
          : offer.differenceFromBest === 0
            ? "—"
            : `+${formatPrice(offer.differenceFromBest)}`}
      </td>

      <td className="px-4 py-3">
        {offer.inStock ? (
          <span className="inline-flex items-center gap-1 text-jade-600 dark:text-jade-400">
            <Check className="h-4 w-4" aria-hidden="true" /> In stock
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-ink-400">
            <X className="h-4 w-4" aria-hidden="true" /> Out of stock
          </span>
        )}
      </td>

      <td className="px-4 py-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs",
            isExpired ? "text-vermilion-600 dark:text-vermilion-400"
              : offer.freshness === "stale" ? "text-saffron-700 dark:text-saffron-300"
              : "text-ink-400",
          )}
        >
          {isExpired ? (
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {describeAge(offer.lastCheckedAt)}
          {isExpired && " · not current"}
        </span>
      </td>

      <td className="px-4 py-3 text-right">
        {offer.inStock && offer.price != null ? (
          <a
            href={offer.buyUrl}
            target="_blank"
            rel="sponsored noopener noreferrer"
            className="inline-flex h-9 items-center rounded-md bg-ink px-3 text-sm font-semibold text-paper transition-colors hover:bg-ink-800 dark:bg-saffron dark:text-ink-950"
          >
            {isExpired ? "Check store" : "Buy"}
          </a>
        ) : (
          <span className="text-xs text-ink-400">Unavailable</span>
        )}
      </td>
    </tr>
  );
}

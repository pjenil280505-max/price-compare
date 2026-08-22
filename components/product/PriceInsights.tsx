"use client";

import { ArrowDown, ArrowUp, Clock, AlertTriangle, TrendingDown } from "lucide-react";
import type { ProductPricing } from "@/lib/pricing/engine";
import { describeAge, freshnessLabel, hasSufficientHistory } from "@/lib/pricing/engine";
import { cn, formatPrice } from "@/lib/utils";

export interface PriceInsightsProps {
  pricing: ProductPricing;
  className?: string;
}

/**
 * The honest-pricing panel. Two rules drive its design:
 *
 *   1. If every price is expired, it shows NO headline price. Presenting a
 *      three-week-old number as "best price" is the failure mode this
 *      whole engine exists to prevent.
 *   2. "Lowest recorded price" only appears once there is a genuine
 *      observation window — otherwise it's an unsupported claim dressed up
 *      as data.
 */
export function PriceInsights({ pricing, className }: PriceInsightsProps) {
  const { bestOffer, statistics, lastUpdatedAt, allPricesExpired } = pricing;
  const showHistory = hasSufficientHistory(statistics);

  if (pricing.offers.length === 0) {
    return (
      <div className={cn("rounded-lg border border-ink-100 p-5 dark:border-ink-800", className)}>
        <p className="text-sm text-ink-500 dark:text-ink-400">
          No store we track is currently listing this product.
        </p>
      </div>
    );
  }

  if (allPricesExpired || !bestOffer) {
    return (
      <div
        className={cn(
          "rounded-lg border border-saffron-300 bg-saffron-50 p-5 dark:border-saffron-700/40 dark:bg-saffron-700/10",
          className,
        )}
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-saffron-600" aria-hidden="true" />
          <div>
            <p className="font-medium text-ink dark:text-paper">We don&apos;t have a current price</p>
            <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">
              {bestOffer == null && !allPricesExpired
                ? "Every store we track is out of stock right now."
                : `The last prices we recorded are too old to rely on (checked ${describeAge(lastUpdatedAt)}).`}{" "}
              Prices below are shown for reference only — check the store directly.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const priceChange = bestOffer.priceChange;
  const changePercent = bestOffer.priceChangePercent;

  return (
    <div className={cn("flex flex-col gap-4 rounded-lg border border-ink-100 p-5 dark:border-ink-800", className)}>
      <div>
        <p className="text-sm text-ink-500 dark:text-ink-400">Best price right now</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <span className="font-tabular text-3xl font-semibold text-ink dark:text-paper">
            {formatPrice(bestOffer.price ?? 0)}
          </span>
          <span className="text-sm text-ink-500 dark:text-ink-400">at {bestOffer.merchantName}</span>
        </div>

        {priceChange != null && changePercent != null && priceChange !== 0 && (
          <p
            className={cn(
              "mt-1.5 flex items-center gap-1 text-sm font-medium",
              priceChange < 0 ? "text-jade-600 dark:text-jade-400" : "text-vermilion-600 dark:text-vermilion-400",
            )}
          >
            {priceChange < 0 ? (
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            )}
            {priceChange < 0 ? "Dropped" : "Rose"} {formatPrice(Math.abs(priceChange))} (
            {Math.abs(changePercent).toFixed(1)}%) since the previous change
          </p>
        )}
      </div>

      {/* Freshness is never optional — every headline price is labelled. */}
      <p
        className={cn(
          "flex items-center gap-1.5 text-xs",
          bestOffer.freshness === "fresh" ? "text-ink-400" : "text-saffron-700 dark:text-saffron-300",
        )}
      >
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        {freshnessLabel(bestOffer)}
      </p>

      {showHistory && statistics.lowestPrice != null && (
        <div className="flex flex-col gap-2 border-t border-ink-100 pt-4 dark:border-ink-800">
          {statistics.isAtLowest && (
            <p className="flex items-center gap-1.5 text-sm font-medium text-jade-700 dark:text-jade-300">
              <TrendingDown className="h-4 w-4" aria-hidden="true" />
              At its lowest recorded price
            </p>
          )}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-ink-400">Lowest recorded</dt>
              <dd className="font-tabular font-medium text-ink dark:text-paper">
                {formatPrice(statistics.lowestPrice)}
              </dd>
            </div>
            {statistics.highestPrice != null && (
              <div>
                <dt className="text-ink-400">Highest recorded</dt>
                <dd className="font-tabular font-medium text-ink dark:text-paper">
                  {formatPrice(statistics.highestPrice)}
                </dd>
              </div>
            )}
            {statistics.averagePrice != null && (
              <div>
                <dt className="text-ink-400">Average</dt>
                <dd className="font-tabular font-medium text-ink dark:text-paper">
                  {formatPrice(statistics.averagePrice)}
                </dd>
              </div>
            )}
          </dl>
          <p className="text-xs text-ink-400">
            Based on {statistics.observationCount.toLocaleString("en-IN")} price checks over{" "}
            {statistics.observationDays} days.
          </p>
        </div>
      )}

      {!showHistory && (
        // Explicitly say why history is absent rather than silently omitting
        // it — otherwise it looks like a broken feature.
        <p className="border-t border-ink-100 pt-4 text-xs text-ink-400 dark:border-ink-800">
          We haven&apos;t tracked this product long enough to show reliable price history yet.
        </p>
      )}
    </div>
  );
}

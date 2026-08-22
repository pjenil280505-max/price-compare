"use client";

import { useEffect, useState } from "react";
import { Heart, Bell, TrendingDown } from "lucide-react";
import type { PriceAlertRecord, WishlistItem } from "@/lib/types";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard, StatCardSkeleton } from "@/components/dashboard/StatCard";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { InteractiveProductGrid } from "@/components/product/InteractiveProductGrid";

export default function AccountPage() {
  const [wishlist, setWishlist] = useState<WishlistItem[] | null>(null);
  const [alerts, setAlerts] = useState<PriceAlertRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([api.getWishlist(), api.getPriceAlerts()])
      .then(([wishlistData, alertsData]) => {
        if (cancelled) return;
        setWishlist(wishlistData);
        setAlerts(alertsData);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your dashboard.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <ErrorState description={error} onRetry={() => window.location.reload()} />;
  }

  const isLoading = wishlist === null || alerts === null;
  const triggeredCount = alerts?.filter((a) => a.active && a.currentPrice <= a.targetPrice).length ?? 0;

  return (
    <>
      <PageHeader title="Overview" description="Everything you're tracking, in one place." />

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard label="Wishlist items" value={String(wishlist.length)} icon={<Heart className="h-5 w-5" aria-hidden="true" />} />
            <StatCard
              label="Active alerts"
              value={String(alerts.filter((a) => a.active).length)}
              icon={<Bell className="h-5 w-5" aria-hidden="true" />}
            />
            <StatCard
              label="Ready to buy"
              value={String(triggeredCount)}
              icon={<TrendingDown className="h-5 w-5" aria-hidden="true" />}
              trend={triggeredCount > 0 ? { direction: "down", label: "At or below your target price" } : undefined}
            />
          </>
        )}
      </div>

      <div className="mt-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-400">Recently saved</h2>
        {isLoading ? null : wishlist.length === 0 ? (
          <EmptyState title="Nothing saved yet" description="Products you save will show up here." />
        ) : (
          <InteractiveProductGrid
            initialProducts={wishlist.slice(0, 4).map((item) => ({ ...item.product, isWishlisted: true }))}
          />
        )}
      </div>
    </>
  );
}

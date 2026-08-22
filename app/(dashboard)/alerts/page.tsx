"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import type { PriceAlertRecord } from "@/lib/types";
import { api } from "@/lib/api";
import { formatPrice } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<PriceAlertRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  function load() {
    setError(null);
    setAlerts(null);
    api
      .getPriceAlerts()
      .then(setAlerts)
      .catch(() => setError("Couldn't load your price alerts."));
  }

  useEffect(load, []);

  async function toggleActive(alert: PriceAlertRecord) {
    if (!alerts) return;
    const next = !alert.active;
    setAlerts(alerts.map((a) => (a.id === alert.id ? { ...a, active: next } : a)));
    try {
      await api.setPriceAlertActive(alert.id, next);
    } catch {
      setAlerts(alerts);
      toast({ title: "Couldn't update that alert", variant: "error" });
    }
  }

  async function remove(alert: PriceAlertRecord) {
    if (!alerts) return;
    const previous = alerts;
    setAlerts(alerts.filter((a) => a.id !== alert.id));
    try {
      await api.deletePriceAlert(alert.id);
      toast({ title: "Alert removed" });
    } catch {
      setAlerts(previous);
      toast({ title: "Couldn't remove that alert", variant: "error" });
    }
  }

  return (
    <>
      <PageHeader title="Price alerts" description="We'll email you the moment any of these hit your target." />

      <div className="mt-8">
        {error ? (
          <ErrorState description={error} onRetry={load} />
        ) : alerts === null ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <EmptyState
            title="No price alerts yet"
            description="Set one from any product page to get notified when the price drops."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {alerts.map((alert) => {
              const isTriggered = alert.active && alert.currentPrice <= alert.targetPrice;
              return (
                <li
                  key={alert.id}
                  className="flex items-center gap-4 rounded-lg border border-ink-100 p-4 dark:border-ink-800"
                >
                  <Link href={`/products/${alert.product.slug}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-ink-50 dark:bg-ink-900">
                    <Image src={alert.product.imageUrl} alt={alert.product.title} fill sizes="64px" className="object-contain p-1.5" />
                  </Link>

                  <div className="min-w-0 flex-1">
                    <Link href={`/products/${alert.product.slug}`} className="line-clamp-1 text-sm font-medium text-ink hover:underline dark:text-paper">
                      {alert.product.title}
                    </Link>
                    <p className="mt-1 font-tabular text-sm text-ink-500 dark:text-ink-400">
                      Target {formatPrice(alert.targetPrice)} · Now {formatPrice(alert.currentPrice)}
                    </p>
                  </div>

                  <StatusBadge
                    label={isTriggered ? "Below target" : alert.active ? "Watching" : "Paused"}
                    tone={isTriggered ? "success" : alert.active ? "pending" : "neutral"}
                    className="shrink-0"
                  />

                  <button
                    type="button"
                    role="switch"
                    aria-checked={alert.active}
                    aria-label={alert.active ? "Pause this alert" : "Resume this alert"}
                    onClick={() => toggleActive(alert)}
                    className="relative h-6 w-11 shrink-0 rounded-full bg-ink-200 transition-colors data-[active=true]:bg-jade-500 dark:bg-ink-700"
                    data-active={alert.active}
                  >
                    <span
                      className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                      style={{ transform: alert.active ? "translateX(20px)" : "translateX(0)" }}
                    />
                  </button>

                  <button
                    type="button"
                    aria-label="Remove alert"
                    onClick={() => remove(alert)}
                    className="shrink-0 rounded-md p-2 text-ink-400 transition-colors hover:bg-vermilion-50 hover:text-vermilion-600 dark:hover:bg-vermilion-700/15"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

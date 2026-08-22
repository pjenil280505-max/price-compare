"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard, StatCardSkeleton } from "@/components/dashboard/StatCard";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatRelativeTime } from "@/lib/utils";

interface MerchantStat {
  merchant_name: string;
  total_clicks: number;
  affiliate_clicks: number;
  untracked_clicks: number;
  tracked_rate: number | null;
}
interface LinkHealth {
  merchant_name: string;
  fallback_reason: string;
  occurrences: number;
  last_seen: string;
}
interface ConfigRow {
  merchantName: string;
  network: string;
  strategy: string;
  isActive: boolean;
  trackingIdEnvVar: string | null;
  trackingIdConfigured: boolean;
  allowedDomains: string[];
}
interface Payload {
  periodDays: number;
  merchantStats: MerchantStat[];
  linkHealth: LinkHealth[];
  configurations: ConfigRow[];
}

export default function AdminAffiliatePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/affiliate");
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError("Couldn't load affiliate analytics.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState description={error} onRetry={load} />;

  const totalClicks = data?.merchantStats.reduce((s, m) => s + Number(m.total_clicks), 0) ?? 0;
  const totalTracked = data?.merchantStats.reduce((s, m) => s + Number(m.affiliate_clicks), 0) ?? 0;
  const overallRate = totalClicks > 0 ? Math.round((totalTracked / totalClicks) * 1000) / 10 : null;

  return (
    <>
      <PageHeader
        title="Affiliate links"
        description="Link configuration health and click attribution. No credentials are shown here."
      />

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {data ? (
          <>
            <StatCard label="Clicks tracked" value={totalClicks.toLocaleString("en-IN")} icon={<Link2 className="h-5 w-5" aria-hidden="true" />} />
            <StatCard
              label="Attributed rate"
              value={overallRate != null ? `${overallRate}%` : "—"}
              trend={
                overallRate != null && overallRate < 90
                  ? { direction: "down", label: "Below 90% — check link health" }
                  : undefined
              }
            />
            <StatCard label="Untracked clicks" value={(totalClicks - totalTracked).toLocaleString("en-IN")} />
          </>
        ) : (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        )}
      </div>

      <section className="mt-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-400">Configuration</h2>
        {!data ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : data.configurations.length === 0 ? (
          <EmptyState
            title="No affiliate configurations"
            description="Add a row to affiliate_configurations for each approved merchant network."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {data.configurations.map((c) => {
              const tone: StatusTone = !c.isActive
                ? "neutral"
                : c.trackingIdEnvVar && !c.trackingIdConfigured
                  ? "error"
                  : "success";
              const label = !c.isActive
                ? "disabled"
                : c.trackingIdEnvVar && !c.trackingIdConfigured
                  ? "env var not set"
                  : "ready";

              return (
                <li key={`${c.merchantName}-${c.network}`} className="rounded-lg border border-ink-100 p-4 dark:border-ink-800">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="font-medium text-ink dark:text-paper">{c.merchantName}</span>
                        <StatusBadge label={label} tone={tone} />
                      </div>
                      <p className="mt-1 text-sm text-ink-400">
                        {c.network} · {c.strategy.replace(/_/g, " ")}
                        {c.trackingIdEnvVar && ` · reads $${c.trackingIdEnvVar}`}
                      </p>
                      {c.allowedDomains.length > 0 && (
                        <p className="mt-1 text-xs text-ink-400">
                          Deep links permitted to: {c.allowedDomains.join(", ")}
                        </p>
                      )}
                    </div>
                    {c.trackingIdEnvVar && !c.trackingIdConfigured && (
                      <p className="flex items-center gap-1.5 text-sm text-vermilion-600 dark:text-vermilion-400">
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                        Set {c.trackingIdEnvVar} in the deployment environment
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-400">
          Link failures (last 7 days)
        </h2>
        {!data ? (
          <Skeleton className="h-32 w-full rounded-lg" />
        ) : data.linkHealth.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-jade-700 dark:text-jade-300">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Every click in this period produced a tracked affiliate link.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-ink-100 dark:border-ink-800">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <caption className="sr-only">Affiliate link failures by merchant and cause</caption>
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50 dark:border-ink-800 dark:bg-ink-800/60">
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-ink dark:text-paper">Merchant</th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-ink dark:text-paper">Reason</th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-ink dark:text-paper">Count</th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-ink dark:text-paper">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.linkHealth.map((h, i) => (
                  <tr key={i} className="border-b border-ink-100 last:border-b-0 dark:border-ink-800">
                    <td className="px-4 py-3 font-medium text-ink dark:text-paper">{h.merchant_name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-vermilion-600 dark:text-vermilion-400">
                      {h.fallback_reason}
                    </td>
                    <td className="px-4 py-3 font-tabular text-ink-500 dark:text-ink-300">{h.occurrences}</td>
                    <td className="px-4 py-3 text-ink-500 dark:text-ink-300">{formatRelativeTime(h.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

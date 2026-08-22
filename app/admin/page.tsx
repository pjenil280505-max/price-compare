"use client";

import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatRelativeTime } from "@/lib/utils";
import { useAdminData } from "@/components/admin/useAdminData";
import { AdminSectionState } from "@/components/admin/AdminSectionState";
import { AdminNotice, AdminSection, MetricGrid, MetricTile } from "@/components/admin/AdminPrimitives";

interface Stats {
  products: number; variants: number; offers: number;
  merchants_active: number; merchants_total: number;
  connectors_active: number; pending_matches: number;
  users: number; active_alerts: number; wishlist_items: number;
  failed_syncs: number; sync_failures: number;
  price_changes: number; price_drops: number;
  clicks: number; clicks_untracked: number; stale_offers: number;
  latest_sync: {
    status: string; started_at: string; items_matched: number; merchant: string;
  } | null;
}
interface Top {
  top_products: { id: string; title: string; slug: string; clicks: number }[];
  top_merchants: { id: string; name: string; clicks: number; tracked: number }[];
}
interface Payload {
  periodDays: number;
  role: string;
  stats: Stats;
  top: Top | null;
}

export default function AdminOverviewPage() {
  const { data, error, forbidden, loading, reload } = useAdminData<Payload>("/api/admin/dashboard?days=7");

  const state = <AdminSectionState loading={loading} forbidden={forbidden} error={error} onRetry={reload} />;
  if (loading || error) {
    return (
      <>
        <PageHeader title="Overview" />
        <div className="mt-8">{state}</div>
      </>
    );
  }

  const s = data!.stats;
  const trackedRate = s.clicks > 0 ? Math.round(((s.clicks - s.clicks_untracked) / s.clicks) * 100) : null;

  return (
    <>
      <PageHeader title="Overview" description={`Last ${data!.periodDays} days · signed in as ${data!.role}`} />

      <AdminSection title="Catalog" className="mt-6">
        <MetricGrid>
          <MetricTile label="Products" value={s.products} hint={`${s.variants.toLocaleString("en-IN")} variants`} />
          <MetricTile label="Offers" value={s.offers} href="/admin/prices" />
          <MetricTile
            label="Active merchants"
            value={`${s.merchants_active}/${s.merchants_total}`}
            href="/admin/merchants"
          />
          <MetricTile
            label="Pending matches"
            value={s.pending_matches}
            tone={s.pending_matches > 0 ? "warn" : "good"}
            href="/admin/matches"
          />
        </MetricGrid>
      </AdminSection>

      <AdminSection title="Sync health">
        <MetricGrid>
          <MetricTile label="Active connectors" value={s.connectors_active} href="/admin/connectors" />
          <MetricTile
            label="Failed syncs"
            value={s.failed_syncs}
            tone={s.failed_syncs > 0 ? "bad" : "good"}
            href="/admin/sync-errors"
          />
          <MetricTile
            label="Record failures"
            value={s.sync_failures}
            tone={s.sync_failures > 0 ? "warn" : "good"}
            href="/admin/sync-errors"
          />
          <MetricTile
            label="Stale offers"
            value={s.stale_offers}
            tone={s.stale_offers > 0 ? "warn" : "good"}
            hint="not shown as current"
            href="/admin/prices"
          />
        </MetricGrid>

        {s.latest_sync ? (
          <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-lg border border-ink-100 bg-paper p-4 text-sm dark:border-ink-800 dark:bg-ink-900">
            <span className="text-ink-400">Latest sync</span>
            <span className="font-medium text-ink dark:text-paper">{s.latest_sync.merchant}</span>
            <StatusBadge
              label={s.latest_sync.status}
              tone={s.latest_sync.status === "success" ? "success" : s.latest_sync.status === "running" ? "pending" : "error"}
            />
            <span className="text-ink-400">{formatRelativeTime(s.latest_sync.started_at)}</span>
            <span className="font-tabular text-ink-500 dark:text-ink-300">
              {s.latest_sync.items_matched.toLocaleString("en-IN")} imported
            </span>
          </div>
        ) : (
          <AdminNotice tone="warn">
            No sync has ever run. Connect a merchant and press Sync Now to populate the catalog.
          </AdminNotice>
        )}
      </AdminSection>

      <AdminSection title="Prices & clicks">
        <MetricGrid>
          <MetricTile label="Price changes" value={s.price_changes} href="/admin/history" />
          <MetricTile label="Price drops" value={s.price_drops} tone="good" href="/admin/history" />
          <MetricTile label="Outbound clicks" value={s.clicks} href="/admin/analytics" />
          <MetricTile
            label="Attributed"
            value={trackedRate != null ? `${trackedRate}%` : "—"}
            tone={trackedRate != null && trackedRate < 90 ? "bad" : "good"}
            hint={s.clicks_untracked > 0 ? `${s.clicks_untracked} untracked` : undefined}
            href="/admin/affiliate"
          />
        </MetricGrid>
      </AdminSection>

      <AdminSection title="Users">
        <MetricGrid>
          <MetricTile label="Accounts" value={s.users} href="/admin/users" />
          <MetricTile label="Active alerts" value={s.active_alerts} href="/admin/alerts" />
          <MetricTile label="Wishlist items" value={s.wishlist_items} />
        </MetricGrid>
      </AdminSection>

      {data!.top && (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <AdminSection title="Top products" className="mt-0">
            {data!.top.top_products.length === 0 ? (
              <AdminNotice>No clicks recorded yet.</AdminNotice>
            ) : (
              <ol className="flex flex-col gap-2">
                {data!.top.top_products.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-lg border border-ink-100 bg-paper p-3 dark:border-ink-800 dark:bg-ink-900">
                    <span className="font-tabular w-5 shrink-0 text-sm text-ink-400">{i + 1}</span>
                    <Link href={`/products/${p.slug}`} className="min-w-0 flex-1 truncate text-sm text-ink hover:underline dark:text-paper">
                      {p.title}
                    </Link>
                    <span className="font-tabular shrink-0 text-sm font-semibold text-ink dark:text-paper">{p.clicks}</span>
                  </li>
                ))}
              </ol>
            )}
          </AdminSection>

          <AdminSection title="Top merchants" className="mt-0">
            {data!.top.top_merchants.length === 0 ? (
              <AdminNotice>No clicks recorded yet.</AdminNotice>
            ) : (
              <ol className="flex flex-col gap-2">
                {data!.top.top_merchants.map((m, i) => (
                  <li key={m.id} className="flex items-center gap-3 rounded-lg border border-ink-100 bg-paper p-3 dark:border-ink-800 dark:bg-ink-900">
                    <span className="font-tabular w-5 shrink-0 text-sm text-ink-400">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink dark:text-paper">{m.name}</span>
                    <span className="shrink-0 text-xs text-ink-400">{m.tracked}/{m.clicks} tracked</span>
                  </li>
                ))}
              </ol>
            )}
          </AdminSection>
        </div>
      )}
    </>
  );
}

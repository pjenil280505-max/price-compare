"use client";

import { CheckCircle2, XCircle, AlertTriangle, Circle } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatRelativeTime } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useAdminData } from "@/components/admin/useAdminData";
import { AdminSectionState } from "@/components/admin/AdminSectionState";
import {
  AdminNotice, AdminSection, MetricGrid, MetricTile,
} from "@/components/admin/AdminPrimitives";

interface Service { name: string; ok: boolean; detail?: string; critical: boolean }
interface Merchant {
  id: string; name: string; isActive: boolean; productCount: number; offerCount: number;
  freshOffers: number; staleOffers: number; connected: boolean; syncActive: boolean;
  lastRunAt: string | null; consecutiveFailures: number;
  affiliateNetwork: string | null; affiliateActive: boolean;
}
interface Run {
  id: string; merchant: string; status: string; startedAt: string;
  itemsProcessed: number; itemsMatched: number; itemsFlagged: number;
}
interface Payload {
  checkedAt: string;
  services: Service[];
  connectors: { key: string; displayName: string; implemented: boolean }[];
  merchants: Merchant[];
  sync: {
    activeJobs: number; neverRun: number; backedOff: number; stuckRuns: number;
    failedLast7Days: number; lastSuccessfulRun: Run | null; recentRuns: Run[];
  };
  imports: {
    totalProducts: number; totalOffers: number; staleOffers: number;
    staleSample: { merchant_name: string; product_title: string; hours_since_check: number }[];
  };
  affiliate: {
    configs: { merchantName: string; network: string; isActive: boolean; credentialSet: boolean }[];
    linkFailures: { merchant_name: string; fallback_reason: string; occurrences: number }[];
  };
  notifications: {
    emailConfigured: boolean; pushConfigured: boolean; activeAlerts: number;
    deliveries: Record<string, number>;
  };
}

function Indicator({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (ok) return <CheckCircle2 className="h-4 w-4 shrink-0 text-jade-600 dark:text-jade-400" aria-hidden="true" />;
  if (warn) return <AlertTriangle className="h-4 w-4 shrink-0 text-saffron-600" aria-hidden="true" />;
  return <XCircle className="h-4 w-4 shrink-0 text-vermilion-600 dark:text-vermilion-400" aria-hidden="true" />;
}

export default function AdminHealthPage() {
  const { data, error, forbidden, loading, reload } = useAdminData<Payload>("/api/admin/health");

  if (loading || error) {
    return (
      <>
        <PageHeader title="System health" />
        <div className="mt-8">
          <AdminSectionState loading={loading} forbidden={forbidden} error={error} onRetry={reload} />
        </div>
      </>
    );
  }

  const d = data!;
  const criticalDown = d.services.filter((s) => s.critical && !s.ok);
  const optionalMissing = d.services.filter((s) => !s.critical && !s.ok);
  const deliveryFailed = (d.notifications.deliveries.failed ?? 0) + (d.notifications.deliveries.permanently_failed ?? 0);

  return (
    <>
      <PageHeader
        title="System health"
        description={`Checked ${formatRelativeTime(d.checkedAt)}`}
      />

      {criticalDown.length > 0 && (
        <AdminNotice tone="warn">
          <strong>{criticalDown.length} critical service{criticalDown.length === 1 ? " is" : "s are"} not
          configured:</strong>{" "}
          {criticalDown.map((s) => s.name).join(", ")}. The platform will not work correctly until
          these are set.
        </AdminNotice>
      )}

      <AdminSection title="At a glance" className="mt-6">
        <MetricGrid>
          <MetricTile
            label="Database"
            value={d.services[0]?.ok ? "Online" : "Down"}
            tone={d.services[0]?.ok ? "good" : "bad"}
            hint={d.services[0]?.detail}
          />
          <MetricTile
            label="Active connectors"
            value={d.sync.activeJobs}
            tone={d.sync.backedOff > 0 ? "bad" : d.sync.activeJobs === 0 ? "warn" : "good"}
            hint={d.sync.backedOff > 0 ? `${d.sync.backedOff} backed off` : undefined}
            href="/admin/connectors"
          />
          <MetricTile
            label="Failed syncs (7d)"
            value={d.sync.failedLast7Days}
            tone={d.sync.failedLast7Days > 0 ? "bad" : "good"}
            href="/admin/sync-errors"
          />
          <MetricTile
            label="Stale offers"
            value={d.imports.staleOffers}
            tone={d.imports.staleOffers > 0 ? "warn" : "good"}
            hint="never shown as current"
          />
        </MetricGrid>
      </AdminSection>

      <AdminSection title="Services" description="Environment configuration. Values are never displayed.">
        <ul className="flex flex-col gap-2">
          {d.services.map((s) => (
            <li
              key={s.name}
              className="flex items-center gap-3 rounded-lg border border-ink-100 bg-paper p-3.5 dark:border-ink-800 dark:bg-ink-900"
            >
              <Indicator ok={s.ok} warn={!s.critical} />
              <span className="min-w-0 flex-1 text-sm font-medium text-ink dark:text-paper">{s.name}</span>
              {s.detail && <span className="shrink-0 text-xs text-ink-400">{s.detail}</span>}
              <span className="shrink-0 text-xs font-semibold text-ink-500 dark:text-ink-400">
                {s.ok ? "OK" : s.critical ? "MISSING" : "optional"}
              </span>
            </li>
          ))}
        </ul>
        {optionalMissing.length > 0 && (
          <p className="mt-3 text-xs text-ink-400">
            Optional services that are unset degrade a feature but don&apos;t break the platform —
            e.g. without email, alerts still record in-app.
          </p>
        )}
      </AdminSection>

      <AdminSection title="Merchants" description="Connection, imports and freshness per merchant.">
        {d.merchants.length === 0 ? (
          <AdminNotice tone="warn">
            No merchants configured. Products can only arrive through an authorized connector —
            see docs/CONNECTORS.md.
          </AdminNotice>
        ) : (
          <ul className="flex flex-col gap-2">
            {d.merchants.map((m) => {
              const tone: StatusTone = !m.connected
                ? "neutral"
                : m.consecutiveFailures >= 5
                  ? "error"
                  : !m.syncActive
                    ? "neutral"
                    : m.staleOffers > 0
                      ? "pending"
                      : "success";
              const label = !m.connected
                ? "not connected"
                : m.consecutiveFailures >= 5
                  ? "backed off"
                  : !m.syncActive
                    ? "sync off"
                    : m.staleOffers > 0
                      ? "stale data"
                      : "healthy";

              return (
                <li key={m.id} className="rounded-lg border border-ink-100 bg-paper p-4 dark:border-ink-800 dark:bg-ink-900">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink dark:text-paper">{m.name}</span>
                    <StatusBadge label={label} tone={tone} />
                    {m.affiliateNetwork && (
                      <span className="text-xs text-ink-400">
                        {m.affiliateNetwork}{m.affiliateActive ? "" : " (off)"}
                      </span>
                    )}
                  </div>
                  <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
                    <div><dt className="text-[11px] uppercase text-ink-400">Products</dt>
                      <dd className="font-tabular text-ink dark:text-paper">{m.productCount.toLocaleString("en-IN")}</dd></div>
                    <div><dt className="text-[11px] uppercase text-ink-400">Offers</dt>
                      <dd className="font-tabular text-ink dark:text-paper">{m.offerCount.toLocaleString("en-IN")}</dd></div>
                    <div><dt className="text-[11px] uppercase text-ink-400">Fresh</dt>
                      <dd className={"font-tabular " + (m.staleOffers > 0 ? "text-saffron-700 dark:text-saffron-300" : "text-ink dark:text-paper")}>
                        {m.freshOffers}/{m.offerCount}</dd></div>
                    <div><dt className="text-[11px] uppercase text-ink-400">Last sync</dt>
                      <dd className="text-ink dark:text-paper">{m.lastRunAt ? formatRelativeTime(m.lastRunAt) : "never"}</dd></div>
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </AdminSection>

      <AdminSection
        title="Recent syncs"
        description={d.sync.lastSuccessfulRun
          ? `Last success: ${d.sync.lastSuccessfulRun.merchant}, ${formatRelativeTime(d.sync.lastSuccessfulRun.startedAt)}`
          : "No successful sync has ever run."}
        actions={<Link href="/admin/sync-errors" className="text-sm text-ink-500 underline underline-offset-4 dark:text-ink-400">Errors</Link>}
      >
        {d.sync.stuckRuns > 0 && (
          <AdminNotice tone="warn">
            {d.sync.stuckRuns} run{d.sync.stuckRuns === 1 ? "" : "s"} stuck in &ldquo;running&rdquo; for
            over 30 minutes — almost certainly crashed invocations whose log was never closed. They
            block Sync Now until reclaimed; pressing Sync Now again clears them.
          </AdminNotice>
        )}
        {d.sync.recentRuns.length === 0 ? (
          <AdminNotice>No sync has run yet.</AdminNotice>
        ) : (
          <ul className="flex flex-col gap-2">
            {d.sync.recentRuns.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2.5 rounded-lg border border-ink-100 bg-paper p-3.5 text-sm dark:border-ink-800 dark:bg-ink-900">
                <StatusBadge
                  label={r.status}
                  tone={r.status === "success" ? "success" : r.status === "running" ? "pending" : "error"}
                />
                <span className="font-medium text-ink dark:text-paper">{r.merchant}</span>
                <span className="text-ink-400">{formatRelativeTime(r.startedAt)}</span>
                <span className="font-tabular ml-auto text-ink-500 dark:text-ink-300">
                  {r.itemsMatched.toLocaleString("en-IN")} imported
                  {r.itemsFlagged > 0 && `, ${r.itemsFlagged} flagged`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      <AdminSection title="Product imports">
        <MetricGrid>
          <MetricTile label="Products" value={d.imports.totalProducts} />
          <MetricTile label="Offers" value={d.imports.totalOffers} />
          <MetricTile
            label="Stale offers"
            value={d.imports.staleOffers}
            tone={d.imports.staleOffers > 0 ? "warn" : "good"}
          />
        </MetricGrid>
        {d.imports.staleSample.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {d.imports.staleSample.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-ink-100 px-3 py-2 text-xs dark:border-ink-800">
                <span className="text-ink-400">{s.merchant_name}</span>
                <span className="min-w-0 flex-1 truncate text-ink dark:text-paper">{s.product_title}</span>
                <span className="font-tabular shrink-0 text-saffron-700 dark:text-saffron-300">
                  {Math.round(s.hours_since_check)}h old
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      <AdminSection title="Affiliate">
        {d.affiliate.configs.length === 0 ? (
          <AdminNotice>No affiliate configurations. Outbound clicks earn nothing.</AdminNotice>
        ) : (
          <ul className="flex flex-col gap-2">
            {d.affiliate.configs.map((c, i) => (
              <li key={i} className="flex items-center gap-3 rounded-lg border border-ink-100 bg-paper p-3.5 text-sm dark:border-ink-800 dark:bg-ink-900">
                <Indicator ok={c.isActive && c.credentialSet} warn={c.isActive && !c.credentialSet} />
                <span className="font-medium text-ink dark:text-paper">{c.merchantName}</span>
                <span className="text-xs text-ink-400">{c.network}</span>
                <span className="ml-auto text-xs text-ink-500 dark:text-ink-400">
                  {!c.isActive ? "inactive" : c.credentialSet ? "ready" : "credential missing"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {d.affiliate.linkFailures.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-xs uppercase tracking-wide text-ink-400">Link failures (7d)</p>
            <ul className="flex flex-col gap-1.5">
              {d.affiliate.linkFailures.slice(0, 5).map((f, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md border border-ink-100 px-3 py-2 text-xs dark:border-ink-800">
                  <span className="text-ink dark:text-paper">{f.merchant_name}</span>
                  <code className="font-mono text-vermilion-600 dark:text-vermilion-400">{f.fallback_reason}</code>
                  <span className="font-tabular ml-auto text-ink-400">{f.occurrences}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </AdminSection>

      <AdminSection title="Notifications">
        <MetricGrid>
          <MetricTile label="Active alerts" value={d.notifications.activeAlerts} href="/admin/alerts" />
          <MetricTile
            label="Email"
            value={d.notifications.emailConfigured ? "Ready" : "Not set"}
            tone={d.notifications.emailConfigured ? "good" : "warn"}
          />
          <MetricTile
            label="Delivered"
            value={d.notifications.deliveries.sent ?? 0}
            tone="good"
          />
          <MetricTile
            label="Delivery failures"
            value={deliveryFailed}
            tone={deliveryFailed > 0 ? "bad" : "good"}
          />
        </MetricGrid>
        {!d.notifications.pushConfigured && (
          <p className="mt-3 flex items-start gap-2 text-xs text-ink-400">
            <Circle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            Web push is not configured, and sending is not implemented — push deliveries are recorded
            as permanently failed rather than retrying forever.
          </p>
        )}
      </AdminSection>

      <AdminSection title="Connectors">
        <ul className="flex flex-col gap-2">
          {d.connectors.map((c) => (
            <li key={c.key} className="flex items-center gap-3 rounded-lg border border-ink-100 bg-paper p-3.5 text-sm dark:border-ink-800 dark:bg-ink-900">
              <Indicator ok={c.implemented} warn={!c.implemented} />
              <span className="min-w-0 flex-1 truncate text-ink dark:text-paper">{c.displayName}</span>
              <code className="shrink-0 font-mono text-xs text-ink-400">{c.key}</code>
            </li>
          ))}
        </ul>
      </AdminSection>
    </>
  );
}

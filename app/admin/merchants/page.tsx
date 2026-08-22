"use client";

import { useState } from "react";
import Link from "next/link";
import { Play, Settings2, KeyRound, Link2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { formatRelativeTime } from "@/lib/utils";
import { useAdminData } from "@/components/admin/useAdminData";
import { AdminSectionState } from "@/components/admin/AdminSectionState";
import { AdminList, AdminNotice, AdminRecordCard } from "@/components/admin/AdminPrimitives";

interface Merchant {
  merchant_id: string;
  name: string;
  slug: string;
  is_active: boolean;
  price_ttl_hours: number;
  offer_count: number;
  product_count: number;
  fresh_offers: number;
  stale_offers: number;
  connector_key: string | null;
  sync_job_id: string | null;
  sync_active: boolean | null;
  last_run_at: string | null;
  consecutive_failures: number;
  affiliate_network: string | null;
  affiliate_active: boolean | null;
  clicks_30d: number;
}

function health(m: Merchant): { label: string; tone: StatusTone } {
  if (!m.sync_job_id) return { label: "not connected", tone: "neutral" };
  if (!m.is_active) return { label: "merchant disabled", tone: "neutral" };
  if (!m.sync_active) return { label: "sync disabled", tone: "neutral" };
  if (m.consecutive_failures >= 5) return { label: "backed off", tone: "error" };
  if (m.consecutive_failures > 0) return { label: "degraded", tone: "pending" };
  if (!m.last_run_at) return { label: "never synced", tone: "pending" };
  return { label: "healthy", tone: "success" };
}

export default function AdminMerchantsPage() {
  const { data, error, forbidden, loading, reload } =
    useAdminData<{ merchants: Merchant[] }>("/api/admin/merchants");
  const [busyId, setBusyId] = useState<string | null>(null);
  const { toast } = useToast();

  async function syncNow(m: Merchant) {
    if (!m.sync_job_id) return;
    setBusyId(m.merchant_id);
    try {
      const res = await fetch(`/api/admin/connectors/${m.sync_job_id}/sync`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        toast({ title: "Sync failed", description: body.message ?? body.errorMessage, variant: "error" });
      } else {
        toast({
          title: body.timedOut ? "Sync paused at time limit" : "Sync complete",
          description: `${body.itemsMatched} imported, ${body.itemsFlagged} flagged`,
          variant: "success",
        });
      }
      await reload();
    } catch {
      toast({ title: "Sync failed", variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleSync(m: Merchant) {
    if (!m.sync_job_id) return;
    setBusyId(m.merchant_id);
    try {
      const res = await fetch(`/api/admin/connectors/${m.sync_job_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !m.sync_active }),
      });
      if (!res.ok) throw new Error();
      toast({ title: m.sync_active ? "Sync disabled" : "Sync enabled" });
      await reload();
    } catch {
      toast({ title: "Couldn't update", variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  const state = <AdminSectionState loading={loading} forbidden={forbidden} error={error} onRetry={reload} />;

  return (
    <>
      <PageHeader title="Merchants" description="Connection, sync health, credentials and affiliate status." />

      <div className="mt-8">
        {loading || error ? (
          state
        ) : data!.merchants.length === 0 ? (
          <AdminNotice tone="warn">
            No merchants yet. A merchant is created by inserting a row and its connector configuration —
            see docs/CONNECTORS.md. Products can only arrive through an authorized connector.
          </AdminNotice>
        ) : (
          <AdminList>
            {data!.merchants.map((m) => {
              const h = health(m);
              const busy = busyId === m.merchant_id;

              return (
                <AdminRecordCard
                  key={m.merchant_id}
                  title={m.name}
                  subtitle={m.connector_key ?? "no connector configured"}
                  badge={<StatusBadge label={h.label} tone={h.tone} />}
                  fields={[
                    { label: "Products", value: m.product_count.toLocaleString("en-IN") },
                    { label: "Offers", value: m.offer_count.toLocaleString("en-IN") },
                    {
                      label: "Fresh",
                      value: (
                        <span className={m.stale_offers > 0 ? "text-saffron-700 dark:text-saffron-300" : undefined}>
                          {m.fresh_offers}/{m.offer_count}
                        </span>
                      ),
                    },
                    { label: "Last sync", value: m.last_run_at ? formatRelativeTime(m.last_run_at) : "never" },
                    { label: "Price TTL", value: `${m.price_ttl_hours}h` },
                    {
                      label: "Affiliate",
                      value: m.affiliate_network
                        ? `${m.affiliate_network}${m.affiliate_active ? "" : " (off)"}`
                        : "none",
                    },
                    { label: "Clicks 30d", value: Number(m.clicks_30d).toLocaleString("en-IN") },
                  ]}
                  warning={
                    m.consecutive_failures >= 5
                      ? `Skipped by the scheduler after ${m.consecutive_failures} consecutive failures. Fix the cause, then re-enable sync to clear the counter.`
                      : !m.sync_job_id
                        ? "No sync job configured — this merchant will never receive products."
                        : undefined
                  }
                  actions={
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        leftIcon={<Play className="h-4 w-4" aria-hidden="true" />}
                        isLoading={busy}
                        disabled={busy || !m.sync_job_id || !m.sync_active}
                        onClick={() => syncNow(m)}
                      >
                        Sync now
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || !m.sync_job_id}
                        onClick={() => toggleSync(m)}
                      >
                        {m.sync_active ? "Disable sync" : "Enable sync"}
                      </Button>
                      <Link
                        href="/admin/connectors"
                        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-ink-500 hover:text-ink dark:text-ink-400 dark:hover:text-paper"
                      >
                        <Settings2 className="h-4 w-4" aria-hidden="true" /> Jobs
                      </Link>
                      <Link
                        href="/admin/credentials"
                        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-ink-500 hover:text-ink dark:text-ink-400 dark:hover:text-paper"
                      >
                        <KeyRound className="h-4 w-4" aria-hidden="true" /> Credentials
                      </Link>
                      <Link
                        href="/admin/affiliate"
                        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-ink-500 hover:text-ink dark:text-ink-400 dark:hover:text-paper"
                      >
                        <Link2 className="h-4 w-4" aria-hidden="true" /> Affiliate
                      </Link>
                    </>
                  }
                />
              );
            })}
          </AdminList>
        )}
      </div>
    </>
  );
}

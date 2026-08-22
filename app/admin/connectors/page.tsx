"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, AlertTriangle } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface ConnectorRow {
  jobId: string;
  merchantName: string;
  connectorKey: string;
  connectorName: string;
  isRegistered: boolean;
  isImplemented: boolean;
  jobType: string;
  isActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  consecutiveFailures: number;
  requiredCredentials: string[];
  latestRun: {
    status: string;
    startedAt: string;
    itemsProcessed: number;
    itemsMatched: number;
    itemsFlagged: number;
  } | null;
}

function healthOf(row: ConnectorRow): { label: string; tone: StatusTone } {
  if (!row.isRegistered) return { label: "unregistered", tone: "error" };
  if (!row.isImplemented) return { label: "not implemented", tone: "neutral" };
  if (!row.isActive) return { label: "disabled", tone: "neutral" };
  if (row.consecutiveFailures >= 5) return { label: "backed off", tone: "error" };
  if (row.consecutiveFailures > 0) return { label: "degraded", tone: "pending" };
  if (row.latestRun?.status === "running") return { label: "running", tone: "pending" };
  if (row.latestRun?.status === "error") return { label: "last run failed", tone: "error" };
  if (row.latestRun?.status === "success") return { label: "healthy", tone: "success" };
  return { label: "never run", tone: "neutral" };
}

export default function AdminConnectorsPage() {
  const [rows, setRows] = useState<ConnectorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/connectors");
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      setRows(data.connectors);
    } catch {
      setError("Couldn't load connectors.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function syncNow(row: ConnectorRow) {
    setBusyJobId(row.jobId);
    try {
      const res = await fetch(`/api/admin/connectors/${row.jobId}/sync`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        toast({ title: "Sync failed", description: data.message ?? data.errorMessage, variant: "error" });
      } else {
        toast({
          title: data.timedOut ? "Sync paused at time limit" : "Sync complete",
          description: `${data.itemsMatched} imported, ${data.itemsFlagged} flagged${
            data.timedOut ? " — resumes on the next run" : ""
          }`,
          variant: "success",
        });
      }
      await load();
    } catch {
      toast({ title: "Sync failed", variant: "error" });
    } finally {
      setBusyJobId(null);
    }
  }

  async function setActive(row: ConnectorRow, isActive: boolean) {
    setBusyJobId(row.jobId);
    // Optimistic — reverted by the reload below if the request failed.
    setRows((prev) => prev?.map((r) => (r.jobId === row.jobId ? { ...r, isActive } : r)) ?? null);
    try {
      const res = await fetch(`/api/admin/connectors/${row.jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error();
      toast({ title: isActive ? "Connector enabled" : "Connector disabled" });
    } catch {
      toast({ title: "Couldn't update connector", variant: "error" });
    } finally {
      await load();
      setBusyJobId(null);
    }
  }

  if (error) return <ErrorState description={error} onRetry={load} />;

  return (
    <>
      <PageHeader
        title="Connectors"
        description="Merchant integrations, their sync health, and manual controls."
      />

      <div className="mt-8">
        {rows === null ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No connectors configured"
            description="Add a sync_jobs row for an approved merchant to get started — see docs/CONNECTORS.md."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => {
              const health = healthOf(row);
              const isBusy = busyJobId === row.jobId;

              return (
                <li
                  key={row.jobId}
                  className="rounded-lg border border-ink-100 p-5 dark:border-ink-800"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h3 className="font-medium text-ink dark:text-paper">{row.merchantName}</h3>
                        <StatusBadge label={health.label} tone={health.tone} />
                      </div>
                      <p className="mt-1 text-sm text-ink-400">
                        {row.connectorName} · {row.jobType.replace(/_/g, " ")}
                      </p>

                      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-500 dark:text-ink-400">
                        <div className="flex gap-1.5">
                          <dt className="text-ink-400">Last run</dt>
                          <dd>{row.lastRunAt ? formatRelativeTime(row.lastRunAt) : "never"}</dd>
                        </div>
                        <div className="flex gap-1.5">
                          <dt className="text-ink-400">Next due</dt>
                          <dd>{row.nextRunAt ? formatRelativeTime(row.nextRunAt) : "now"}</dd>
                        </div>
                        {row.latestRun && (
                          <div className="flex gap-1.5">
                            <dt className="text-ink-400">Last result</dt>
                            <dd className="font-tabular">
                              {row.latestRun.itemsMatched} imported
                              {row.latestRun.itemsFlagged > 0 && `, ${row.latestRun.itemsFlagged} flagged`}
                            </dd>
                          </div>
                        )}
                      </dl>

                      {!row.isRegistered && (
                        <p className="mt-3 flex items-start gap-2 text-sm text-vermilion-600 dark:text-vermilion-400">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          No connector is registered for key &quot;{row.connectorKey}&quot;. Add it to
                          lib/connectors/registry.ts.
                        </p>
                      )}

                      {row.consecutiveFailures >= 5 && (
                        <p className="mt-3 flex items-start gap-2 text-sm text-vermilion-600 dark:text-vermilion-400">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          Skipped by the scheduler after {row.consecutiveFailures} consecutive failures.
                          Fix the cause, then re-enable to clear the counter.
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        leftIcon={<Play className="h-4 w-4" aria-hidden="true" />}
                        isLoading={isBusy}
                        disabled={!row.isActive || !row.isImplemented || isBusy}
                        onClick={() => syncNow(row)}
                      >
                        Sync now
                      </Button>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={row.isActive}
                        aria-label={row.isActive ? "Disable connector" : "Enable connector"}
                        disabled={isBusy || !row.isImplemented}
                        onClick={() => setActive(row, !row.isActive)}
                        data-active={row.isActive}
                        className="relative h-6 w-11 shrink-0 rounded-full bg-ink-200 transition-colors disabled:opacity-40 data-[active=true]:bg-jade-500 dark:bg-ink-700"
                      >
                        <span
                          className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                          style={{ transform: row.isActive ? "translateX(20px)" : "translateX(0)" }}
                        />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

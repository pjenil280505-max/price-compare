"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { formatRelativeTime } from "@/lib/utils";
import { useAdminData } from "@/components/admin/useAdminData";
import { AdminSectionState } from "@/components/admin/AdminSectionState";
import { AdminList, AdminNotice, AdminRecordCard, AdminSection } from "@/components/admin/AdminPrimitives";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface Payload {
  periodDays: number;
  totalRecordFailures: number;
  failedRuns: {
    id: string; merchant: string; startedAt: string;
    itemsProcessed: number; itemsFlagged: number; error: string | null;
  }[];
  failureGroups: { reason: string; stage: string; count: number; example: string | null }[];
}

export default function AdminSyncErrorsPage() {
  const { data, error, forbidden, loading, reload } = useAdminData<Payload>("/api/admin/sync-errors?days=7");

  return (
    <>
      <PageHeader title="Sync errors" description="Failed runs and rejected records from the last 7 days." />
      <div className="mt-8">
        {loading || error ? (
          <AdminSectionState loading={loading} forbidden={forbidden} error={error} onRetry={reload} />
        ) : (
          <>
            <AdminSection title="Failed runs" className="mt-0">
              {data!.failedRuns.length === 0 ? (
                <AdminNotice>No failed sync runs in this period.</AdminNotice>
              ) : (
                <AdminList>
                  {data!.failedRuns.map((run) => (
                    <AdminRecordCard
                      key={run.id}
                      title={run.merchant}
                      subtitle={formatRelativeTime(run.startedAt)}
                      badge={<StatusBadge label="error" tone="error" />}
                      fields={[
                        { label: "Processed", value: run.itemsProcessed },
                        { label: "Flagged", value: run.itemsFlagged },
                      ]}
                    >
                      {run.error && (
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-ink-50 p-3 font-mono text-[11px] leading-relaxed text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                          {run.error}
                        </pre>
                      )}
                    </AdminRecordCard>
                  ))}
                </AdminList>
              )}
            </AdminSection>

            <AdminSection
              title="Rejected records"
              description={`${data!.totalRecordFailures} individual items were rejected, grouped by cause.`}
            >
              {data!.failureGroups.length === 0 ? (
                <AdminNotice>No records were rejected in this period.</AdminNotice>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data!.failureGroups.map((g, i) => (
                    <li key={i} className="rounded-lg border border-ink-100 bg-paper p-4 dark:border-ink-800 dark:bg-ink-900">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge label={g.stage} tone={g.stage === "validate" ? "pending" : "error"} />
                        <span className="font-tabular text-sm font-semibold text-ink dark:text-paper">
                          {g.count.toLocaleString("en-IN")} item{g.count === 1 ? "" : "s"}
                        </span>
                      </div>
                      <p className="mt-2 break-words font-mono text-xs text-ink-600 dark:text-ink-300">{g.reason}</p>
                      {g.example && (
                        <p className="mt-1 text-xs text-ink-400">Example id: {g.example}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </AdminSection>
          </>
        )}
      </div>
    </>
  );
}

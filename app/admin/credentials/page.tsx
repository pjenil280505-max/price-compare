"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAdminData } from "@/components/admin/useAdminData";
import { AdminSectionState } from "@/components/admin/AdminSectionState";
import { AdminList, AdminNotice, AdminRecordCard, AdminSection } from "@/components/admin/AdminPrimitives";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface Payload {
  connectorCredentials: {
    merchantName: string; connectorKey: string; connectorRegistered: boolean;
    envVarPrefix: string | null; allConfigured: boolean;
    required: { envVar: string; configured: boolean }[];
  }[];
  affiliateCredentials: {
    merchantName: string; network: string; isActive: boolean;
    trackingIdEnvVar: string | null; configured: boolean;
  }[];
}

function EnvVar({ name, configured }: { name: string; configured: boolean }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {configured ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-jade-600 dark:text-jade-400" aria-hidden="true" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0 text-vermilion-600 dark:text-vermilion-400" aria-hidden="true" />
      )}
      <code className="min-w-0 truncate font-mono text-xs text-ink-600 dark:text-ink-300">{name}</code>
      <span className="ml-auto shrink-0 text-xs text-ink-400">{configured ? "set" : "not set"}</span>
    </li>
  );
}

export default function AdminCredentialsPage() {
  const { data, error, forbidden, loading, reload } = useAdminData<Payload>("/api/admin/credentials");

  return (
    <>
      <PageHeader
        title="API credentials"
        description="Which environment variables each integration needs, and whether they're set."
      />

      <AdminNotice tone="warn">
        Credential <strong>values are never shown here or stored in the database</strong> — only the
        variable name and whether it is currently set. To change one, update the environment variable
        in your hosting dashboard and redeploy.
      </AdminNotice>

      <div className="mt-6">
        {loading || error ? (
          <AdminSectionState loading={loading} forbidden={forbidden} error={error} onRetry={reload} />
        ) : (
          <>
            <AdminSection title="Connectors" className="mt-0">
              {data!.connectorCredentials.length === 0 ? (
                <AdminNotice>No connectors configured yet.</AdminNotice>
              ) : (
                <AdminList>
                  {data!.connectorCredentials.map((c) => (
                    <AdminRecordCard
                      key={`${c.merchantName}-${c.connectorKey}`}
                      title={c.merchantName}
                      subtitle={c.connectorKey}
                      badge={
                        <StatusBadge
                          label={c.allConfigured ? "ready" : "incomplete"}
                          tone={c.allConfigured ? "success" : "error"}
                        />
                      }
                      warning={
                        !c.connectorRegistered
                          ? `No connector registered for "${c.connectorKey}". Add it to lib/connectors/registry.ts.`
                          : !c.envVarPrefix
                            ? "No env_var_prefix set on this merchant's affiliate configuration — credentials cannot be resolved."
                            : undefined
                      }
                    >
                      {c.required.length > 0 && (
                        <ul className="flex flex-col gap-1.5">
                          {c.required.map((r) => (
                            <EnvVar key={r.envVar} name={r.envVar} configured={r.configured} />
                          ))}
                        </ul>
                      )}
                    </AdminRecordCard>
                  ))}
                </AdminList>
              )}

            </AdminSection>

            <AdminSection title="Affiliate networks">
              {data!.affiliateCredentials.length === 0 ? (
                <AdminNotice>No affiliate configurations yet.</AdminNotice>
              ) : (
                <ul className="flex flex-col gap-3">
                  {data!.affiliateCredentials.map((a) => (
                    <li key={`${a.merchantName}-${a.network}`} className="rounded-lg border border-ink-100 bg-paper p-4 dark:border-ink-800 dark:bg-ink-900">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink dark:text-paper">{a.merchantName}</span>
                        <span className="text-sm text-ink-400">{a.network}</span>
                        <StatusBadge
                          label={!a.isActive ? "inactive" : a.configured ? "ready" : "env var missing"}
                          tone={!a.isActive ? "neutral" : a.configured ? "success" : "error"}
                        />
                      </div>
                      {a.trackingIdEnvVar && (
                        <ul className="mt-2">
                          <EnvVar name={a.trackingIdEnvVar} configured={a.configured} />
                        </ul>
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

"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { formatRelativeTime } from "@/lib/utils";
import { useAdminData } from "@/components/admin/useAdminData";
import { AdminSectionState } from "@/components/admin/AdminSectionState";
import { AdminList, AdminNotice, AdminRecordCard, MetricGrid, MetricTile } from "@/components/admin/AdminPrimitives";

interface Payload {
  totalUsers: number;
  users: { ref: string; displayName: string | null; joinedAt: string; wishlistCount: number; alertCount: number }[];
}

export default function AdminUsersPage() {
  const { data, error, forbidden, loading, reload } = useAdminData<Payload>("/api/admin/users");

  return (
    <>
      <PageHeader title="Users" description="Account activity for support purposes." />

      <AdminNotice>
        Email addresses, wishlist contents and browsing history are deliberately{" "}
        <strong>not shown here</strong>. Operating the platform doesn&apos;t require reading a
        user&apos;s shopping data, and an admin panel that exposes it becomes a breach the moment an
        admin account is compromised.
      </AdminNotice>

      <div className="mt-6">
        {loading || error ? (
          <AdminSectionState loading={loading} forbidden={forbidden} error={error} onRetry={reload} />
        ) : (
          <>
            <MetricGrid>
              <MetricTile label="Total accounts" value={data!.totalUsers} />
              <MetricTile
                label="With alerts"
                value={data!.users.filter((u) => u.alertCount > 0).length}
                hint="in this page"
              />
              <MetricTile
                label="With wishlists"
                value={data!.users.filter((u) => u.wishlistCount > 0).length}
                hint="in this page"
              />
            </MetricGrid>

            <div className="mt-6">
              {data!.users.length === 0 ? (
                <AdminNotice>No accounts yet.</AdminNotice>
              ) : (
                <AdminList>
                  {data!.users.map((u) => (
                    <AdminRecordCard
                      key={u.ref}
                      title={u.displayName || "(no display name)"}
                      subtitle={<code className="font-mono text-xs">ref {u.ref}</code>}
                      fields={[
                        { label: "Joined", value: formatRelativeTime(u.joinedAt) },
                        { label: "Wishlist", value: u.wishlistCount },
                        { label: "Alerts", value: u.alertCount },
                      ]}
                    />
                  ))}
                </AdminList>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

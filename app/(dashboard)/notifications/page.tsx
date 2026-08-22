"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, BellOff, Check } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatRelativeTime } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";

interface Notification {
  id: string;
  type: string;
  title: string;
  body?: string;
  relatedProductSlug?: string;
  isRead: boolean;
  createdAt: string;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) throw new Error();
      setItems(await res.json());
    } catch {
      setError("Couldn't load your notifications.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(n: Notification) {
    if (n.isRead) return;
    setItems((prev) => prev?.map((i) => (i.id === n.id ? { ...i, isRead: true } : i)) ?? null);
    try {
      const res = await fetch(`/api/notifications/${n.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      });
      if (!res.ok) throw new Error();
    } catch {
      await load();
      toast({ title: "Couldn't update that notification", variant: "error" });
    }
  }

  async function markAllRead() {
    const unread = items?.filter((i) => !i.isRead) ?? [];
    setItems((prev) => prev?.map((i) => ({ ...i, isRead: true })) ?? null);
    await Promise.all(
      unread.map((n) =>
        fetch(`/api/notifications/${n.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isRead: true }),
        }).catch(() => null),
      ),
    );
    await load();
  }

  if (error) return <ErrorState description={error} onRetry={load} />;

  const unreadCount = items?.filter((i) => !i.isRead).length ?? 0;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Every alert that has fired for you."
        actions={
          unreadCount > 0 ? (
            <Button variant="outline" size="sm" leftIcon={<Check className="h-4 w-4" aria-hidden="true" />} onClick={markAllRead}>
              Mark all read
            </Button>
          ) : undefined
        }
      />

      <div className="mt-8">
        {items === null ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<BellOff className="h-10 w-10" strokeWidth={1.5} />}
            title="No notifications yet"
            description="When a price alert hits its target, it'll appear here."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((n) => {
              const inner = (
                <>
                  <span
                    className={
                      "mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full " +
                      (n.isRead
                        ? "bg-ink-100 text-ink-400 dark:bg-ink-800"
                        : "bg-jade-50 text-jade-600 dark:bg-jade-700/20 dark:text-jade-300")
                    }
                  >
                    <Bell className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink dark:text-paper">{n.title}</span>
                    {n.body && <span className="mt-0.5 block text-sm text-ink-500 dark:text-ink-400">{n.body}</span>}
                    <span className="mt-1 block text-xs text-ink-400">{formatRelativeTime(n.createdAt)}</span>
                  </span>
                  {!n.isRead && (
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-saffron" aria-label="Unread" />
                  )}
                </>
              );

              return (
                <li key={n.id}>
                  {n.relatedProductSlug ? (
                    <Link
                      href={`/products/${n.relatedProductSlug}`}
                      onClick={() => markRead(n)}
                      className="flex gap-3 rounded-lg border border-ink-100 p-4 transition-colors hover:border-saffron-300 dark:border-ink-800"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      // The visible content is the notification card
                      // itself; an explicit label tells a screen-reader
                      // user what activating it actually does.
                      aria-label={`Mark "${n.title}" as read`}
                      onClick={() => markRead(n)}
                      className="flex w-full gap-3 rounded-lg border border-ink-100 p-4 text-left dark:border-ink-800"
                    >
                      {inner}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="mt-8 text-xs text-ink-400">
        Prefer fewer emails?{" "}
        <Link href="/account/settings" className="underline underline-offset-2">
          Change your notification settings
        </Link>
        .
      </p>
    </>
  );
}

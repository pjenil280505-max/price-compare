"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, ArrowLeftRight, Check, Undo2, X } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface Conflict {
  axis: string;
  left: string;
  right: string;
  severity: string;
}

interface Review {
  id: string;
  confidence: number;
  tier: string | null;
  conflicts: Conflict[];
  reasons: string[];
  createdAt: string;
  incoming: {
    merchantName: string;
    title: string;
    imageUrl: string;
    variantLabel: string;
    snapshot: { axes?: Record<string, string> };
  };
  candidate: { productId: string; title: string; slug: string; imageUrl: string };
}

interface MergeEntry {
  id: string;
  action: string;
  primaryTitle: string | null;
  secondaryTitle: string | null;
  matchTier: string | null;
  reason: string | null;
  createdAt: string;
  canUndo: boolean;
}

function confidenceTone(c: number): StatusTone {
  if (c >= 0.8) return "success";
  if (c >= 0.65) return "pending";
  return "neutral";
}

function AxisList({ axes }: { axes: Record<string, string> | undefined }) {
  const entries = Object.entries(axes ?? {});
  if (entries.length === 0) return <p className="text-xs text-ink-400">No variant attributes detected</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {entries.map(([axis, value]) => (
        <li
          key={axis}
          className="rounded-full bg-ink-50 px-2 py-0.5 text-xs text-ink-600 dark:bg-ink-800 dark:text-ink-300"
        >
          {axis}: <span className="font-medium">{value}</span>
        </li>
      ))}
    </ul>
  );
}

function ReviewQueue() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/matches?status=pending");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setReviews(data.reviews);
    } catch {
      setError("Couldn't load the review queue.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(review: Review, decision: "approved" | "rejected") {
    setBusyId(review.id);
    try {
      const res = await fetch(`/api/admin/matches/${review.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Couldn't apply that decision", description: data.message, variant: "error" });
      } else {
        toast({
          title: decision === "approved" ? "Products merged" : "Match rejected",
          description: decision === "approved" ? "Reversible from the History tab." : undefined,
          variant: "success",
        });
        setReviews((prev) => prev?.filter((r) => r.id !== review.id) ?? null);
      }
    } catch {
      toast({ title: "Something went wrong", variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (reviews === null) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (reviews.length === 0) {
    return (
      <EmptyState
        title="Nothing to review"
        description="High-confidence matches merge automatically. Uncertain ones appear here."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {reviews.map((review) => {
        const hardConflicts = review.conflicts.filter((c) => c.severity === "hard");
        const isBusy = busyId === review.id;

        return (
          <li key={review.id} className="rounded-lg border border-ink-100 p-5 dark:border-ink-800">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  label={`${Math.round(review.confidence * 100)}% confident`}
                  tone={confidenceTone(review.confidence)}
                />
                {review.tier && (
                  <span className="rounded-full bg-ink-50 px-2.5 py-1 text-xs font-medium text-ink-500 dark:bg-ink-800 dark:text-ink-300">
                    tier: {review.tier}
                  </span>
                )}
                <span className="text-xs text-ink-400">{formatRelativeTime(review.createdAt)}</span>
              </div>
            </div>

            {hardConflicts.length > 0 && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-vermilion-200 bg-vermilion-50 p-3 dark:border-vermilion-700/40 dark:bg-vermilion-700/10">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-vermilion-600" aria-hidden="true" />
                <div className="text-sm text-vermilion-700 dark:text-vermilion-300">
                  <p className="font-semibold">These look like different variants, not the same item.</p>
                  <ul className="mt-1">
                    {hardConflicts.map((c) => (
                      <li key={c.axis}>
                        {c.axis}: <strong>{c.left}</strong> vs <strong>{c.right}</strong>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1">Approving will keep them as separate variants, never one combined listing.</p>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <div className="flex gap-3">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-ink-50 dark:bg-ink-800">
                  {review.incoming.imageUrl && (
                    <Image src={review.incoming.imageUrl} alt="" fill sizes="64px" className="object-contain p-1" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
                    Incoming · {review.incoming.merchantName}
                  </p>
                  <p className="line-clamp-2 text-sm font-medium text-ink dark:text-paper">
                    {review.incoming.title}
                  </p>
                  <div className="mt-1.5">
                    <AxisList axes={review.incoming.snapshot?.axes} />
                  </div>
                </div>
              </div>

              <ArrowLeftRight className="mx-auto hidden h-5 w-5 text-ink-300 sm:block" aria-hidden="true" />

              <div className="flex gap-3">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-ink-50 dark:bg-ink-800">
                  {review.candidate.imageUrl && (
                    <Image src={review.candidate.imageUrl} alt="" fill sizes="64px" className="object-contain p-1" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Existing product</p>
                  <Link
                    href={`/products/${review.candidate.slug}`}
                    className="line-clamp-2 text-sm font-medium text-ink hover:underline dark:text-paper"
                  >
                    {review.candidate.title}
                  </Link>
                </div>
              </div>
            </div>

            {review.reasons.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-ink-400 hover:text-ink-600">
                  Why was this flagged?
                </summary>
                <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-500 dark:text-ink-400">
                  {review.reasons.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              </details>
            )}

            <div className="mt-4 flex gap-2">
              <Button
                variant="primary"
                size="sm"
                isLoading={isBusy}
                disabled={isBusy}
                leftIcon={<Check className="h-4 w-4" aria-hidden="true" />}
                onClick={() => decide(review, "approved")}
              >
                Same product — merge
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isBusy}
                leftIcon={<X className="h-4 w-4" aria-hidden="true" />}
                onClick={() => decide(review, "rejected")}
              >
                Different — keep separate
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function MergeHistory() {
  const [entries, setEntries] = useState<MergeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/merges");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEntries(data.entries);
    } catch {
      setError("Couldn't load merge history.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function undo(entry: MergeEntry) {
    setBusyId(entry.id);
    try {
      const res = await fetch("/api/admin/merges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unmerge", mergeLogId: entry.id }),
      });
      const data = await res.json();
      if (!res.ok) toast({ title: "Couldn't undo", description: data.message, variant: "error" });
      else toast({ title: "Merge reversed", variant: "success" });
      await load();
    } catch {
      toast({ title: "Something went wrong", variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (entries === null) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (entries.length === 0) return <EmptyState title="No merges yet" />;

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-100 p-4 dark:border-ink-800"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusBadge
                label={entry.action.replace("_", " ")}
                tone={entry.action === "unmerge" ? "neutral" : "success"}
              />
              {entry.matchTier && <span className="text-xs text-ink-400">via {entry.matchTier}</span>}
              <span className="text-xs text-ink-400">{formatRelativeTime(entry.createdAt)}</span>
            </div>
            <p className="mt-1 text-sm text-ink dark:text-paper">
              <span className="text-ink-400">{entry.secondaryTitle ?? "—"}</span>
              {" → "}
              <span className="font-medium">{entry.primaryTitle ?? "—"}</span>
            </p>
            {entry.reason && <p className="mt-0.5 text-xs text-ink-400">{entry.reason}</p>}
          </div>

          {entry.canUndo && (
            <Button
              variant="outline"
              size="sm"
              isLoading={busyId === entry.id}
              disabled={busyId === entry.id}
              leftIcon={<Undo2 className="h-4 w-4" aria-hidden="true" />}
              onClick={() => undo(entry)}
            >
              Undo
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function AdminMatchesPage() {
  return (
    <>
      <PageHeader
        title="Product matching"
        description="High-confidence matches merge automatically. Anything uncertain — or with conflicting variant data — lands here."
      />
      <div className="mt-8">
        <Tabs
          items={[
            { value: "queue", label: "Review queue", content: <ReviewQueue /> },
            { value: "history", label: "Merge history", content: <MergeHistory /> },
          ]}
        />
      </div>
    </>
  );
}

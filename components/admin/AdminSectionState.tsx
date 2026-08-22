"use client";

import { ShieldAlert } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { AdminListSkeleton } from "./AdminPrimitives";

/**
 * Renders the loading / forbidden / error states every admin section
 * shares, so no section reimplements them (and none accidentally shows a
 * retry button for a permission error).
 */
export function AdminSectionState({
  loading,
  forbidden,
  error,
  onRetry,
}: {
  loading: boolean;
  forbidden: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (forbidden) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-saffron-300 bg-saffron-50 px-6 py-12 text-center dark:border-saffron-700/40 dark:bg-saffron-700/10">
        <ShieldAlert className="h-8 w-8 text-saffron-600" aria-hidden="true" />
        <p className="font-medium text-ink dark:text-paper">Not available to your role</p>
        <p className="max-w-sm text-sm text-ink-600 dark:text-ink-300">{error}</p>
      </div>
    );
  }
  if (error) return <ErrorState description={error} onRetry={onRetry} />;
  if (loading) return <AdminListSkeleton />;
  return null;
}

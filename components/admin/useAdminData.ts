"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Shared fetch hook for admin sections.
 *
 * Distinguishes 403 from other failures: a permission error is not a bug
 * and shouldn't be presented as "something went wrong" — the operator
 * needs to know their role lacks access, not retry pointlessly.
 */
export interface AdminDataState<T> {
  data: T | null;
  error: string | null;
  forbidden: boolean;
  loading: boolean;
  reload: () => Promise<void>;
}

export function useAdminData<T>(url: string): AdminDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await fetch(url);
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        setForbidden(true);
        setError(body.message ?? "You don't have permission to view this section.");
        return;
      }
      if (!res.ok) throw new Error();
      setData((await res.json()) as T);
    } catch {
      setError("Couldn't load this section.");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, forbidden, loading, reload };
}

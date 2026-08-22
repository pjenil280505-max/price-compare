"use client";

import { useEffect } from "react";

/**
 * Records a product view for signed-in users.
 *
 * Fire-and-forget and failure-silent: browsing history is a convenience,
 * and it must never delay or break the product page. The endpoint no-ops
 * for signed-out visitors, so anonymous browsing is not tracked at all.
 */
export function RecordProductView({ productId }: { productId: string }) {
  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/recently-viewed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
      signal: controller.signal,
      keepalive: true,
    }).catch(() => {
      // Intentionally ignored.
    });

    return () => controller.abort();
  }, [productId]);

  return null;
}

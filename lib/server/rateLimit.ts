import "server-only";

import { ApiRouteError } from "./errors";

/**
 * Minimal fixed-window rate limiter.
 *
 * IMPORTANT LIMITATION — read before relying on this:
 * state lives in this process's memory, so on serverless/edge (Vercel,
 * Cloudflare Workers) each instance keeps its own counter and the
 * effective limit is `limit × instance count`. It also resets on cold
 * start. That makes this a speed bump against casual abuse, NOT a real
 * quota.
 *
 * For production, swap the Map below for Upstash Redis (already in the
 * platform architecture doc's stack for exactly this) — the function
 * signature is designed so only the storage lines change. Until that's
 * wired up, treat the assistant endpoint's cost exposure as mitigated but
 * not solved.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitOptions {
  /** Distinct name per endpoint, so limits don't share a counter. */
  key: string;
  limit: number;
  windowMs: number;
}

/** Best-effort client identity: prefers the real client IP from proxy headers. */
export function getClientId(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function enforceRateLimit(request: Request, options: RateLimitOptions): void {
  const id = `${options.key}:${getClientId(request)}`;
  const now = Date.now();
  const bucket = buckets.get(id);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(id, { count: 1, resetAt: now + options.windowMs });
    pruneExpired(now);
    return;
  }

  if (bucket.count >= options.limit) {
    throw new ApiRouteError("Too many requests — please slow down.", 429);
  }

  bucket.count += 1;
}

/** Keeps the Map from growing without bound in a long-lived process. */
function pruneExpired(now: number): void {
  if (buckets.size < 5000) return;
  for (const [key, value] of buckets) {
    if (now > value.resetAt) buckets.delete(key);
  }
}

import "server-only";

import { FatalConnectorError, RetryableConnectorError } from "./types";

/**
 * Shared HTTP concerns for all connectors: rate limiting, retries, backoff,
 * and timeouts. Connectors never call fetch() directly — they use this, so
 * every merchant integration gets identical, correct network behaviour
 * without each one reimplementing it (badly, differently).
 */

/** Token bucket. One instance per connector run, created by the engine. */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  // Explicit fields rather than TS "parameter properties" — the latter are
  // non-erasable syntax that breaks plain type-stripping toolchains.
  private readonly ratePerSecond: number;
  private readonly burst: number;

  constructor(ratePerSecond: number, burst?: number) {
    this.ratePerSecond = ratePerSecond;
    this.burst = burst ?? Math.max(1, Math.ceil(ratePerSecond));
    this.tokens = this.burst;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      const elapsedSec = (now - this.lastRefill) / 1000;
      this.tokens = Math.min(this.burst, this.tokens + elapsedSec * this.ratePerSecond);
      this.lastRefill = now;

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      const waitMs = Math.ceil(((1 - this.tokens) / this.ratePerSecond) * 1000);
      await sleep(waitMs);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchOptions {
  headers?: Record<string, string>;
  rateLimiter?: RateLimiter;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  /** Called before each retry, for run logging. */
  onRetry?: (attempt: number, delayMs: number, reason: string) => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 4;

/**
 * Fetch with rate limiting, timeout, and exponential backoff + jitter.
 *
 * Retry classification is deliberate:
 *   - 429 / 5xx / network errors  -> retryable
 *   - 401 / 403                   -> FATAL (retrying bad credentials just
 *                                    burns quota and can get an affiliate
 *                                    account flagged)
 *   - other 4xx                   -> fatal (our request is wrong)
 * Honours a Retry-After header when the server sends one, rather than
 * guessing — servers know their own backoff better than we do.
 */
export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  const {
    headers = {},
    rateLimiter,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    onRetry,
  } = options;

  let lastReason = "unknown";

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal?.aborted) throw new FatalConnectorError("Sync aborted");
    if (rateLimiter) await rateLimiter.acquire();

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

    // Abort if either the caller's signal or our timeout fires.
    const onOuterAbort = () => timeoutController.abort();
    signal?.addEventListener("abort", onOuterAbort);

    try {
      const response = await fetch(url, { headers, signal: timeoutController.signal });

      if (response.ok) return response;

      if (response.status === 401 || response.status === 403) {
        throw new FatalConnectorError(
          `Authentication failed (HTTP ${response.status}). Check this merchant's credentials ` +
            `and that the affiliate account is still approved for API access.`,
        );
      }

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        lastReason = `HTTP ${response.status}`;
        if (attempt < maxRetries) {
          const delay = retryAfter ?? backoffDelay(attempt);
          onRetry?.(attempt + 1, delay, lastReason);
          await sleep(delay);
          continue;
        }
        throw new RetryableConnectorError(`${lastReason} after ${maxRetries} retries`);
      }

      throw new FatalConnectorError(`HTTP ${response.status} — request rejected, not retrying`);
    } catch (error) {
      if (error instanceof FatalConnectorError) throw error;
      if (error instanceof RetryableConnectorError) throw error;

      // Network error / timeout — retryable.
      lastReason = error instanceof Error ? error.message : "network error";
      if (attempt < maxRetries) {
        const delay = backoffDelay(attempt);
        onRetry?.(attempt + 1, delay, lastReason);
        await sleep(delay);
        continue;
      }
      throw new RetryableConnectorError(`${lastReason} after ${maxRetries} retries`);
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onOuterAbort);
    }
  }

  throw new RetryableConnectorError(`Exhausted retries: ${lastReason}`);
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
  });
  return (await response.json()) as T;
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const response = await fetchWithRetry(url, options);
  return response.text();
}

/** Exponential backoff with full jitter, capped at 30s. */
function backoffDelay(attempt: number): number {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return Math.floor(Math.random() * base);
}

/** Retry-After is either delta-seconds or an HTTP date. */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());

  return undefined;
}

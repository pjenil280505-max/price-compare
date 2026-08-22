import { z } from "zod";

/**
 * THE CONNECTOR CONTRACT
 *
 * Adding a merchant means writing one file that exports a MerchantConnector
 * and registering it in registry.ts. Nothing else in the system changes —
 * not the sync engine, not the database schema, not the admin UI, not the
 * API routes. That is the whole point of this interface.
 *
 * A connector's only job is: talk to one merchant's authorized API/feed,
 * and yield NormalizedProduct objects. It does not touch the database,
 * does not decide scheduling, does not handle retries or logging — the
 * engine owns all of that.
 */

// ---------------------------------------------------------------------
// The normalized product — every connector's output, the core's only input
// ---------------------------------------------------------------------

/**
 * Fields are optional wherever a real merchant feed might not supply them.
 * This is deliberate and important: Flipkart's affiliate feed, for example,
 * provides no GTIN/EAN/UPC at all (verified against their official docs).
 * A connector must leave such a field undefined rather than fabricate,
 * derive, or guess it.
 */
export const normalizedProductSchema = z.object({
  /** Merchant's own identifier (Flipkart FSN, Amazon ASIN, feed SKU). Required — this is the idempotency key. */
  externalId: z.string().min(1).max(255),
  title: z.string().min(1).max(1000),
  /** Merchant product page URL, already affiliate-tagged by the merchant or built via their documented link format. */
  productUrl: z.string().url(),

  price: z.number().nonnegative().finite(),
  currency: z.literal("INR"),
  /** Maximum retail / list price, when the feed distinguishes it from the selling price. */
  mrp: z.number().nonnegative().finite().optional(),
  /** Only set when the feed states it. The core derives discount from mrp/price when absent. */
  discountPercent: z.number().min(0).max(100).optional(),

  inStock: z.boolean(),
  codAvailable: z.boolean().optional(),

  brand: z.string().max(255).optional(),
  /** Leaf category name. The engine get-or-creates it; taxonomy curation is a separate admin task. */
  category: z.string().max(255).optional(),
  description: z.string().max(20000).optional(),
  imageUrls: z.array(z.string().url()).default([]),

  /** Global trade identifier, ONLY if the merchant actually publishes one. */
  gtin: z.string().max(64).optional(),
  /** Manufacturer part number — matching tier 2, when the feed publishes one. */
  mpn: z.string().max(128).optional(),
  model: z.string().max(255).optional(),
  /** Merchant SKU when distinct from externalId. */
  sku: z.string().max(255).optional(),

  /** Human-readable variant label, e.g. "128GB · Midnight Black". Defaults to "Standard" downstream. */
  variantLabel: z.string().max(255).optional(),
  /** Structured variant axes, e.g. { color: "Black", storage: "128GB" }. */
  variantAttributes: z.record(z.string()).default({}),

  specs: z.record(z.string()).default({}),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().nonnegative().optional(),

  /**
   * Delta feeds signal deletions. When false, the engine deactivates the
   * offer instead of upserting it.
   */
  isAvailable: z.boolean().default(true),
});

export type NormalizedProduct = z.infer<typeof normalizedProductSchema>;

// ---------------------------------------------------------------------
// Sync modes and results
// ---------------------------------------------------------------------

export type SyncMode = "full_catalog" | "delta_price" | "delta_stock";

/** Opaque per-connector resume state, persisted to connector_state.cursor. */
export type ConnectorCursor = Record<string, unknown>;

export interface ConnectorContext {
  /** Non-secret config from sync_jobs.config. */
  config: Record<string, unknown>;
  /**
   * Credentials resolved from environment variables by the engine.
   * Connectors receive already-resolved values and never read process.env
   * themselves — that keeps every secret lookup in one auditable place.
   */
  credentials: Record<string, string>;
  cursor: ConnectorCursor;
  /** Structured logging into the current sync run. */
  log: (message: string, meta?: Record<string, unknown>) => void;
  /** Cooperative cancellation (time budget exceeded, admin disabled the job). */
  signal: AbortSignal;
}

/**
 * One page of results. Connectors yield these lazily so the engine can
 * persist incrementally and a long catalog sync never has to fit in memory.
 */
export interface ConnectorPage {
  products: NormalizedProduct[];
  /** Updated cursor to persist after this page commits, enabling resume. */
  cursor?: ConnectorCursor;
  /** Items that couldn't be parsed — recorded to sync_failures, don't abort the run. */
  failures?: ConnectorFailure[];
}

export interface ConnectorFailure {
  externalId?: string;
  stage: "fetch" | "parse" | "validate" | "persist";
  reason: string;
  raw?: unknown;
}

// ---------------------------------------------------------------------
// The interface itself
// ---------------------------------------------------------------------

export interface MerchantConnector {
  /** Stable identifier stored in sync_jobs.connector_key. */
  readonly key: string;
  readonly displayName: string;

  /** Which sync modes this merchant's API actually supports. */
  readonly supportedModes: readonly SyncMode[];

  /**
   * Names of environment variables this connector requires, WITHOUT the
   * per-merchant prefix. The engine resolves `${env_var_prefix}_${name}`
   * and fails fast with a clear message if any are missing — so a
   * misconfigured connector never silently produces an empty sync.
   */
  readonly requiredCredentials: readonly string[];

  /** Requests per second this connector may make. The engine enforces it. */
  readonly rateLimitPerSecond: number;

  /**
   * Optional cheap credential/connectivity check, used by the admin UI's
   * "Test connection" before committing to a full sync.
   */
  testConnection?(ctx: ConnectorContext): Promise<{ ok: boolean; message: string }>;

  /**
   * Yields pages of products. An async generator, so the engine can persist
   * page-by-page, respect a time budget, and resume from a cursor — rather
   * than the connector buffering an entire catalog.
   */
  sync(mode: SyncMode, ctx: ConnectorContext): AsyncGenerator<ConnectorPage, void, void>;
}

/** Thrown by connectors for errors the engine should treat as retryable. */
export class RetryableConnectorError extends Error {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = "RetryableConnectorError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** Thrown for errors retrying cannot fix (bad credentials, revoked access). */
export class FatalConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalConnectorError";
  }
}

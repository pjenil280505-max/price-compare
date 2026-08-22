import "server-only";

import { XMLParser } from "fast-xml-parser";
import Papa from "papaparse";
import { fetchText, RateLimiter } from "../http";
import {
  FatalConnectorError,
  type ConnectorContext,
  type ConnectorFailure,
  type ConnectorPage,
  type MerchantConnector,
  type NormalizedProduct,
  type SyncMode,
} from "../types";

/**
 * GENERIC PRODUCT FEED CONNECTOR (XML / CSV / TSV)
 *
 * Most affiliate networks — Admitad, CJ, Awin, Rakuten, and many direct
 * merchant programs — do not expose a bespoke REST API. They give an
 * approved publisher a FEED URL returning XML or CSV, where the column /
 * element names differ per network and often per advertiser.
 *
 * Rather than hard-code any one network's schema (which would mean
 * guessing at field names I cannot verify), this connector is driven
 * entirely by a field mapping supplied in sync_jobs.config — taken from
 * the feed documentation the operator receives on approval, or by
 * inspecting the first few rows of their actual feed.
 *
 * That makes ONE connector cover an unlimited number of feed-based
 * merchants: adding another is a database row, not code.
 *
 * REQUIRED APPROVAL & CREDENTIALS:
 *   - An approved publisher/affiliate account with the network.
 *   - A feed URL. Many networks embed a key in the URL itself; if so, put
 *     the whole URL in the FEED_URL environment variable (a secret), NOT
 *     in sync_jobs.config, which is admin-readable.
 *   Env vars: <PREFIX>_FEED_URL, and optionally <PREFIX>_FEED_TOKEN.
 *
 * WHAT THIS CONNECTOR WILL NOT DO:
 *   - It will not fetch a page and scrape it. If a merchant has no
 *     authorized feed, they cannot be added. That's a hard limit by
 *     design, not an oversight.
 */

interface FieldMapping {
  /** Dot-path (XML) or column name (CSV) for each normalized field. */
  externalId: string;
  title: string;
  productUrl: string;
  price: string;
  mrp?: string;
  currency?: string;
  inStock?: string;
  brand?: string;
  category?: string;
  description?: string;
  /** Single image field, or a repeated element/delimited list. */
  imageUrl?: string;
  gtin?: string;
  mpn?: string;
  model?: string;
  sku?: string;
  /** Map of variant axis name -> source field, e.g. { color: "attrs.color" }. */
  variantAttributes?: Record<string, string>;
}

interface GenericFeedConfig {
  format: "xml" | "csv" | "tsv";
  /** For XML: dot-path to the repeated product element, e.g. "catalog.offers.offer". */
  itemPath?: string;
  mapping: FieldMapping;
  /** Values in the inStock field that mean "in stock". Default: true/yes/1/in stock/available. */
  inStockTruthy?: string[];
  /** Separator when imageUrl holds several URLs in one string. */
  imageDelimiter?: string;
  /** Items yielded per page to the engine. */
  batchSize?: number;
}

const DEFAULT_TRUTHY = ["true", "yes", "1", "in stock", "instock", "available", "y"];

export const genericFeedConnector: MerchantConnector = {
  key: "generic_product_feed",
  displayName: "Generic Product Feed (XML/CSV)",
  supportedModes: ["full_catalog"],
  requiredCredentials: ["FEED_URL"],
  // One request per run in practice (a single feed download), so this only
  // matters if a feed is split across several URLs.
  rateLimitPerSecond: 1,

  async testConnection(ctx) {
    const feedUrl = ctx.credentials.FEED_URL;
    if (!feedUrl) return { ok: false, message: "FEED_URL is not set" };
    try {
      const body = await fetchText(feedUrl, { signal: ctx.signal, timeoutMs: 20_000 });
      return { ok: true, message: `Feed reachable (${body.length.toLocaleString()} bytes).` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Fetch failed" };
    }
  },

  async *sync(_mode: SyncMode, ctx: ConnectorContext): AsyncGenerator<ConnectorPage, void, void> {
    const config = ctx.config as unknown as GenericFeedConfig;
    validateConfig(config);

    const feedUrl = ctx.credentials.FEED_URL;
    if (!feedUrl) throw new FatalConnectorError("FEED_URL credential is missing");

    const rateLimiter = new RateLimiter(genericFeedConnector.rateLimitPerSecond);
    const batchSize = config.batchSize ?? 500;

    ctx.log(`Downloading ${config.format.toUpperCase()} feed`);
    const body = await fetchText(feedUrl, {
      rateLimiter,
      signal: ctx.signal,
      // Feeds are large files; allow well past the default HTTP timeout.
      timeoutMs: 120_000,
      onRetry: (attempt, delayMs, reason) =>
        ctx.log(`Feed download retry ${attempt} in ${delayMs}ms (${reason})`),
    });

    const rawItems = config.format === "xml" ? parseXml(body, config) : parseDelimited(body, config);
    ctx.log(`Parsed ${rawItems.length.toLocaleString()} raw items from feed`);

    let batch: NormalizedProduct[] = [];
    let failures: ConnectorFailure[] = [];

    for (const raw of rawItems) {
      if (ctx.signal.aborted) return;

      try {
        const mapped = mapItem(raw, config);
        if (mapped) batch.push(mapped);
        else
          failures.push({
            stage: "parse",
            reason: "Missing one of the required mapped fields (externalId, title, productUrl, price)",
            raw,
          });
      } catch (error) {
        failures.push({
          stage: "parse",
          reason: error instanceof Error ? error.message : "Unknown mapping error",
          raw,
        });
      }

      if (batch.length >= batchSize) {
        yield { products: batch, failures };
        batch = [];
        failures = [];
      }
    }

    if (batch.length > 0 || failures.length > 0) {
      yield { products: batch, failures };
    }
  },
};

function validateConfig(config: GenericFeedConfig): void {
  if (!config?.format) throw new FatalConnectorError("config.format is required (xml|csv|tsv)");
  if (!config.mapping) throw new FatalConnectorError("config.mapping is required");

  for (const field of ["externalId", "title", "productUrl", "price"] as const) {
    if (!config.mapping[field]) {
      throw new FatalConnectorError(`config.mapping.${field} is required`);
    }
  }
  if (config.format === "xml" && !config.itemPath) {
    throw new FatalConnectorError("config.itemPath is required for XML feeds");
  }
}

type RawItem = Record<string, unknown>;

function parseXml(body: string, config: GenericFeedConfig): RawItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    trimValues: true,
    // Keep values as strings; the mapper does its own numeric coercion, and
    // auto-parsing silently mangles things like leading-zero SKUs.
    parseTagValue: false,
    parseAttributeValue: false,
  });

  const parsed = parser.parse(body) as Record<string, unknown>;
  const items = getPath(parsed, config.itemPath!);

  if (items == null) return [];
  return (Array.isArray(items) ? items : [items]) as RawItem[];
}

function parseDelimited(body: string, config: GenericFeedConfig): RawItem[] {
  const result = Papa.parse<RawItem>(body, {
    header: true,
    skipEmptyLines: true,
    delimiter: config.format === "tsv" ? "\t" : ",",
    transformHeader: (header: string) => header.trim(),
  });
  return result.data ?? [];
}

/** Resolves "a.b.c" against a nested object. */
function getPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, segment) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[segment];
  }, source);
}

function readString(raw: RawItem, path: string | undefined): string | undefined {
  if (!path) return undefined;
  const value = getPath(raw, path);
  if (value == null) return undefined;
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

function readNumber(raw: RawItem, path: string | undefined): number | undefined {
  const text = readString(raw, path);
  if (text == null) return undefined;
  // Strip currency symbols, thousands separators, and stray whitespace.
  const cleaned = text.replace(/[^0-9.\-]/g, "");
  // Guard against Number("") === 0: without this, an unparseable value like
  // "N/A" or "Call for price" would silently become a ₹0 product rather
  // than being rejected and logged as a parse failure.
  if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

function mapItem(raw: RawItem, config: GenericFeedConfig): NormalizedProduct | null {
  const m = config.mapping;

  const externalId = readString(raw, m.externalId);
  const title = readString(raw, m.title);
  const productUrl = readString(raw, m.productUrl);
  const price = readNumber(raw, m.price);

  if (!externalId || !title || !productUrl || price == null) return null;

  const truthy = (config.inStockTruthy ?? DEFAULT_TRUTHY).map((v) => v.toLowerCase());
  const stockRaw = readString(raw, m.inStock);
  // Absent stock field means the feed only lists purchasable items.
  const inStock = stockRaw == null ? true : truthy.includes(stockRaw.toLowerCase());

  const imageRaw = m.imageUrl ? getPath(raw, m.imageUrl) : undefined;
  const imageUrls = normalizeImages(imageRaw, config.imageDelimiter);

  const variantAttributes: Record<string, string> = {};
  for (const [axis, path] of Object.entries(m.variantAttributes ?? {})) {
    const value = readString(raw, path);
    if (value) variantAttributes[axis] = value;
  }
  const variantLabel = Object.values(variantAttributes).join(" · ") || undefined;

  const mrp = readNumber(raw, m.mrp);

  return {
    externalId,
    title,
    productUrl,
    price,
    currency: "INR",
    mrp: mrp != null && mrp > price ? mrp : undefined,
    inStock,
    brand: readString(raw, m.brand),
    category: readString(raw, m.category),
    description: readString(raw, m.description),
    imageUrls,
    gtin: readString(raw, m.gtin),
    mpn: readString(raw, m.mpn),
    model: readString(raw, m.model),
    sku: readString(raw, m.sku),
    variantLabel,
    variantAttributes,
    specs: {},
    isAvailable: true,
  };
}

/** Images may arrive as one URL, a delimited string, or a repeated XML element. */
function normalizeImages(value: unknown, delimiter?: string): string[] {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(isHttpUrl);
  }

  const text = String(value).trim();
  if (!text) return [];

  if (delimiter) {
    return text.split(delimiter).map((s) => s.trim()).filter(isHttpUrl);
  }
  return isHttpUrl(text) ? [text] : [];
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

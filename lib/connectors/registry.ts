import "server-only";

import type { MerchantConnector } from "./types";
import { flipkartConnector } from "./flipkart/connector";
import { genericFeedConnector } from "./generic-feed/connector";
import { amazonConnector } from "./amazon/connector";

/**
 * THE ONLY FILE THAT CHANGES WHEN YOU ADD A MERCHANT.
 *
 * Adding merchant #5, #20, or #100:
 *   1. Write lib/connectors/<name>/connector.ts implementing MerchantConnector.
 *   2. Add one line to the array below.
 *   3. Insert a sync_jobs row with that connector_key + config.
 *
 * No changes to the sync engine, database schema, API routes, admin UI, or
 * scheduler. That is the architectural guarantee this registry exists to
 * provide.
 *
 * Note that genericFeedConnector alone covers any number of XML/CSV
 * feed-based merchants — those need only step 3, since their differences
 * live entirely in per-job configuration rather than in code.
 */
const CONNECTORS: readonly MerchantConnector[] = [
  flipkartConnector,
  genericFeedConnector,
  amazonConnector,
];

const byKey = new Map(CONNECTORS.map((connector) => [connector.key, connector]));

export function getConnector(key: string): MerchantConnector | undefined {
  return byKey.get(key);
}

export function listConnectors(): readonly MerchantConnector[] {
  return CONNECTORS;
}

/** Metadata for the admin UI — no implementation details leak to the client. */
export interface ConnectorInfo {
  key: string;
  displayName: string;
  supportedModes: string[];
  requiredCredentials: string[];
  rateLimitPerSecond: number;
  isImplemented: boolean;
}

export function describeConnectors(): ConnectorInfo[] {
  return CONNECTORS.map((connector) => ({
    key: connector.key,
    displayName: connector.displayName,
    supportedModes: [...connector.supportedModes],
    requiredCredentials: [...connector.requiredCredentials],
    rateLimitPerSecond: connector.rateLimitPerSecond,
    // A connector advertising zero modes is a documented placeholder
    // (see amazon/connector.ts), not a working integration.
    isImplemented: connector.supportedModes.length > 0,
  }));
}

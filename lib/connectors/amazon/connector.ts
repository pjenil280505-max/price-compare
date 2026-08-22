import "server-only";

import { FatalConnectorError, type ConnectorPage, type MerchantConnector, type SyncMode } from "../types";

/**
 * AMAZON — NOT IMPLEMENTED, DELIBERATELY.
 *
 * This file exists to document why, and to make the gap visible in the
 * admin UI rather than silently absent.
 *
 * As of the last verification (see the platform architecture doc), Amazon's
 * affiliate product data access is in transition:
 *
 *   1. The long-standing Product Advertising API (PA-API 5.0) is being
 *      retired in favour of a new OAuth-based Creators API.
 *   2. Access is gated behind a trailing-30-day qualifying-sales
 *      requirement — an approved Associates account alone is NOT enough to
 *      obtain or keep API credentials.
 *
 * Both facts mean a new site with no sales history cannot obtain working
 * credentials on day one, regardless of how good the connector code is.
 *
 * I have NOT written a speculative implementation, because doing so would
 * require inventing endpoint paths, request signing, and response shapes
 * for an API whose current specification I cannot verify. A connector that
 * looks finished but is built on guessed field names is worse than an
 * honest gap: it fails at runtime, in production, against a live merchant.
 *
 * TO IMPLEMENT THIS LATER:
 *   1. Get the Associates account approved and clear the qualifying-sales
 *      threshold so API access is actually granted.
 *   2. Read the current official Creators API documentation from the
 *      developer portal you're granted access to.
 *   3. Copy lib/connectors/flipkart/ as the structural template — the
 *      interface, HTTP layer, pagination, retries, and engine integration
 *      are all merchant-agnostic and need no changes.
 *   4. Map their response into NormalizedProduct in a mapper.ts, marking
 *      any field they don't publish as undefined rather than deriving it.
 *   5. Register the connector in registry.ts and insert a sync_jobs row.
 *
 * Note that Amazon DOES publish GTIN/EAN/UPC for many items, which would
 * materially improve cross-merchant product matching — Flipkart does not.
 * That's a good reason to prioritize this once eligibility is met.
 */
export const amazonConnector: MerchantConnector = {
  key: "amazon_creators",
  displayName: "Amazon (not yet available)",
  supportedModes: [],
  requiredCredentials: [],
  rateLimitPerSecond: 1,

  async testConnection() {
    return {
      ok: false,
      message:
        "Amazon's affiliate API is mid-migration to the Creators API and requires qualifying sales " +
        "to obtain credentials. Not implementable until access is granted — see this file's comments.",
    };
  },

  // eslint-disable-next-line require-yield
  async *sync(_mode: SyncMode): AsyncGenerator<ConnectorPage, void, void> {
    throw new FatalConnectorError(
      "The Amazon connector is intentionally unimplemented. See lib/connectors/amazon/connector.ts " +
        "for the approval prerequisites and implementation steps.",
    );
  },
};

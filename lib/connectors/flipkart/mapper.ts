import type { NormalizedProduct } from "../types";

/**
 * Response shapes transcribed from Flipkart's official Affiliate API 1.0
 * documentation (https://affiliate.flipkart.com/api-docs/af_prod_ref.html),
 * v1.1.0 variant. Nothing here is guessed — every field name below appears
 * in their published response schema.
 *
 * WHAT FLIPKART DOES **NOT** PROVIDE (verified against those docs):
 *   - GTIN / EAN / UPC — no such field exists in the affiliate feed. We
 *     leave `gtin` undefined rather than inventing one. This means
 *     cross-merchant product matching for Flipkart items must rely on
 *     title/brand/attribute matching, not barcode equality.
 *   - A dedicated "model" field — model numbers are usually embedded in
 *     `title` or buried in `specificationList`. We extract a Style Code
 *     from the spec list when present and use `styleCode` otherwise, but
 *     we do not attempt to parse a model out of the title.
 *   - Books and eBooks categories are not available via this API at all.
 */

export interface FkAmount {
  amount: number | null;
  currency: string | null;
}

export interface FkSpecificationEntry {
  key: string | null;
  values: { key: string | null; value: string[] | null }[] | null;
}

export interface FkProductBaseInfoV1 {
  productId: string;
  title: string;
  productDescription: string | null;
  /** Keyed by resolution, e.g. "400x400", plus an "unknown" original. */
  imageUrls: Record<string, string> | null;
  productFamily: string[] | null;
  maximumRetailPrice: FkAmount | null;
  flipkartSellingPrice: FkAmount | null;
  flipkartSpecialPrice: FkAmount | null;
  productUrl: string;
  productBrand: string | null;
  inStock: boolean | null;
  isAvailable?: boolean | null;
  codAvailable: boolean | null;
  discountPercentage: number | null;
  offers: string[] | null;
  /** A JSON-encoded string (not an object) containing the category node path. */
  categoryPath: string | null;
  styleCode: string | null;
  attributes: {
    size?: string | null;
    color?: string | null;
    storage?: string | null;
    sizeUnit?: string | null;
    displaySize?: string | null;
  } | null;
}

export interface FkProductShippingInfoV1 {
  shippingCharges: FkAmount | null;
  sellerName: string | null;
  sellerAverageRating: number | null;
  sellerNoOfRatings: number | null;
  sellerNoOfReviews: number | null;
}

export interface FkCategorySpecificInfoV1 {
  keySpecs: string[] | null;
  detailedSpecs: string[] | null;
  specificationList: FkSpecificationEntry[] | null;
}

export interface FkProductInfo {
  productBaseInfoV1?: FkProductBaseInfoV1;
  productShippingInfoV1?: FkProductShippingInfoV1;
  categorySpecificInfoV1?: FkCategorySpecificInfoV1;
}

export interface FkFeedResponse {
  nextUrl: string | null;
  validTill: number | null;
  productInfoList: FkProductInfo[] | null;
  /** Present on delta responses. */
  version?: number | null;
}

export interface FkApiListingVariant {
  resourceName: string | null;
  get: string | null;
  deltaGet: string | null;
  top?: string | null;
}

export interface FkApiDirectory {
  apiGroups?: {
    affiliate?: {
      apiListings?: Record<
        string,
        { apiName?: string; availableVariants?: Record<string, FkApiListingVariant> }
      >;
    };
  };
}

export interface FkDeltaVersionResponse {
  category: string | null;
  version: number | null;
  error: string | null;
}

// ---------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------

/** Picks the largest available image, falling back to the "unknown" original. */
function pickImages(imageUrls: Record<string, string> | null): string[] {
  if (!imageUrls) return [];

  const entries = Object.entries(imageUrls).filter(([, url]) => Boolean(url));
  if (entries.length === 0) return [];

  const scored = entries.map(([key, url]) => {
    if (key === "unknown") return { url, score: Number.MAX_SAFE_INTEGER };
    const match = key.match(/^(\d+)x(\d+)$/);
    const score = match ? Number(match[1]) * Number(match[2]) : 0;
    return { url, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Dedupe while preserving the largest-first order.
  const seen = new Set<string>();
  return scored.map((s) => s.url).filter((url) => (seen.has(url) ? false : (seen.add(url), true)));
}

/**
 * categoryPath is a JSON-encoded STRING of node arrays, per the docs:
 *   "[[{\"node_id\":20001,\"node_name\":\"FLIPKART_TREE\"}, ...]]"
 * We take the last node of the first path as the leaf category, skipping
 * the synthetic FLIPKART_TREE root.
 */
function parseLeafCategory(categoryPath: string | null): string | undefined {
  if (!categoryPath) return undefined;
  try {
    const parsed = JSON.parse(categoryPath) as { node_id?: number; node_name?: string }[][];
    const firstPath = parsed?.[0];
    if (!Array.isArray(firstPath) || firstPath.length === 0) return undefined;

    const named = firstPath
      .map((node) => node?.node_name)
      .filter((name): name is string => Boolean(name) && name !== "FLIPKART_TREE");

    return named[named.length - 1];
  } catch {
    return undefined;
  }
}

function flattenSpecs(info: FkCategorySpecificInfoV1 | undefined): Record<string, string> {
  const specs: Record<string, string> = {};
  for (const group of info?.specificationList ?? []) {
    for (const item of group?.values ?? []) {
      const key = item?.key?.trim();
      const value = item?.value?.filter(Boolean).join(", ");
      if (key && value) specs[key] = value;
    }
  }
  return specs;
}

function buildVariantAttributes(base: FkProductBaseInfoV1): Record<string, string> {
  const attrs: Record<string, string> = {};
  const a = base.attributes;
  if (a?.color) attrs.color = a.color;
  if (a?.storage) attrs.storage = a.storage;
  if (a?.size) attrs.size = a.sizeUnit ? `${a.size} ${a.sizeUnit}`.trim() : a.size;
  if (a?.displaySize) attrs.displaySize = a.displaySize;
  return attrs;
}

/**
 * Maps one Flipkart product to the normalized shape.
 * Returns null (rather than throwing) when the item lacks the minimum
 * required fields — the caller records it as a parse failure and continues.
 */
export function mapFlipkartProduct(item: FkProductInfo): NormalizedProduct | null {
  const base = item.productBaseInfoV1;
  if (!base?.productId || !base.title || !base.productUrl) return null;

  // Per the docs, flipkartSpecialPrice is the price after extra offers and
  // flipkartSellingPrice is the post-discount price. Prefer the special
  // price when present, since that's what the buyer actually pays.
  const price = base.flipkartSpecialPrice?.amount ?? base.flipkartSellingPrice?.amount;
  if (price == null || !Number.isFinite(price)) return null;

  const mrp = base.maximumRetailPrice?.amount ?? undefined;
  const specs = flattenSpecs(item.categorySpecificInfoV1);
  const variantAttributes = buildVariantAttributes(base);
  const variantLabel = Object.values(variantAttributes).filter(Boolean).join(" · ") || undefined;

  return {
    externalId: base.productId,
    title: base.title,
    productUrl: base.productUrl,
    price,
    currency: "INR",
    mrp: mrp != null && mrp > 0 ? mrp : undefined,
    discountPercent: base.discountPercentage ?? undefined,
    inStock: base.inStock ?? false,
    codAvailable: base.codAvailable ?? undefined,
    brand: base.productBrand ?? undefined,
    category: parseLeafCategory(base.categoryPath),
    description: base.productDescription || undefined,
    imageUrls: pickImages(base.imageUrls),
    // No GTIN available from this API — deliberately left undefined.
    gtin: undefined,
    // Flipkart has no dedicated MPN field either; some categories expose a
    // manufacturer part number in the spec list. Only used when present.
    mpn: specs["Part Number"] ?? specs["Manufacturer Part Number"] ?? undefined,
    model: specs["Model Number"] ?? specs["Model Name"] ?? base.styleCode ?? undefined,
    sku: base.styleCode ?? undefined,
    variantLabel,
    variantAttributes,
    specs,
    rating: item.productShippingInfoV1?.sellerAverageRating ?? undefined,
    reviewCount: item.productShippingInfoV1?.sellerNoOfReviews ?? undefined,
    // Delta feeds mark deletions with isAvailable=false; the full feed
    // omits the field entirely, in which case the item is present.
    isAvailable: base.isAvailable ?? true,
  };
}

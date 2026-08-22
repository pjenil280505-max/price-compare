import type { FilterOptions, SortOption } from "@/lib/types";
import type { Freshness } from "@/lib/pricing/engine";

/**
 * Search response types.
 *
 * Deliberately in their own module rather than in lib/server/search.ts:
 * that module is `server-only`, and lib/api.ts (imported by client
 * components) needs these shapes. `import type` is erased at build time,
 * but relying on that erasure to dodge a server-only guard is fragile —
 * a single accidental value import would turn into a confusing build
 * failure. A neutral module removes the coupling entirely.
 */

export interface SearchResultItem {
  productId: string;
  slug: string;
  title: string;
  brand?: string;
  category?: string;
  imageUrl: string;
  variantId: string;
  variantLabel: string;
  /** Null when no eligible (non-expired, in-stock) offer exists. */
  bestPrice: number | null;
  mrp?: number;
  discountPercent?: number;
  inStock: boolean;
  freshness: Freshness | null;
  lastCheckedAt: string | null;
  merchantName?: string;
  merchantSlug?: string;
  merchantLogoUrl?: string;
  /** Internal /go redirect. Never a raw merchant URL. */
  buyUrl: string | null;
  offerCount: number;
  rating?: number;
  reviewCount?: number;
}

export interface ParsedQuerySummary {
  text: string;
  minPrice?: number;
  maxPrice?: number;
  variantAxes: Record<string, string>;
  impliedSort?: SortOption;
  hints: string[];
}

export interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  parsed: ParsedQuerySummary;
  appliedSort: SortOption;
  filterOptions: FilterOptions;
}

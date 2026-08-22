/**
 * Shapes returned by Supabase's nested-select queries in lib/server/products.ts.
 * Intentionally distinct from lib/types.ts: those are the API's PUBLIC
 * contract (what the frontend receives), these are the DB's actual nested
 * shape (what PostgREST returns) — mapProductRow() below is the one place
 * that translates between them.
 *
 * These are written by hand rather than generated because this project
 * doesn't have a live Supabase instance to run `supabase gen types
 * typescript` against yet. Once one exists, prefer generating this file
 * instead of maintaining it manually — see docs/DATABASE.md.
 */

export interface DbBrand {
  id: string;
  name: string;
  slug: string;
}

export interface DbCategory {
  id: string;
  name: string;
  slug: string;
}

export interface DbMerchant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  trust_rating: number | null;
}

export interface DbPrice {
  price: number;
  mrp: number | null;
  currency: string;
  in_stock: boolean;
  cod_available: boolean;
  rating: number | null;
  review_count: number | null;
  last_checked_at: string;
}

export interface DbMerchantOffer {
  id: string;
  destination_url: string;
  is_active: boolean;
  merchants: DbMerchant | null;
  prices: DbPrice | null;
}

export interface DbProductVariant {
  id: string;
  label: string;
  attributes: Record<string, string>;
  is_active: boolean;
  created_at: string;
  merchant_offers: DbMerchantOffer[];
}

export interface DbProductRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  specs: Record<string, string> | null;
  primary_image_url: string;
  images: string[] | null;
  brands: DbBrand | null;
  categories: DbCategory | null;
  product_variants: DbProductVariant[];
}

/**
 * Normalizes a PostgREST embedded relation to a single row.
 *
 * A to-one embed (`merchants ( name )`) is returned by PostgREST as a
 * single object, but the Supabase client's inferred types describe it as an
 * ARRAY unless generated database types are present. Casting straight to an
 * object therefore fails type-checking with:
 *
 *   Conversion of type '{ name: any; }[]' to type '{ name: string; }'
 *   may be a mistake...
 *
 * Handling both shapes is correct at runtime as well as at compile time —
 * the same query can return either form depending on how the relation is
 * declared in the schema cache.
 *
 * Replace with `supabase gen types typescript` output once the database is
 * live; this helper then becomes a no-op safety net rather than a
 * necessity.
 */
export function embeddedOne<T>(value: unknown): T | null {
  if (value == null) return null;
  return (Array.isArray(value) ? (value[0] ?? null) : value) as T | null;
}

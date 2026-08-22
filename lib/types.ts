/**
 * Domain types shared across the component library.
 *
 * These mirror the backend API response shapes (see /docs architecture).
 * Components in this library must only ever receive product/price/merchant
 * data through props typed with these interfaces — never hard-code sample
 * data inside a component file. Real data comes from lib/api.ts, called by
 * the page/server component that composes these pieces together.
 */

export type Currency = "INR";

export interface Merchant {
  id: string;
  name: string;
  slug: string;
  logoUrl: string;
  trustRating?: number; // 0-5
  productCount?: number;
}

export interface PriceHistoryPoint {
  date: string; // ISO 8601
  price: number;
  mrp?: number;
  inStock: boolean;
}

export interface MerchantOffer {
  id: string;
  merchant: Merchant;
  price: number;
  mrp?: number;
  currency: Currency;
  discountPercent?: number;
  inStock: boolean;
  codAvailable?: boolean;
  rating?: number;
  reviewCount?: number;
  /** Always the internal /go/{listingId} redirect URL — never a raw merchant link. */
  buyUrl: string;
  lastCheckedAt: string;
}

export interface ProductVariant {
  id: string;
  label: string; // e.g. "128GB · Midnight Black"
  attributes: Record<string, string>;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  brand?: string;
  category: string;
  imageUrl: string;
  images?: string[];
  description?: string;
  specs?: Record<string, string>;
  rating?: number;
  reviewCount?: number;
  variants?: ProductVariant[];
  selectedVariantId?: string;
  /** One entry per merchant currently listing this product/variant. */
  offers: MerchantOffer[];
  isWishlisted?: boolean;
}

export interface Deal {
  id: string;
  product: Product;
  offer: MerchantOffer;
  label?: string; // "Flash deal", "Price drop", "Coupon inside"
  endsAt?: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  imageUrl: string;
  productCount?: number;
}

export type SearchSuggestionType = "product" | "category" | "brand" | "query";

export interface SearchSuggestion {
  id: string;
  type: SearchSuggestionType;
  label: string;
  imageUrl?: string;
  subtitle?: string;
}

export interface FilterState {
  priceMin?: number;
  priceMax?: number;
  merchantIds: string[];
  brands: string[];
  minRating?: number;
  minDiscount?: number;
  inStockOnly: boolean;
}

export interface FilterOptions {
  priceBounds: { min: number; max: number };
  merchants: Merchant[];
  brands: string[];
}

export type SortOption =
  | "relevance"
  | "price_low_high"
  | "price_high_low"
  | "discount"
  | "rating"
  | "newest";

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "relevance", label: "Most relevant" },
  { value: "price_low_high", label: "Price: Low to High" },
  { value: "price_high_low", label: "Price: High to Low" },
  { value: "discount", label: "Biggest discount" },
  { value: "rating", label: "Highest rated" },
  { value: "newest", label: "Newest" },
];

export interface WishlistItem {
  id: string;
  product: Product;
  addedAt: string;
}

export interface PriceAlertConfig {
  id?: string;
  productId: string;
  variantId?: string;
  targetPrice: number;
  active: boolean;
}

/** What the alerts LIST endpoint returns — enough to render a row without an extra product fetch per alert. */
export interface PriceAlertRecord {
  id: string;
  product: Product;
  targetPrice: number;
  currentPrice: number;
  active: boolean;
  createdAt: string;
}

export type NotificationType = "price_drop" | "back_in_stock" | "alert_triggered" | "system";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  relatedProductSlug?: string;
  isRead: boolean;
  createdAt: string;
}

export interface ChatMessage {  id: string;
  role: "user" | "assistant";
  content: string;
  /** Products the assistant grounded its answer in — rendered as cards, never invented. */
  products?: Product[];
  createdAt: string;
}

/** Generic async-state shape used by container components/pages. */
export interface AsyncState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}

// --- Admin ---

export type ConnectorStatus = "healthy" | "degraded" | "down";

export interface ConnectorHealth {
  id: string;
  merchantName: string;
  status: ConnectorStatus;
  lastSyncAt: string;
  itemsSynced: number;
}

export type IngestionRunStatus = "success" | "error" | "running";

export interface IngestionRun {
  id: string;
  connectorName: string;
  status: IngestionRunStatus;
  startedAt: string;
  finishedAt?: string;
  itemsProcessed: number;
  itemsFlagged: number;
}

export interface AdminOverview {
  connectors: ConnectorHealth[];
  pendingMatchReviews: number;
  recentRuns: IngestionRun[];
}

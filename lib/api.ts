/**
 * Typed client for the platform's backend API.
 *
 * This is the ONLY place that talks to the network for product/price/merchant
 * data. Presentational components never fetch — a page or server component
 * calls these functions and passes the typed result down as props. That
 * separation is what keeps every component in this library reusable and
 * testable, and is what satisfies "no hard-coded product data": there is
 * simply nowhere else data could come from.
 *
 * Endpoints match the API architecture in the platform's architecture doc
 * (search, products, compare, wishlist, alerts, assistant, redirect).
 */

import type {
  AdminOverview,
  ChatMessage,
  Deal,
  Category,
  FilterOptions,
  FilterState,
  Merchant,
  Notification,
  PriceAlertConfig,
  PriceAlertRecord,
  PriceHistoryPoint,
  Product,
  SearchSuggestion,
  SortOption,
  WishlistItem,
} from "./types";
import type { ProductPricing } from "./pricing/engine";
import type { SearchResponse } from "./search/types";

/**
 * Resolves the API base.
 *
 * In the browser a relative "/api" is correct and preferable. On the
 * server it is NOT: Node's fetch requires an absolute URL, so a relative
 * one throws "Failed to parse URL" — which is exactly what happens when a
 * Server Component calls this. Every page that renders server-side needs
 * the absolute form.
 */
function resolveBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  // Browser: relative is fine and avoids a needless absolute origin.
  if (typeof window !== "undefined") return "/api";

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    "http://localhost:3000";

  return `${origin.replace(/\/$/, "")}/api`;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${resolveBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.message ?? `Request to ${path} failed`, res.status);
  }

  return res.json() as Promise<T>;
}

export interface SearchParams {
  query: string;
  categorySlug?: string;
  filters?: Partial<FilterState>;
  sort?: SortOption;
  page?: number;
  signal?: AbortSignal;
}

export const api = {
  search(params: SearchParams): Promise<SearchResponse> {
    const { signal, ...body } = params;
    return request<SearchResponse>("/search", { method: "POST", body: JSON.stringify(body), signal });
  },

  suggestions(query: string, signal?: AbortSignal): Promise<SearchSuggestion[]> {
    return request<SearchSuggestion[]>(`/search/suggestions?q=${encodeURIComponent(query)}`, { signal });
  },

  getProduct(slug: string): Promise<Product> {
    return request<Product>(`/products/${slug}`);
  },

  getPriceHistory(slug: string, rangeDays = 90): Promise<PriceHistoryPoint[]> {
    return request<PriceHistoryPoint[]>(`/products/${slug}/history?range=${rangeDays}`);
  },

  /** Full pricing picture: all merchant prices, freshness, statistics. */
  getProductPricing(slug: string): Promise<ProductPricing> {
    return request<ProductPricing>(`/products/${slug}/pricing`);
  },

  getAlternatives(slug: string): Promise<Product[]> {
    return request<Product[]>(`/products/${slug}/alternatives`);
  },

  compare(productIds: string[]): Promise<Product[]> {
    return request<Product[]>("/compare", { method: "POST", body: JSON.stringify({ productIds }) });
  },

  getDeals(categorySlug?: string): Promise<Deal[]> {
    const query = categorySlug ? `?category=${encodeURIComponent(categorySlug)}` : "";
    return request<Deal[]>(`/deals${query}`);
  },

  getCategories(): Promise<Category[]> {
    return request<Category[]>("/categories");
  },

  getMerchants(): Promise<Merchant[]> {
    return request<Merchant[]>("/merchants");
  },

  getTrending(): Promise<Product[]> {
    return request<Product[]>("/trending");
  },

  getWishlist(): Promise<WishlistItem[]> {
    return request<WishlistItem[]>("/wishlist");
  },

  addToWishlist(productId: string): Promise<WishlistItem> {
    return request<WishlistItem>("/wishlist", { method: "POST", body: JSON.stringify({ productId }) });
  },

  removeFromWishlist(productId: string): Promise<void> {
    return request<void>(`/wishlist/${productId}`, { method: "DELETE" });
  },

  createPriceAlert(config: PriceAlertConfig): Promise<PriceAlertConfig> {
    return request<PriceAlertConfig>("/alerts", { method: "POST", body: JSON.stringify(config) });
  },

  getPriceAlerts(): Promise<PriceAlertRecord[]> {
    return request<PriceAlertRecord[]>("/alerts");
  },

  setPriceAlertActive(alertId: string, active: boolean): Promise<PriceAlertRecord> {
    return request<PriceAlertRecord>(`/alerts/${alertId}`, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    });
  },

  deletePriceAlert(alertId: string): Promise<void> {
    return request<void>(`/alerts/${alertId}`, { method: "DELETE" });
  },

  sendAssistantMessage(
    message: string,
    history: ChatMessage[],
    signal?: AbortSignal,
  ): Promise<ChatMessage> {
    return request<ChatMessage>("/assistant", {
      method: "POST",
      body: JSON.stringify({ message, history }),
      signal,
    });
  },

  getNotifications(unreadOnly = false): Promise<Notification[]> {
    return request<Notification[]>(`/notifications${unreadOnly ? "?unread=1" : ""}`);
  },

  markNotificationRead(notificationId: string, isRead: boolean): Promise<{ id: string; isRead: boolean }> {
    return request<{ id: string; isRead: boolean }>(`/notifications/${notificationId}`, {
      method: "PATCH",
      body: JSON.stringify({ isRead }),
    });
  },

  getAdminOverview(): Promise<AdminOverview> {
    return request<AdminOverview>("/admin/overview");
  },

  decideProductMatch(reviewId: string, decision: "approved" | "rejected"): Promise<{ id: string; status: string }> {
    return request<{ id: string; status: string }>(`/admin/matches/${reviewId}`, {
      method: "PATCH",
      body: JSON.stringify({ decision }),
    });
  },
};

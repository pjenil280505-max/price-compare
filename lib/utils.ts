import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { MerchantOffer, Product } from "./types";

/** Merge conditional class names, letting later Tailwind classes win conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrCompactFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatPrice(value: number, compact = false): string {
  return compact ? inrCompactFormatter.format(value) : inrFormatter.format(value);
}

export function formatDiscount(percent: number): string {
  return `${Math.round(percent)}% off`;
}

/** The cheapest in-stock offer, falling back to the cheapest offer overall if nothing is in stock. */
export function getCheapestOffer(product: Product): MerchantOffer | undefined {
  const inStock = product.offers.filter((o) => o.inStock).sort((a, b) => a.price - b.price);
  if (inStock.length > 0) return inStock[0];
  return [...product.offers].sort((a, b) => a.price - b.price)[0];
}

export function getDiscountPercent(offer: MerchantOffer): number | undefined {
  if (offer.discountPercent != null) return offer.discountPercent;
  if (offer.mrp && offer.mrp > offer.price) {
    return Math.round(((offer.mrp - offer.price) / offer.mrp) * 100);
  }
  return undefined;
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Stable id helper for list keys / aria-controls wiring when an item lacks one. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

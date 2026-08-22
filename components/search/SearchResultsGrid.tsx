"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { SearchResultItem } from "@/lib/search/types";
import { api } from "@/lib/api";
import { fadeUp, staggerContainer, useReducedMotionSafe, withMotionPreference } from "@/lib/motion";
import { useToast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchResultCard } from "./SearchResultCard";

export interface SearchResultsGridProps {
  items: SearchResultItem[];
  emptyTitle?: string;
  emptyDescription?: string;
}

/**
 * The one client island on the results page. Owns only wishlist state and
 * the alert dialog; everything else is server-rendered for SEO and first
 * paint.
 */
export function SearchResultsGrid({ items, emptyTitle, emptyDescription }: SearchResultsGridProps) {
  const reduced = useReducedMotionSafe();
  const { toast } = useToast();
  const [wishlisted, setWishlisted] = useState<Set<string>>(new Set());

  async function toggleWishlist(item: SearchResultItem) {
    const wasWishlisted = wishlisted.has(item.productId);

    setWishlisted((prev) => {
      const next = new Set(prev);
      if (wasWishlisted) next.delete(item.productId);
      else next.add(item.productId);
      return next;
    });

    try {
      if (wasWishlisted) {
        await api.removeFromWishlist(item.productId);
        toast({ title: "Removed from wishlist" });
      } else {
        await api.addToWishlist(item.productId);
        toast({ title: "Saved to wishlist", variant: "success" });
      }
    } catch {
      // Roll back the optimistic update.
      setWishlisted((prev) => {
        const next = new Set(prev);
        if (wasWishlisted) next.add(item.productId);
        else next.delete(item.productId);
        return next;
      });
      toast({ title: "Couldn't update wishlist", description: "Please sign in and try again.", variant: "error" });
    }
  }

  async function saveAlert(item: SearchResultItem, targetPrice: number) {
    try {
      await api.createPriceAlert({ productId: item.productId, targetPrice, active: true });
      toast({ title: "Price alert set", variant: "success" });
    } catch {
      toast({ title: "Couldn't set that alert", description: "Please sign in and try again.", variant: "error" });
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title={emptyTitle ?? "No matching products"}
        description={emptyDescription ?? "Try different words, or widen your filters."}
      />
    );
  }

  return (
    <>
      <motion.div
        variants={withMotionPreference(staggerContainer, reduced)}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {items.map((item, index) => (
          <motion.div key={`${item.productId}-${item.variantId}`} variants={withMotionPreference(fadeUp, reduced)}>
            <SearchResultCard
              item={item}
              isWishlisted={wishlisted.has(item.productId)}
              onToggleWishlist={toggleWishlist}
              onSaveAlert={saveAlert}
              priority={index < 4}
              className="h-full"
            />
          </motion.div>
        ))}
      </motion.div>
    </>
  );
}

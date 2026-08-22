"use client";

import { motion } from "framer-motion";
import type { MerchantOffer, Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { fadeUp, staggerContainer, useReducedMotionSafe, withMotionPreference } from "@/lib/motion";
import { SkeletonProductGrid } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ProductCard } from "./ProductCard";

export interface ProductGridProps {
  products: Product[];
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onToggleWishlist?: (product: Product) => void | Promise<void>;
  onBuyClick?: (offer: MerchantOffer) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

export function ProductGrid({
  products,
  isLoading,
  error,
  onRetry,
  onToggleWishlist,
  onBuyClick,
  emptyTitle = "No products found",
  emptyDescription = "Try a different search term or clear a few filters.",
  className,
}: ProductGridProps) {
  const reduced = useReducedMotionSafe();

  if (error) {
    return <ErrorState description={error} onRetry={onRetry} className={className} />;
  }

  if (isLoading) {
    return <SkeletonProductGrid />;
  }

  if (products.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} className={className} />;
  }

  return (
    <motion.div
      variants={withMotionPreference(staggerContainer, reduced)}
      initial="hidden"
      animate="visible"
      className={cn("grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4", className)}
    >
      {products.map((product, index) => (
        <motion.div key={product.id} variants={withMotionPreference(fadeUp, reduced)}>
          <ProductCard
            product={product}
            onToggleWishlist={onToggleWishlist}
            onBuyClick={onBuyClick}
            priority={index < 4}
          />
        </motion.div>
      ))}
    </motion.div>
  );
}

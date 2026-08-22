"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Search, TrendingUp, Tag, Layers } from "lucide-react";
import type { SearchSuggestion, SearchSuggestionType } from "@/lib/types";
import { cn, slugify } from "@/lib/utils";
import { fadeIn, useReducedMotionSafe, withMotionPreference } from "@/lib/motion";

export interface SearchSuggestionsProps {
  id: string;
  suggestions: SearchSuggestion[];
  isLoading?: boolean;
  activeIndex: number;
  onSelect: (suggestion: SearchSuggestion) => void;
  onHoverIndex: (index: number) => void;
}

const typeIcon: Record<SearchSuggestionType, typeof Search> = {
  product: Tag,
  category: Layers,
  brand: TrendingUp,
  query: Search,
};

export function SearchSuggestions({
  id,
  suggestions,
  isLoading,
  activeIndex,
  onSelect,
  onHoverIndex,
}: SearchSuggestionsProps) {
  const reduced = useReducedMotionSafe();

  return (
    <motion.div
      id={id}
      role="listbox"
      variants={withMotionPreference(fadeIn, reduced)}
      initial="hidden"
      animate="visible"
      exit="hidden"
      className="absolute inset-x-0 top-full z-40 mt-2 max-h-96 overflow-y-auto rounded-lg border border-ink-100 bg-paper py-2 shadow-card-hover dark:border-ink-800 dark:bg-ink-900"
    >
      {isLoading && (
        <div className="px-4 py-6 text-center text-sm text-ink-400">Searching…</div>
      )}

      {!isLoading && suggestions.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-ink-400">
          No matches yet — try a different term.
        </div>
      )}

      {!isLoading &&
        suggestions.map((suggestion, index) => {
          const Icon = typeIcon[suggestion.type];
          const optionId = `${id}-option-${slugify(suggestion.id)}`;
          const isActive = index === activeIndex;

          return (
            <button
              key={suggestion.id}
              id={optionId}
              type="button"
              role="option"
              aria-selected={isActive}
              onMouseEnter={() => onHoverIndex(index)}
              onClick={() => onSelect(suggestion)}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors",
                isActive ? "bg-saffron-50 dark:bg-ink-800" : "hover:bg-ink-50 dark:hover:bg-ink-800",
              )}
            >
              {suggestion.imageUrl ? (
                <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-ink-50 dark:bg-ink-800">
                  <Image src={suggestion.imageUrl} alt="" fill sizes="36px" className="object-contain" />
                </span>
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink-50 text-ink-400 dark:bg-ink-800">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
              <span className="flex flex-col">
                <span className="font-medium text-ink dark:text-paper">{suggestion.label}</span>
                {suggestion.subtitle && (
                  <span className="text-xs text-ink-400">{suggestion.subtitle}</span>
                )}
              </span>
            </button>
          );
        })}
    </motion.div>
  );
}

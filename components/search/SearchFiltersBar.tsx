"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import type { FilterOptions, FilterState, SortOption } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Filters } from "@/components/filters/Filters";
import { SortMenu } from "@/components/filters/SortMenu";

function readFilterState(params: URLSearchParams): FilterState {
  return {
    priceMin: params.get("minPrice") ? Number(params.get("minPrice")) : undefined,
    priceMax: params.get("maxPrice") ? Number(params.get("maxPrice")) : undefined,
    merchantIds: params.get("merchant")?.split(",").filter(Boolean) ?? [],
    brands: params.get("brand")?.split(",").filter(Boolean) ?? [],
    minRating: params.get("minRating") ? Number(params.get("minRating")) : undefined,
    minDiscount: params.get("minDiscount") ? Number(params.get("minDiscount")) : undefined,
    inStockOnly: params.get("inStock") === "1",
  };
}

function readSort(params: URLSearchParams): SortOption {
  return (params.get("sort") as SortOption) || "relevance";
}

/**
 * Shared read/write logic for URL-encoded filter+sort state. Both the mobile
 * bar and the desktop sidebar below call this instead of duplicating the
 * param-serialization logic.
 */
function useSearchFilterParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filterState = readFilterState(searchParams);
  const sort = readSort(searchParams);

  function push(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value == null || value === "") params.delete(key);
      else params.set(key, value);
    }
    // Any filter/sort change invalidates the current page number: page 5 of
    // the previous result set is very likely past the end of the new one,
    // which would render an empty page and look broken.
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function setFilters(next: FilterState) {
    push({
      minPrice: next.priceMin != null ? String(next.priceMin) : null,
      maxPrice: next.priceMax != null ? String(next.priceMax) : null,
      merchant: next.merchantIds.length ? next.merchantIds.join(",") : null,
      brand: next.brands.length ? next.brands.join(",") : null,
      minRating: next.minRating != null ? String(next.minRating) : null,
      minDiscount: next.minDiscount != null ? String(next.minDiscount) : null,
      inStock: next.inStockOnly ? "1" : null,
    });
  }

  function clearFilters() {
    push({
      minPrice: null,
      maxPrice: null,
      merchant: null,
      brand: null,
      minRating: null,
      minDiscount: null,
      inStock: null,
    });
  }

  function setSort(next: SortOption) {
    push({ sort: next === "relevance" ? null : next });
  }

  return { filterState, sort, setFilters, clearFilters, setSort };
}

export interface SearchFiltersBarProps {
  options: FilterOptions;
  resultCount?: number;
  className?: string;
}

/** Top strip: result count, sort menu, and — on mobile only — a button that opens Filters in a sheet. */
export function SearchFiltersBar({ options, resultCount, className }: SearchFiltersBarProps) {
  const { filterState, sort, setFilters, clearFilters, setSort } = useSearchFilterParams();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const activeFilterCount =
    filterState.merchantIds.length +
    filterState.brands.length +
    (filterState.priceMin != null ? 1 : 0) +
    (filterState.priceMax != null ? 1 : 0) +
    (filterState.minRating != null ? 1 : 0) +
    (filterState.minDiscount != null ? 1 : 0) +
    (filterState.inStockOnly ? 1 : 0);

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="md"
            leftIcon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setMobileFiltersOpen(true)}
            className="lg:hidden"
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </Button>
          {resultCount != null && (
            <span className="text-sm text-ink-500 dark:text-ink-400">
              {resultCount.toLocaleString("en-IN")} results
            </span>
          )}
        </div>
        <SortMenu value={sort} onChange={setSort} />
      </div>

      <Modal
        open={mobileFiltersOpen}
        onOpenChange={setMobileFiltersOpen}
        title="Filters"
        variant="sheet"
        className="max-h-[85vh]"
      >
        <Filters options={options} value={filterState} onChange={setFilters} onClear={clearFilters} />
      </Modal>
    </div>
  );
}

/** Persistent left-column filters panel, shown on desktop only (mobile uses the sheet above instead). */
export function SearchFiltersSidebar({ options, className }: { options: FilterOptions; className?: string }) {
  const { filterState, setFilters, clearFilters } = useSearchFilterParams();

  return (
    <div className={className}>
      <Filters options={options} value={filterState} onChange={setFilters} onClear={clearFilters} />
    </div>
  );
}

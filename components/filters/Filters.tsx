"use client";

import { Star } from "lucide-react";
import type { FilterOptions, FilterState } from "@/lib/types";
import { cn, formatPrice } from "@/lib/utils";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { MerchantCard } from "@/components/merchant/Merchant";

export interface FiltersProps {
  options: FilterOptions;
  value: FilterState;
  onChange: (next: FilterState) => void;
  onClear: () => void;
  className?: string;
}

const ratingChoices = [4, 3, 2];

export function Filters({ options, value, onChange, onClear, className }: FiltersProps) {
  function toggleMerchant(merchantId: string) {
    const isSelected = value.merchantIds.includes(merchantId);
    onChange({
      ...value,
      merchantIds: isSelected
        ? value.merchantIds.filter((id) => id !== merchantId)
        : [...value.merchantIds, merchantId],
    });
  }

  function toggleBrand(brand: string) {
    const isSelected = value.brands.includes(brand);
    onChange({
      ...value,
      brands: isSelected ? value.brands.filter((b) => b !== brand) : [...value.brands, brand],
    });
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <section>
        <h3 className="mb-3 text-sm font-semibold text-ink dark:text-paper">Price range</h3>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            aria-label="Minimum price"
            placeholder={formatPrice(options.priceBounds.min)}
            value={value.priceMin ?? ""}
            min={options.priceBounds.min}
            max={options.priceBounds.max}
            onChange={(e) =>
              onChange({ ...value, priceMin: e.target.value ? Number(e.target.value) : undefined })
            }
          />
          <span className="text-ink-300">–</span>
          <Input
            type="number"
            aria-label="Maximum price"
            placeholder={formatPrice(options.priceBounds.max)}
            value={value.priceMax ?? ""}
            min={options.priceBounds.min}
            max={options.priceBounds.max}
            onChange={(e) =>
              onChange({ ...value, priceMax: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </div>
      </section>

      {options.merchants.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-ink dark:text-paper">Merchants</h3>
          <div className="flex flex-col gap-2">
            {options.merchants.map((merchant) => (
              <MerchantCard
                key={merchant.id}
                merchant={merchant}
                isSelected={value.merchantIds.includes(merchant.id)}
                onSelect={() => toggleMerchant(merchant.id)}
              />
            ))}
          </div>
        </section>
      )}

      {options.brands.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-ink dark:text-paper">Brand</h3>
          <div className="flex flex-col gap-2">
            {options.brands.map((brand) => (
              <label key={brand} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-600 dark:text-ink-300">
                <input
                  type="checkbox"
                  checked={value.brands.includes(brand)}
                  onChange={() => toggleBrand(brand)}
                  className="h-4 w-4 rounded border-ink-300 text-saffron focus-visible:ring-2 focus-visible:ring-saffron"
                />
                {brand}
              </label>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3 text-sm font-semibold text-ink dark:text-paper">Minimum rating</h3>
        <div className="flex gap-2">
          {ratingChoices.map((rating) => (
            <button
              key={rating}
              type="button"
              aria-pressed={value.minRating === rating}
              onClick={() => onChange({ ...value, minRating: value.minRating === rating ? undefined : rating })}
              className={cn(
                "flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                value.minRating === rating
                  ? "border-saffron bg-saffron-50 text-ink dark:bg-saffron-700/10"
                  : "border-ink-200 text-ink-500 hover:border-saffron-300 dark:border-ink-700 dark:text-ink-300",
              )}
            >
              <Star className="h-3.5 w-3.5 fill-saffron text-saffron" aria-hidden="true" />
              {rating}+
            </button>
          ))}
        </div>
      </section>

      <section>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink dark:text-paper">
          <input
            type="checkbox"
            checked={value.inStockOnly}
            onChange={(e) => onChange({ ...value, inStockOnly: e.target.checked })}
            className="h-4 w-4 rounded border-ink-300 text-saffron focus-visible:ring-2 focus-visible:ring-saffron"
          />
          In stock only
        </label>
      </section>

      <Button variant="outline" size="sm" onClick={onClear} className="w-full">
        Clear all filters
      </Button>
    </div>
  );
}

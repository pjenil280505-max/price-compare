"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import type { SearchSuggestion } from "@/lib/types";
import { cn, slugify } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { useClickOutside } from "@/hooks/useClickOutside";
import { Input } from "@/components/ui/Input";
import { SearchSuggestions } from "./SearchSuggestions";

export interface SearchBarProps {
  suggestions: SearchSuggestion[];
  isSuggestionsLoading?: boolean;
  /** Fired (debounced) as the user types, so the parent can fetch fresh suggestions. */
  onQueryChange: (query: string) => void;
  /** Fired on submit or suggestion selection — the parent navigates to results. */
  onSearch: (query: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function SearchBar({
  suggestions,
  isSuggestionsLoading,
  onQueryChange,
  onSearch,
  placeholder = "Search for products, brands, or categories",
  autoFocus,
  className,
}: SearchBarProps) {
  const [value, setValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debouncedValue = useDebounce(value, 250);

  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (debouncedValue.trim().length > 0) {
      onQueryChange(debouncedValue.trim());
    }
    // Intentionally omit onQueryChange from deps — parent typically inlines it,
    // and re-running on identity changes would break the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedValue]);

  useClickOutside([containerRef], () => setIsOpen(false), isOpen);

  const showSuggestions = isOpen && value.trim().length > 0;

  function commitSearch(query: string) {
    setIsOpen(false);
    setActiveIndex(-1);
    onSearch(query);
  }

  function handleSelect(suggestion: SearchSuggestion) {
    setValue(suggestion.label);
    commitSearch(suggestion.label);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) {
      if (event.key === "Enter" && value.trim()) commitSearch(value.trim());
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % suggestions.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        break;
      case "Enter":
        event.preventDefault();
        if (activeIndex >= 0 && activeIndex < suggestions.length) {
          const chosen = suggestions[activeIndex];
          if (chosen) handleSelect(chosen);
        } else if (value.trim()) {
          commitSearch(value.trim());
        }
        break;
      case "Escape":
        setIsOpen(false);
        setActiveIndex(-1);
        break;
      default:
        break;
    }
  }

  const activeSuggestion = activeIndex >= 0 ? suggestions[activeIndex] : undefined;
  const activeOptionId = activeSuggestion
    ? `${listboxId}-option-${slugify(activeSuggestion.id)}`
    : undefined;

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <Input
        ref={inputRef}
        role="combobox"
        aria-expanded={showSuggestions}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        leftIcon={<Search className="h-4 w-4" aria-hidden="true" />}
        rightIcon={
          value ? (
            <button
              type="button"
              aria-label="Clear search"
              className="pointer-events-auto rounded-full p-1 text-ink-400 hover:bg-ink-100 hover:text-ink dark:hover:bg-ink-800"
              onClick={() => {
                setValue("");
                inputRef.current?.focus();
              }}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : undefined
        }
        onChange={(e) => {
          setValue(e.target.value);
          setIsOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => value.trim().length > 0 && setIsOpen(true)}
        onKeyDown={handleKeyDown}
      />

      <AnimatePresence>
        {showSuggestions && (
          <SearchSuggestions
            id={listboxId}
            suggestions={suggestions}
            isLoading={isSuggestionsLoading}
            activeIndex={activeIndex}
            onSelect={handleSelect}
            onHoverIndex={setActiveIndex}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

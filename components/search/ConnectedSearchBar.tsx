"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchSuggestion } from "@/lib/types";
import { api } from "@/lib/api";
import { SearchBar } from "./SearchBar";

export interface ConnectedSearchBarProps {
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function ConnectedSearchBar({ placeholder, autoFocus, className }: ConnectedSearchBarProps) {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  async function handleQueryChange(query: string) {
    setIsLoading(true);
    try {
      setSuggestions(await api.suggestions(query));
    } catch {
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleSearch(query: string) {
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <SearchBar
      suggestions={suggestions}
      isSuggestionsLoading={isLoading}
      onQueryChange={handleQueryChange}
      onSearch={handleSearch}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={className}
    />
  );
}

"use client";

import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpDown, Check, ChevronDown } from "lucide-react";
import { SORT_OPTIONS, type SortOption } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useReducedMotionSafe } from "@/lib/motion";

export interface SortMenuProps {
  value: SortOption;
  onChange: (option: SortOption) => void;
  className?: string;
}

export function SortMenu({ value, onChange, className }: SortMenuProps) {
  const reduced = useReducedMotionSafe();
  const [open, setOpen] = useState(false);
  const activeLabel = SORT_OPTIONS.find((option) => option.value === value)?.label ?? "Sort";

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Sort results. Currently: ${activeLabel}`}
          className={cn(
            "flex h-10 items-center gap-2 rounded-md border border-ink-200 px-3.5 text-sm font-medium text-ink transition-colors hover:border-saffron-300 dark:border-ink-700 dark:text-paper",
            className,
          )}
        >
          <ArrowUpDown className="h-4 w-4 text-ink-400" aria-hidden="true" />
          {activeLabel}
          <ChevronDown className="h-4 w-4 text-ink-400" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>

      <AnimatePresence>
        {open && (
          <DropdownMenu.Portal forceMount>
            <DropdownMenu.Content asChild align="end" sideOffset={8} forceMount>
              <motion.div
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: reduced ? 0.01 : 0.15, ease: "easeOut" }}
                className="z-40 min-w-[200px] rounded-md border border-ink-100 bg-paper p-1.5 shadow-card-hover dark:border-ink-800 dark:bg-ink-900"
              >
                <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as SortOption)}>
                  {SORT_OPTIONS.map((option) => (
                    <DropdownMenu.RadioItem
                      key={option.value}
                      value={option.value}
                      className="flex cursor-pointer items-center justify-between rounded-sm px-3 py-2 text-sm text-ink-600 outline-none data-[highlighted]:bg-ink-50 dark:text-ink-300 dark:data-[highlighted]:bg-ink-800"
                    >
                      {option.label}
                      <DropdownMenu.ItemIndicator>
                        <Check className="h-4 w-4 text-saffron" aria-hidden="true" />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </motion.div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        )}
      </AnimatePresence>
    </DropdownMenu.Root>
  );
}

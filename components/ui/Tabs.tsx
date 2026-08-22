"use client";

import { useId, useState } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useReducedMotionSafe } from "@/lib/motion";

export interface TabItem {
  value: string;
  label: string;
  content: React.ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  defaultValue?: string;
  className?: string;
}

export function Tabs({ items, defaultValue, className }: TabsProps) {
  const reduced = useReducedMotionSafe();
  const [value, setValue] = useState(defaultValue ?? items[0]?.value);
  // Scopes the shared-element indicator to this instance — layoutId is
  // matched globally by framer-motion, so two Tabs on one page would
  // otherwise animate as if they were the same element.
  const instanceId = useId();

  return (
    <TabsPrimitive.Root value={value} onValueChange={setValue} className={cn("w-full", className)}>
      <TabsPrimitive.List className="relative flex gap-1 overflow-x-auto border-b border-ink-100 scrollbar-thin dark:border-ink-800">
        {items.map((item) => {
          const isActive = item.value === value;
          return (
            <TabsPrimitive.Trigger
              key={item.value}
              value={item.value}
              className={cn(
                "relative shrink-0 whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none",
                isActive ? "text-ink dark:text-paper" : "text-ink-400 hover:text-ink-600 dark:hover:text-ink-200",
              )}
            >
              {item.label}
              {isActive && (
                <motion.span
                  layoutId={`tabs-indicator-${instanceId}`}
                  transition={{ duration: reduced ? 0.01 : 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-saffron"
                />
              )}
            </TabsPrimitive.Trigger>
          );
        })}
      </TabsPrimitive.List>

      {items.map((item) => (
        <TabsPrimitive.Content key={item.value} value={item.value} className="pt-6 focus-visible:outline-none">
          {item.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

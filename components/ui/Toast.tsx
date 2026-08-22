"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotionSafe } from "@/lib/motion";

export type ToastVariant = "default" | "success" | "error";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: string;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const variantIcon: Record<ToastVariant, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  error: AlertCircle,
};

const variantClasses: Record<ToastVariant, string> = {
  default: "border-ink-200 dark:border-ink-700 text-ink dark:text-paper",
  success: "border-jade-400 text-jade-700 dark:text-jade-100",
  error: "border-vermilion-400 text-vermilion-700 dark:text-vermilion-100",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const reduced = useReducedMotionSafe();

  const toast = useCallback((options: ToastOptions) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setItems((prev) => [...prev, { id, variant: "default", duration: 4000, ...options }]);
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        <AnimatePresence>
          {items.map((item) => {
            const Icon = variantIcon[item.variant ?? "default"];
            return (
              <ToastPrimitive.Root
                key={item.id}
                asChild
                duration={item.duration}
                onOpenChange={(open) => !open && remove(item.id)}
              >
                <motion.li
                  layout
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, x: 40 }}
                  transition={{ duration: reduced ? 0.01 : 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "pointer-events-auto flex w-full items-start gap-3 rounded-lg border bg-paper p-4 shadow-card-hover dark:bg-ink-900",
                    variantClasses[item.variant ?? "default"],
                  )}
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  <div className="flex-1">
                    <ToastPrimitive.Title className="text-sm font-semibold">
                      {item.title}
                    </ToastPrimitive.Title>
                    {item.description && (
                      <ToastPrimitive.Description className="mt-0.5 text-sm text-ink-500 dark:text-ink-300">
                        {item.description}
                      </ToastPrimitive.Description>
                    )}
                  </div>
                  <ToastPrimitive.Close aria-label="Dismiss" className="shrink-0 text-ink-400 hover:text-ink dark:hover:text-paper">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </ToastPrimitive.Close>
                </motion.li>
              </ToastPrimitive.Root>
            );
          })}
        </AnimatePresence>
        <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[100] m-0 flex w-full max-w-sm list-none flex-col gap-2 p-4 outline-none sm:bottom-4 sm:right-4" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return ctx;
}

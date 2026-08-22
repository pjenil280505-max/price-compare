"use client";

import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EASE_OUT, useReducedMotionSafe } from "@/lib/motion";

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** "sheet" slides up from the bottom — the natural pattern for mobile filters/actions. */
  variant?: "dialog" | "sheet";
  className?: string;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  variant = "dialog",
  className,
}: ModalProps) {
  const reduced = useReducedMotionSafe();
  const isSheet = variant === "sheet";
  const transition = { duration: reduced ? 0.01 : 0.28, ease: EASE_OUT };

  // x/y stay fixed at their centered values across initial/animate/exit for the
  // dialog variant, so centering never depends on the (possibly-skipped) scale
  // animation — only opacity/scale change when reduced motion is on.
  const contentMotionProps = isSheet
    ? {
        initial: { y: "100%" },
        animate: { y: 0 },
        exit: { y: "100%" },
      }
    : {
        initial: { opacity: 0, scale: reduced ? 1 : 0.96, x: "-50%", y: "-50%" },
        animate: { opacity: 1, scale: 1, x: "-50%", y: "-50%" },
        exit: { opacity: 0, scale: reduced ? 1 : 0.96, x: "-50%", y: "-50%" },
      };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-ink-950/50 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduced ? 0.01 : 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                role="dialog"
                className={cn(
                  "fixed z-50 flex flex-col bg-paper shadow-card-hover dark:bg-ink-900",
                  // Radix moves focus into the dialog on open. The
                  // outline is replaced rather than simply removed, so
                  // keyboard users still see where focus landed.
                  "focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron",
                  isSheet
                    ? "inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl"
                    : "left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-md rounded-xl",
                  className,
                )}
                {...contentMotionProps}
                transition={transition}
              >
                <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4 dark:border-ink-800">
                  <div>
                    <Dialog.Title className="text-base font-semibold text-ink dark:text-paper">
                      {title}
                    </Dialog.Title>
                    {description ? (
                      <Dialog.Description className="mt-1 text-sm text-ink-500 dark:text-ink-300">
                        {description}
                      </Dialog.Description>
                    ) : (
                      <Dialog.Description className="sr-only">{title}</Dialog.Description>
                    )}
                  </div>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      aria-label="Close"
                      className="rounded-md p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink dark:hover:bg-ink-800 dark:hover:text-paper"
                    >
                      <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </Dialog.Close>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

                {footer && (
                  <div className="border-t border-ink-100 px-5 py-4 dark:border-ink-800">{footer}</div>
                )}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

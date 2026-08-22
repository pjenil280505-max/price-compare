"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { Send, Sparkles } from "lucide-react";
import type { ChatMessage, Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { fadeUp, useReducedMotionSafe, withMotionPreference } from "@/lib/motion";
import { Modal } from "@/components/ui/Modal";
import { ProductCard } from "@/components/product/ProductCard";

export interface AIChatProps {
  messages: ChatMessage[];
  isSending?: boolean;
  onSendMessage: (message: string) => void | Promise<void>;
  onToggleWishlist?: (product: Product) => void | Promise<void>;
  className?: string;
}

function TypingIndicator({ reduced }: { reduced: boolean }) {
  return (
    <div className="flex items-center gap-1 rounded-2xl bg-ink-50 px-4 py-3 dark:bg-ink-800" aria-label="Assistant is typing">
      {[0, 1, 2].map((i) =>
        reduced ? (
          <span key={i} className="h-1.5 w-1.5 rounded-full bg-ink-400 opacity-60" />
        ) : (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-ink-400"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
          />
        ),
      )}
    </div>
  );
}

export function AIChat({ messages, isSending, onSendMessage, onToggleWishlist, className }: AIChatProps) {
  const reduced = useReducedMotionSafe();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [messages.length, isSending, reduced]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || isSending) return;
    setDraft("");
    await onSendMessage(text);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-1 py-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-ink-400">
            <Sparkles className="h-6 w-6 text-saffron" aria-hidden="true" />
            <p>Ask me to find, compare, or track the price of anything.</p>
          </div>
        )}

        {messages.map((message) => (
          <motion.div
            key={message.id}
            variants={withMotionPreference(fadeUp, reduced)}
            initial="hidden"
            animate="visible"
            className={cn("flex flex-col gap-2", message.role === "user" ? "items-end" : "items-start")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                message.role === "user"
                  ? "bg-ink text-paper dark:bg-saffron dark:text-ink-950"
                  : "bg-ink-50 text-ink dark:bg-ink-800 dark:text-paper",
              )}
            >
              {message.content}
            </div>

            {message.products && message.products.length > 0 && (
              <div className="flex w-full gap-3 overflow-x-auto pb-1 scrollbar-thin">
                {message.products.map((product) => (
                  <div key={product.id} className="w-40 shrink-0">
                    <ProductCard product={product} onToggleWishlist={onToggleWishlist} />
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        ))}

        {isSending && <TypingIndicator reduced={reduced} />}
      </div>

      <div className="flex items-center gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about a product, price, or deal…"
          id="assistant-message"
          aria-label="Message the shopping assistant"
          className="h-11 flex-1 rounded-full border border-ink-200 bg-paper px-4 text-sm text-ink placeholder:text-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron dark:border-ink-700 dark:bg-ink-900 dark:text-paper"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!draft.trim() || isSending}
          aria-label="Send message"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition-colors disabled:opacity-40 dark:bg-saffron dark:text-ink-950"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export interface AIChatLauncherProps extends AIChatProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Floating-action-button entry point that opens AIChat in a bottom sheet. */
export function AIChatLauncher({ open, onOpenChange, ...chatProps }: AIChatLauncherProps) {
  const reduced = useReducedMotionSafe();

  return (
    <>
      {!open && (
        <motion.button
          type="button"
          onClick={() => onOpenChange(true)}
          whileTap={reduced ? undefined : { scale: 0.94 }}
          className="fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-paper shadow-card-hover dark:bg-saffron dark:text-ink-950"
          aria-label="Open shopping assistant"
        >
          <Sparkles className="h-6 w-6" aria-hidden="true" />
        </motion.button>
      )}

      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="Shopping assistant"
        description="Grounded in live prices from every store we track."
        variant="sheet"
        className="h-[75vh]"
      >
        <AIChat {...chatProps} className="h-full" />
      </Modal>
    </>
  );
}

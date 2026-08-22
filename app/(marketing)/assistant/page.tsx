"use client";

import { useMemo, useState } from "react";
import type { ChatMessage } from "@/lib/types";
import { api } from "@/lib/api";
import { Container } from "@/components/layout/Container";
import { PageHeader } from "@/components/layout/PageHeader";
import { AIChat } from "@/components/assistant/AIChat";
import { InteractiveProductGrid } from "@/components/product/InteractiveProductGrid";
import { EmptyState } from "@/components/ui/EmptyState";

export default function AssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);

  const latestProducts = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message?.products?.length) return message.products;
    }
    return [];
  }, [messages]);

  async function handleSendMessage(text: string) {
    const userMessage: ChatMessage = {
      id: `local_${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setIsSending(true);

    try {
      const reply = await api.sendAssistantMessage(text, nextMessages);
      setMessages((prev) => [...prev, reply]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `error_${Date.now()}`,
          role: "assistant",
          content: "Something went wrong on my end — try asking that again in a moment.",
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Container className="flex h-[calc(100vh-4rem)] flex-col py-6">
      <PageHeader
        title="AI Assistant"
        description="Grounded in live prices from every store we track — it never guesses a number."
        className="mb-6 shrink-0"
      />

      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex min-h-0 flex-col rounded-lg border border-ink-100 p-4 dark:border-ink-800">
          <AIChat messages={messages} isSending={isSending} onSendMessage={handleSendMessage} className="h-full" />
        </div>

        <div className="hidden min-h-0 flex-col overflow-y-auto lg:flex">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
            Grounded in these products
          </h2>
          {latestProducts.length > 0 ? (
            <InteractiveProductGrid
              initialProducts={latestProducts}
              className="grid-cols-1 sm:grid-cols-1 lg:grid-cols-1"
            />
          ) : (
            <EmptyState title="Nothing yet" description="Ask a question and results will show up here." />
          )}
        </div>
      </div>
    </Container>
  );
}

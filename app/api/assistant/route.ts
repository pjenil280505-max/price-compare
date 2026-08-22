import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { performSearch } from "@/lib/server/search";
import type { SearchResultItem } from "@/lib/search/types";
import type { ChatMessage, Product } from "@/lib/types";
import { formatPrice } from "@/lib/utils";

// Derived directly from the SDK's own method signature rather than
// imported from a submodule path, so this stays correct even if the
// package's internal file layout changes between versions.
type CreateParams = Parameters<Anthropic["messages"]["create"]>[0];
type AnthropicMessage = CreateParams["messages"][number];
type AnthropicTool = NonNullable<CreateParams["tools"]>[number];

/** The well-documented shape of a tool_result content block (Anthropic Messages API). */
interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

const requestSchema = z.object({
  message: z.string().min(1).max(1000),
  history: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(["user", "assistant"]),
        content: z.string(),
        createdAt: z.string(),
      }),
    )
    .max(20),
});

const SEARCH_TOOL: AnthropicTool = {
  name: "search_products",
  description:
    "Search the live product catalog by keyword, with optional price/category filters. Returns real, currently-tracked products with real prices — never guess a price or product without calling this.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keywords, e.g. 'wireless earbuds under 3000'" },
      maxPrice: { type: "number", description: "Optional maximum price in INR" },
    },
    required: ["query"],
  },
};

const SYSTEM_PROMPT = `You are the shopping assistant for an Indian multi-store price-comparison
site. You help people find products, compare prices across stores, and
understand deals. You MUST call search_products to find or verify any
product or price — never state a product name, price, or store name from
memory. If a search returns nothing relevant, say so plainly rather than
inventing an answer. Keep replies short (2-4 sentences) and concrete.
Prices are in INR.`;

export const POST = withErrorHandling(async (request: Request) => {
  // This endpoint is unauthenticated (the assistant is usable signed-out)
  // AND calls a paid API on every request, which makes it the single
  // biggest cost-abuse surface in the app. See lib/server/rateLimit.ts for
  // why this needs to become Redis-backed before real traffic.
  enforceRateLimit(request, { key: "assistant", limit: 10, windowMs: 60_000 });

  const { message, history } = requestSchema.parse(await request.json());
  const supabase = await createClient();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const messages: AnthropicMessage[] = [
    ...history.map((m): AnthropicMessage => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  const groundedResults: SearchResultItem[] = [];
  let finalText = "";

  // Bounded tool-use loop: the model may call search_products a few times
  // before answering, but this can never run away — 4 iterations is
  // generous for "search, maybe refine, answer."
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [SEARCH_TOOL],
      messages,
    });

    const toolUseBlocks = response.content.filter((block) => block.type === "tool_use");
    const textBlocks = response.content.filter((block) => block.type === "text");
    finalText = textBlocks
      .map((block) => (block.type === "text" ? block.text : ""))
      .join(" ")
      .trim();

    if (toolUseBlocks.length === 0) break;

    messages.push({ role: "assistant", content: response.content });

    const toolResults: ToolResultBlock[] = [];
    for (const block of toolUseBlocks) {
      if (block.type !== "tool_use" || block.name !== "search_products") continue;

      const input = block.input as { query?: string; maxPrice?: number };
      const result = await performSearch(supabase, {
        query: input.query ?? "",
        filters: input.maxPrice ? { priceMax: input.maxPrice } : undefined,
      });

      const topResults = result.items.slice(0, 6);
      groundedResults.push(...topResults);

      // Prices quoted to the model are already freshness-filtered by
      // search_products — an expired price can never reach the assistant
      // and therefore can never be repeated to a user as current.
      const summary = topResults.map((r) =>
        r.bestPrice != null
          ? `${r.title} — ${formatPrice(r.bestPrice)} at ${r.merchantName ?? "a tracked store"}` +
            (r.freshness === "stale" ? " (price may have changed)" : "")
          : `${r.title} — no current price available`,
      );

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: summary.length > 0 ? summary.join("\n") : "No matching products found.",
      });
    }

    // Cast at this one boundary rather than typing toolResults against the
    // SDK's own (more permissive, partly-optional) content-block type —
    // the object we build matches the documented required fields exactly.
    messages.push({ role: "user", content: toolResults as AnthropicMessage["content"] });
  }

  const reply: ChatMessage = {
    id: `msg_${Date.now()}`,
    role: "assistant",
    content: finalText || "I couldn't find anything for that — try rephrasing?",
    products: groundedResults.length > 0 ? toProductCards(groundedResults).slice(0, 6) : undefined,
    createdAt: new Date().toISOString(),
  };

  return NextResponse.json(reply);
});

/**
 * Maps search rows onto the Product shape the chat UI renders. Only fields
 * search actually returned are populated — nothing is invented to fill the
 * type out.
 */
function toProductCards(results: SearchResultItem[]): Product[] {
  const seen = new Set<string>();
  const unique = results.filter((r) => (seen.has(r.productId) ? false : (seen.add(r.productId), true)));

  return unique.map((r) => ({
    id: r.productId,
    slug: r.slug,
    title: r.title,
    brand: r.brand,
    category: r.category ?? "",
    imageUrl: r.imageUrl,
    rating: r.rating,
    reviewCount: r.reviewCount,
    offers:
      r.bestPrice != null && r.buyUrl && r.merchantName
        ? [
            {
              id: r.buyUrl.replace("/go/", ""),
              merchant: {
                id: r.merchantSlug ?? r.merchantName,
                name: r.merchantName,
                slug: r.merchantSlug ?? "",
                logoUrl: r.merchantLogoUrl ?? "",
              },
              price: r.bestPrice,
              mrp: r.mrp,
              currency: "INR" as const,
              discountPercent: r.discountPercent,
              inStock: r.inStock,
              buyUrl: r.buyUrl,
              lastCheckedAt: r.lastCheckedAt ?? new Date().toISOString(),
            },
          ]
        : [],
  }));
}

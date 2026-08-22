import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import {
  AUTO_MERGE_THRESHOLD,
  REVIEW_THRESHOLD,
  fingerprint,
  matchProduct,
  type MatchCandidate,
  type MatchResult,
  type MatchSubject,
} from "@/lib/matching/matcher";
import { hasHardVariantConflict, type VariantAxis } from "@/lib/matching/variant";

/**
 * Bridges the pure matcher (lib/matching/matcher.ts) to the database and
 * the optional AI fallback.
 *
 * The AI tier is used ONLY in a narrow band: when deterministic tiers found
 * plausible candidates but landed below the review threshold. It is never
 * allowed to raise a match above the review threshold on its own — an LLM's
 * opinion routes an item to a human, it does not auto-merge anything. And
 * its output passes through the same hard variant gate as every other tier.
 */

interface CandidateRow {
  product_id: string;
  title: string;
  brand_name: string | null;
  model: string | null;
  mpn: string | null;
  gtin: string | null;
  product_key: string | null;
  variants: { id: string; signature: string; axes: Record<string, string> }[] | null;
}

/** Confidence assigned when the AI says two items are the same product. */
const AI_CONFIDENCE = 0.6;
/** Below this, don't even ask the AI — nothing plausible was found. */
const AI_FLOOR = 0.25;

export interface MatchOptions {
  /** Disable the AI tier (e.g. during a bulk backfill, to control cost). */
  useAi?: boolean;
}

export async function resolveMatch(
  supabase: SupabaseClient,
  subject: MatchSubject,
  options: MatchOptions = {},
): Promise<MatchResult> {
  const fp = fingerprint(subject);

  const { data, error } = await supabase.rpc("find_match_candidates", {
    p_gtin: fp.gtin ?? null,
    p_mpn: fp.mpn ?? null,
    p_model: fp.model ?? null,
    p_brand_name: subject.brand ?? null,
    p_product_key: fp.productKey || null,
    p_limit: 10,
  });

  if (error) throw error;

  const candidates: MatchCandidate[] = ((data ?? []) as CandidateRow[]).map((row) => ({
    productId: row.product_id,
    title: row.title,
    brand: row.brand_name ?? undefined,
    model: row.model ?? undefined,
    mpn: row.mpn ?? undefined,
    gtin: row.gtin ?? undefined,
    productKey: row.product_key ?? undefined,
    variants: (row.variants ?? []).map((v) => ({
      id: v.id,
      signature: v.signature ?? "",
      axes: (v.axes ?? {}) as Partial<Record<VariantAxis, string>>,
    })),
  }));

  const result = matchProduct(subject, candidates);

  // AI fallback: only for the "plausible but unresolved" band.
  const shouldTryAi =
    (options.useAi ?? true) &&
    result.decision === "create_new" &&
    candidates.length > 0 &&
    result.confidence < REVIEW_THRESHOLD &&
    result.confidence >= AI_FLOOR &&
    Boolean(process.env.ANTHROPIC_API_KEY);

  if (!shouldTryAi) return result;

  try {
    // Pre-filter: never even show the model a candidate that a hard variant
    // conflict already disqualifies. Saves tokens, and removes any chance of
    // the model anchoring on a pair it was never allowed to pick.
    const eligible = candidates.filter(
      (c) => c.variants.length === 0 || c.variants.some((v) => !hasHardVariantConflict(fp.axes, v.axes)),
    );
    if (eligible.length === 0) {
      return { ...result, reasons: [...result.reasons, "AI skipped: all candidates variant-blocked"] };
    }

    const aiMatch = await askAiForMatch(subject, eligible);
    if (!aiMatch) return result;

    // Guard against a hallucinated id: only accept one we actually offered.
    const chosen = eligible.find((c) => c.productId === aiMatch.productId);
    if (!chosen) return result;

    // The AI does not get to bypass the variant gate.
    const conflicting = chosen.variants.some((v) => hasHardVariantConflict(fp.axes, v.axes));
    const exactVariant = chosen.variants.find((v) => v.signature === fp.variantSignature);

    if (conflicting && !exactVariant) {
      return {
        ...result,
        reasons: [...result.reasons, "AI suggested a match but a hard variant conflict blocked it"],
      };
    }

    return {
      ...result,
      // Capped at review — an LLM judgement never auto-merges.
      decision: "review",
      tier: "ai",
      confidence: Math.min(AI_CONFIDENCE, AUTO_MERGE_THRESHOLD - 0.01),
      productId: chosen.productId,
      variantId: exactVariant?.id ?? null,
      reasons: [...result.reasons, `AI fallback: ${aiMatch.reason}`],
    };
  } catch (err) {
    // The AI tier is best-effort — never fail ingestion because it was
    // unavailable or rate-limited.
    return {
      ...result,
      reasons: [...result.reasons, `AI fallback unavailable: ${err instanceof Error ? err.message : "error"}`],
    };
  }
}

interface AiVerdict {
  productId: string;
  reason: string;
}

async function askAiForMatch(
  subject: MatchSubject,
  candidates: MatchCandidate[],
): Promise<AiVerdict | null> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const list = candidates
    .slice(0, 6)
    .map((c, i) => `${i + 1}. [${c.productId}] ${c.brand ?? "?"} — ${c.title}`)
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 300,
    system:
      "You decide whether a product listing refers to the SAME physical product as one of the candidates. " +
      "Be conservative: answer NONE unless you are confident. " +
      "Products differing in storage capacity, RAM, screen size, pack quantity, or physical size are " +
      "DIFFERENT products — answer NONE for those. Colour differences alone are the same product. " +
      'Reply ONLY with JSON: {"productId": "<id>" | null, "reason": "<short reason>"}. No other text.',
    messages: [
      {
        role: "user",
        content:
          `Listing: ${subject.brand ?? "?"} — ${subject.title}\n\n` +
          `Candidates:\n${list}\n\nWhich candidate, if any, is the same product?`,
      },
    ],
  });

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join(" ")
    .trim();

  const cleaned = text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned) as { productId: string | null; reason?: string };

  if (!parsed?.productId) return null;
  return { productId: parsed.productId, reason: parsed.reason ?? "model judgement" };
}

export { AUTO_MERGE_THRESHOLD, REVIEW_THRESHOLD };

/**
 * Writes a review row for an uncertain match. Upserts on the existing
 * unique (merchant_offer_id, candidate_product_id) constraint so
 * re-ingesting the same ambiguous item updates its review task rather than
 * piling up duplicates for the admin.
 */
export async function queueForReview(
  supabase: SupabaseClient,
  params: {
    merchantOfferId: string;
    candidateProductId: string;
    subjectTitle: string;
    result: MatchResult;
  },
): Promise<void> {
  const { result } = params;

  const { error } = await supabase.from("product_match_reviews").upsert(
    {
      merchant_offer_id: params.merchantOfferId,
      candidate_product_id: params.candidateProductId,
      confidence_score: Number(Math.min(1, Math.max(0, result.confidence)).toFixed(3)),
      status: "pending",
      match_tier: result.tier,
      proposed_variant_signature: result.fingerprint.variantSignature,
      subject_snapshot: {
        title: params.subjectTitle,
        productKey: result.fingerprint.productKey,
        brand: result.fingerprint.brand ?? null,
        model: result.fingerprint.model ?? null,
        gtin: result.fingerprint.gtin ?? null,
        mpn: result.fingerprint.mpn ?? null,
        variantLabel: result.fingerprint.variantLabel,
        axes: result.fingerprint.axes,
      },
      conflicts: result.conflicts,
      reasons: result.reasons,
    },
    { onConflict: "merchant_offer_id,candidate_product_id" },
  );

  if (error) throw error;
}

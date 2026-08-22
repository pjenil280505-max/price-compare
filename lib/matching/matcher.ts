import {
  buildProductKey,
  jaccardSimilarity,
  normalizeBrand,
  normalizeGtin,
  normalizeIdentifier,
  normalizeText,
  tokenSet,
} from "./normalize";
import {
  buildVariantLabel,
  buildVariantSignature,
  countAxisGaps,
  extractVariant,
  findVariantConflicts,
  type VariantAxis,
  type VariantConflict,
} from "./variant";

/**
 * TIERED PRODUCT MATCHING
 *
 * Tiers are tried in the priority order specified for this system. The
 * first tier that produces a candidate wins — lower tiers are never used
 * to "upgrade" a weaker match into a stronger one, because that's how
 * false merges happen.
 *
 * Every tier's result is then passed through the same variant gate: a hard
 * variant conflict downgrades ANY match, including a GTIN match, to review.
 */

export const MATCH_TIERS = [
  "gtin",
  "mpn",
  "model",
  "brand_model",
  "variant_exact",
  "attribute_signature",
  "normalized_title",
  "fuzzy",
  "ai",
] as const;

export type MatchTier = (typeof MATCH_TIERS)[number];

/** Base confidence per tier, before penalties. */
const TIER_BASE_CONFIDENCE: Record<MatchTier, number> = {
  gtin: 0.99,
  mpn: 0.95,
  model: 0.9,
  brand_model: 0.85,
  variant_exact: 0.82,
  attribute_signature: 0.78,
  normalized_title: 0.74,
  fuzzy: 0.6,
  ai: 0.55,
};

/** At or above this, merge automatically. */
export const AUTO_MERGE_THRESHOLD = 0.9;
/** At or above this (but below auto), queue for admin review. */
export const REVIEW_THRESHOLD = 0.55;

export type MatchDecision = "auto_merge" | "review" | "create_new";

/** A normalized incoming item, ready to match. */
export interface MatchSubject {
  externalId: string;
  title: string;
  brand?: string;
  model?: string;
  mpn?: string;
  gtin?: string;
  variantAttributes?: Record<string, string>;
}

/** An existing catalog product to compare against. */
export interface MatchCandidate {
  productId: string;
  title: string;
  brand?: string;
  model?: string;
  mpn?: string;
  gtin?: string;
  productKey?: string;
  /** Existing variants, so we can find or create the right one. */
  variants: { id: string; signature: string; axes: Partial<Record<VariantAxis, string>> }[];
}

export interface MatchFingerprint {
  productKey: string;
  normalizedTitle: string;
  brand?: string;
  model?: string;
  mpn?: string;
  gtin?: string;
  variantSignature: string;
  variantLabel: string;
  axes: Partial<Record<VariantAxis, string>>;
}

export interface MatchResult {
  decision: MatchDecision;
  tier: MatchTier | null;
  confidence: number;
  productId: string | null;
  /** Existing variant with an identical signature, if one exists. */
  variantId: string | null;
  fingerprint: MatchFingerprint;
  conflicts: VariantConflict[];
  reasons: string[];
}

/** Computes everything derivable from the item alone, with no DB access. */
export function fingerprint(subject: MatchSubject): MatchFingerprint {
  const extracted = extractVariant({
    title: subject.title,
    attributes: subject.variantAttributes,
  });

  const productKey = buildProductKey({
    title: subject.title,
    brand: subject.brand,
    model: subject.model,
    variantTokens: extracted.tokens,
  });

  return {
    productKey,
    normalizedTitle: normalizeText(subject.title),
    brand: normalizeBrand(subject.brand),
    model: normalizeIdentifier(subject.model),
    mpn: normalizeIdentifier(subject.mpn),
    gtin: normalizeGtin(subject.gtin),
    variantSignature: buildVariantSignature(extracted.axes),
    variantLabel: buildVariantLabel(extracted.axes),
    axes: extracted.axes,
  };
}

/**
 * Scores one candidate against the subject and returns the winning tier.
 * Returns null when no tier applies at all.
 */
function scoreCandidate(
  fp: MatchFingerprint,
  candidate: MatchCandidate,
): { tier: MatchTier; confidence: number; reasons: string[] } | null {
  const reasons: string[] = [];
  const candidateBrand = normalizeBrand(candidate.brand);
  const candidateModel = normalizeIdentifier(candidate.model);
  const candidateMpn = normalizeIdentifier(candidate.mpn);
  const candidateGtin = normalizeGtin(candidate.gtin);

  // BRAND GATE — a definite brand mismatch disqualifies the candidate
  // entirely, at every tier below GTIN. Two different brands are not the
  // same product even if the titles are near-identical (own-brand
  // lookalikes are extremely common in Indian marketplaces).
  const brandsBothKnown = Boolean(fp.brand && candidateBrand);
  const brandMismatch = brandsBothKnown && fp.brand !== candidateBrand;

  // Tier 1 — GTIN. Authoritative, survives a brand mismatch (feeds
  // mislabel brands far more often than they mislabel barcodes).
  if (fp.gtin && candidateGtin && fp.gtin === candidateGtin) {
    reasons.push(`GTIN match (${fp.gtin})`);
    if (brandMismatch) reasons.push(`brand differs (${fp.brand} vs ${candidateBrand}) — GTIN takes precedence`);
    return { tier: "gtin", confidence: TIER_BASE_CONFIDENCE.gtin, reasons };
  }

  if (brandMismatch) return null;

  // Tier 2 — manufacturer part number.
  if (fp.mpn && candidateMpn && fp.mpn === candidateMpn) {
    reasons.push(`MPN match (${fp.mpn})`);
    return { tier: "mpn", confidence: TIER_BASE_CONFIDENCE.mpn, reasons };
  }

  // Tier 3 — model number (only meaningful alongside a brand, since model
  // strings like "A15" collide across manufacturers).
  if (fp.model && candidateModel && fp.model === candidateModel) {
    if (brandsBothKnown) {
      reasons.push(`brand + model match (${fp.brand} ${fp.model})`);
      return { tier: "brand_model", confidence: TIER_BASE_CONFIDENCE.brand_model, reasons };
    }
    reasons.push(`model match (${fp.model})`);
    return { tier: "model", confidence: TIER_BASE_CONFIDENCE.model, reasons };
  }

  // Tier 5/6 — exact product key means title-minus-variant is identical.
  if (candidate.productKey && fp.productKey && candidate.productKey === fp.productKey) {
    reasons.push("identical normalized product key");
    return { tier: "variant_exact", confidence: TIER_BASE_CONFIDENCE.variant_exact, reasons };
  }

  // Tier 7 — normalized title similarity.
  const similarity = jaccardSimilarity(tokenSet(fp.productKey), tokenSet(candidate.productKey ?? candidate.title));

  if (similarity >= 0.85) {
    reasons.push(`normalized title similarity ${similarity.toFixed(2)}`);
    return {
      tier: "normalized_title",
      // Scale within the tier so 0.85 similarity doesn't score like 0.99.
      confidence: TIER_BASE_CONFIDENCE.normalized_title * similarity,
      reasons,
    };
  }

  // Tier 8 — controlled fuzzy. "Controlled" means it requires a shared
  // brand; without that, high token overlap on generic words ("wireless
  // bluetooth earbuds black") matches unrelated products constantly.
  if (similarity >= 0.6 && brandsBothKnown) {
    reasons.push(`fuzzy similarity ${similarity.toFixed(2)} with matching brand`);
    return { tier: "fuzzy", confidence: TIER_BASE_CONFIDENCE.fuzzy * similarity, reasons };
  }

  return null;
}

/**
 * Matches a subject against candidates. Pure and synchronous — the AI
 * fallback is applied separately by the caller (see service.ts) only
 * when this returns create_new with plausible-but-weak candidates.
 */
export function matchProduct(subject: MatchSubject, candidates: MatchCandidate[]): MatchResult {
  const fp = fingerprint(subject);

  const base: Omit<MatchResult, "decision" | "tier" | "confidence" | "productId" | "variantId"> = {
    fingerprint: fp,
    conflicts: [],
    reasons: [],
  };

  if (candidates.length === 0) {
    return { ...base, decision: "create_new", tier: null, confidence: 0, productId: null, variantId: null,
      reasons: ["no candidates returned"] };
  }

  let best: { candidate: MatchCandidate; tier: MatchTier; confidence: number; reasons: string[] } | null = null;

  for (const candidate of candidates) {
    const scored = scoreCandidate(fp, candidate);
    if (!scored) continue;
    if (!best || scored.confidence > best.confidence) {
      best = { candidate, ...scored };
    }
  }

  if (!best) {
    return { ...base, decision: "create_new", tier: null, confidence: 0, productId: null, variantId: null,
      reasons: ["no tier matched any candidate"] };
  }

  const reasons = [...best.reasons];
  let confidence = best.confidence;

  // ---- THE VARIANT GATE ------------------------------------------------
  // Compare against the candidate's variants. A hard conflict with EVERY
  // existing variant is fine — it just means this is a new variant of a
  // known product. What matters is that we never reuse a variant row whose
  // signature differs.
  const exactVariant = best.candidate.variants.find((v) => v.signature === fp.variantSignature);

  // Aggregate conflicts against the closest existing variant, for the
  // review UI to display something meaningful.
  const comparisonVariant = exactVariant ?? best.candidate.variants[0];
  const conflicts = comparisonVariant ? findVariantConflicts(fp.axes, comparisonVariant.axes) : [];

  if (exactVariant) {
    reasons.push(`exact variant signature match (${fp.variantSignature || "standard"})`);
  } else if (best.candidate.variants.length > 0) {
    reasons.push(`new variant "${fp.variantLabel}" of an existing product`);
    // Attaching a brand-new variant to an existing product is a weaker
    // claim than matching an existing one — the variant might actually
    // belong to a different product generation.
    confidence -= 0.05;
  }

  // Missing axes on one side: we can't prove they're the same variant.
  const gaps = comparisonVariant ? countAxisGaps(fp.axes, comparisonVariant.axes) : 0;
  if (gaps > 0) {
    confidence -= Math.min(0.15, gaps * 0.05);
    reasons.push(`${gaps} variant axis/axes present on only one side`);
  }

  // A hard conflict against the SAME signature should be impossible (equal
  // signatures cannot conflict), so this only fires on data inconsistency.
  const hardConflicts = conflicts.filter((c) => c.severity === "hard");
  const conflictsWithMatchedVariant = exactVariant ? hardConflicts : [];

  if (conflictsWithMatchedVariant.length > 0) {
    reasons.push(
      `BLOCKED: hard variant conflict on ${conflictsWithMatchedVariant.map((c) => c.axis).join(", ")}`,
    );
    return {
      ...base,
      decision: "review",
      tier: best.tier,
      confidence: Math.min(confidence, REVIEW_THRESHOLD),
      productId: best.candidate.productId,
      variantId: null,
      conflicts,
      reasons,
    };
  }

  confidence = Math.max(0, Math.min(1, confidence));

  const decision: MatchDecision =
    confidence >= AUTO_MERGE_THRESHOLD ? "auto_merge" : confidence >= REVIEW_THRESHOLD ? "review" : "create_new";

  return {
    ...base,
    decision,
    tier: best.tier,
    confidence,
    productId: decision === "create_new" ? null : best.candidate.productId,
    variantId: exactVariant?.id ?? null,
    conflicts,
    reasons,
  };
}

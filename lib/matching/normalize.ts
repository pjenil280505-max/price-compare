/**
 * Normalization layer for product matching.
 *
 * THE CENTRAL IDEA — read this before changing anything here:
 *
 * Product identity and variant identity are computed SEPARATELY.
 *
 *   productKey       = brand + model + title WITH ALL VARIANT TOKENS REMOVED
 *   variantSignature = the variant tokens themselves (see variant.ts)
 *
 * "iPhone 15 256GB Black" and "iPhone 15 512GB Blue" produce the SAME
 * productKey and DIFFERENT variantSignatures. They therefore attach to the
 * same product row but can never resolve to the same variant row — which
 * is how the "never merge 256GB with 512GB" requirement is enforced
 * structurally, rather than by a similarity threshold that could drift.
 */

/** Marketing noise that carries no identity and only adds false similarity. */
const NOISE_PATTERNS: RegExp[] = [
  /\b(brand\s*new|newly\s*launched|latest|new\s*launch)\b/gi,
  /\b(free\s*shipping|free\s*delivery|cash\s*on\s*delivery|cod)\b/gi,
  /\b(best\s*seller|bestseller|top\s*rated|hot\s*deal|limited\s*(time|stock|edition\s*offer))\b/gi,
  /\b(official|authorized|genuine|original)\s*(seller|dealer|product|item)\b/gi,
  /\b(with\s*)?\d+\s*(year|yr|month)s?\s*(manufacturer\s*)?warranty\b/gi,
  /\b(pack\s*of\s*1|single\s*pack)\b/gi,
  /\b(buy|shop)\s*(now|online)\b/gi,
  /\b(for\s*)?(men|women|unisex|boys|girls|kids)['’]?s?\b/gi,
  /\b(imported|made\s*in\s*india)\b/gi,
];

/** Currency/price fragments some feeds append to titles. */
const PRICE_PATTERN = /(₹|rs\.?|inr)\s*[\d,]+(\.\d+)?/gi;

/** Bracketed marketing suffixes: "(2024 Model)", "[Latest]", "- Amazon Exclusive". */
const BRACKET_NOISE = /[\[(]\s*(latest|new|\d{4}\s*(model|edition|release)|amazon|flipkart)[^\])]*[\])]/gi;

/**
 * Unicode-aware lowercase + punctuation flattening.
 * Keeps digits and letters (including Devanagari, for Indian-market titles),
 * collapses everything else to single spaces.
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKD")
    // Strip combining marks so "Café" and "Cafe" normalize alike.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Brand normalization. Merchant feeds spell the same brand many ways, and a
 * brand mismatch is a hard blocker in the matcher — so getting this wrong
 * causes false negatives (duplicate products), while getting it too
 * aggressive causes false positives (wrong merges). Deliberately
 * conservative: only well-known, unambiguous aliases.
 */
const BRAND_ALIASES: Record<string, string> = {
  "hewlett packard": "hp",
  "hewlettpackard": "hp",
  "samsung electronics": "samsung",
  "apple inc": "apple",
  "oneplus technology": "oneplus",
  "one plus": "oneplus",
  "xiaomi india": "xiaomi",
  mi: "xiaomi",
  redmi: "xiaomi",
  "poco india": "poco",
  "sony corporation": "sony",
  "lg electronics": "lg",
  "asus tek": "asus",
  asustek: "asus",
  "lenovo group": "lenovo",
  "boat lifestyle": "boat",
  "bo at": "boat",
  "jbl harman": "jbl",
  "harman kardon": "harmankardon",
};

export function normalizeBrand(brand: string | undefined | null): string | undefined {
  if (!brand) return undefined;
  const base = normalizeText(brand);
  if (!base) return undefined;
  const alias = BRAND_ALIASES[base];
  if (alias) return alias;
  // Collapse internal spaces for single-token brands written apart
  // ("One Plus" -> "oneplus") only when the result is a known brand.
  const collapsed = base.replace(/\s+/g, "");
  if (BRAND_ALIASES[collapsed]) return BRAND_ALIASES[collapsed];
  return base;
}

/**
 * Manufacturer part numbers and model numbers vary in punctuation across
 * feeds ("MQ8Y3HN/A" vs "mq8y3hn-a"). Canonicalize to alphanumerics only.
 * Returns undefined for values too short or too generic to be identifying.
 */
export function normalizeIdentifier(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length < 3) return undefined;
  // Pure-digit strings under 6 chars are usually sizes or counts, not MPNs.
  if (/^\d+$/.test(cleaned) && cleaned.length < 6) return undefined;
  // Reject obvious placeholders.
  if (/^(NA|NONE|NULL|GENERIC|STANDARD|DEFAULT|NOTAPPLICABLE)$/.test(cleaned)) return undefined;
  return cleaned;
}

/**
 * GTIN/EAN/UPC validation with check-digit verification.
 *
 * This matters more than it looks: GTIN is the highest-priority matching
 * signal, so a malformed or padded value that slips through would cause
 * confident merges of unrelated products. Anything failing the check digit
 * is rejected outright rather than used as a weak signal.
 */
export function normalizeGtin(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/[^0-9]/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return undefined;
  // All-zero / all-same values appear in real feeds as placeholders.
  if (/^(\d)\1+$/.test(digits)) return undefined;
  if (!hasValidGtinCheckDigit(digits)) return undefined;
  // Normalize to GTIN-14 so UPC-A (12) and EAN-13 forms of the same product
  // compare equal — a real cause of missed matches otherwise.
  return digits.padStart(14, "0");
}

function hasValidGtinCheckDigit(digits: string): boolean {
  const body = digits.slice(0, -1);
  const check = Number(digits.slice(-1));
  let sum = 0;
  // Weights alternate 3/1 from the rightmost body digit leftwards.
  for (let i = body.length - 1, weight = 3; i >= 0; i -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Builds the product-identity key: normalized title with brand, noise, and
 * every variant token stripped out. `variantTokens` comes from the variant
 * extractor so the two stay in lockstep — anything treated as a variant
 * axis is by definition excluded from product identity.
 */
export function buildProductKey(params: {
  title: string;
  brand?: string;
  model?: string;
  variantTokens: string[];
}): string {
  let text = params.title;

  text = text.replace(PRICE_PATTERN, " ").replace(BRACKET_NOISE, " ");
  for (const pattern of NOISE_PATTERNS) text = text.replace(pattern, " ");

  let normalized = normalizeText(text);

  // Remove the variant tokens the extractor found, longest first so
  // "256 gb" is removed before a bare "gb" could be.
  const tokens = [...params.variantTokens]
    .map((t) => normalizeText(t))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const token of tokens) {
    normalized = normalized.split(token).join(" ");
  }

  const brand = normalizeBrand(params.brand);
  if (brand) {
    // Strip a leading brand mention; keep later occurrences, which are
    // usually part of a model name ("Galaxy S24" vs "Samsung Galaxy S24").
    if (normalized.startsWith(`${brand} `)) normalized = normalized.slice(brand.length + 1);
  }

  const words = normalized.split(" ").filter((w) => w.length > 0);

  // Deduplicate while preserving order — repeated brand/model words are
  // common in concatenated feed titles and inflate similarity scores.
  const seen = new Set<string>();
  const deduped = words.filter((w) => (seen.has(w) ? false : (seen.add(w), true)));

  const model = normalizeIdentifier(params.model);
  const parts = [brand, model ? model.toLowerCase() : undefined, deduped.join(" ")].filter(Boolean);

  return parts.join(" ").trim().replace(/\s+/g, " ");
}

/** Token set for Jaccard similarity, with 1-character tokens dropped as noise. */
export function tokenSet(value: string): Set<string> {
  return new Set(normalizeText(value).split(" ").filter((t) => t.length > 1));
}

/** Jaccard similarity over token sets: |A ∩ B| / |A ∪ B|. */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

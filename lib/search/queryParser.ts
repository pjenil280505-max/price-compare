import { extractVariant, type VariantAxis } from "@/lib/matching/variant";
import { normalizeText } from "@/lib/matching/normalize";
import type { SortOption } from "@/lib/types";

/**
 * NATURAL-LANGUAGE QUERY PARSING
 *
 * Turns "gaming laptop under ₹60,000" into structured filters plus the
 * residual text that goes to full-text search.
 *
 * Deliberate reuse, not duplication:
 *   - variant/spec extraction ("16GB RAM") calls extractVariant() from the
 *     matching system, so a query's understanding of "16GB RAM" is exactly
 *     the same as ingestion's. If those ever diverged, a user could filter
 *     to a spec that no product is indexed under.
 *   - text normalization calls normalizeText() from the same module.
 *
 * Brand is NOT extracted here. There is no hard-coded brand list anywhere
 * in this system — brands come from ingested data — so "OnePlus phone"
 * matches through full-text/trigram search against real indexed brands
 * rather than a list I'd have to invent and maintain.
 */

export interface ParsedQuery {
  /** Residual text for full-text search, with parsed constraints removed. */
  text: string;
  /** Original query, preserved for display and analytics. */
  raw: string;
  minPrice?: number;
  maxPrice?: number;
  /** Variant axes to filter on, e.g. { ram: "16GB" }. Same shape as product_variants.variant_axes. */
  variantAxes: Partial<Record<VariantAxis, string>>;
  /** Sort implied by the wording, when the user expressed one. */
  impliedSort?: SortOption;
  /** Human-readable summary of what was understood, for the results UI. */
  appliedHints: string[];
}

/** Indian numeric shorthand. "k" = thousand, "lakh"/"lac" = 100k, "crore" = 10M. */
const MULTIPLIERS: { pattern: RegExp; factor: number }[] = [
  { pattern: /^(crore|cr)$/i, factor: 10_000_000 },
  { pattern: /^(lakh|lakhs|lac|lacs)$/i, factor: 100_000 },
  { pattern: /^k$/i, factor: 1_000 },
];

/**
 * Parses an amount with optional currency symbol, separators, and Indian
 * shorthand. Returns null rather than a wrong number — a misparsed price
 * filter silently hides products the user asked for.
 */
export function parseAmount(raw: string): number | null {
  // No trailing \b after the optional dot: in "Rs. 25000" the dot is
  // already a non-word char, so a word boundary never matches there and
  // the prefix would survive into the numeric parse.
  const cleaned = raw.trim().replace(/[₹$]/g, "").replace(/\brs\.?\s*/gi, "").trim();

  const match = cleaned.match(/^([\d,]+(?:\.\d+)?)\s*([a-z]+)?$/i);
  if (!match) return null;

  const numeric = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  const suffix = match[2];
  if (!suffix) return numeric;

  for (const { pattern, factor } of MULTIPLIERS) {
    if (pattern.test(suffix)) return Math.round(numeric * factor);
  }

  // An unrecognized suffix means we didn't understand the amount. Better to
  // ignore the constraint than to apply a wrong one.
  return null;
}

const AMOUNT = String.raw`(?:₹|rs\.?\s*)?[\d,]+(?:\.\d+)?\s*(?:k|lakhs?|lacs?|crore|cr)?`;

interface PriceRule {
  pattern: RegExp;
  apply: (result: ParsedQuery, amounts: (number | null)[]) => void;
  hint: (amounts: (number | null)[]) => string | null;
}

// Order matters: "between X and Y" must be tried before the single-bound
// rules, or "between 20000 and 30000" matches "under"-style patterns oddly.
const PRICE_RULES: PriceRule[] = [
  {
    pattern: new RegExp(String.raw`\b(?:between|from)\s+(${AMOUNT})\s+(?:and|to|-)\s+(${AMOUNT})`, "i"),
    apply: (r, [a, b]) => {
      if (a != null && b != null) {
        r.minPrice = Math.min(a, b);
        r.maxPrice = Math.max(a, b);
      }
    },
    hint: ([a, b]) => (a != null && b != null ? `₹${Math.min(a, b)}–₹${Math.max(a, b)}` : null),
  },
  {
    pattern: new RegExp(String.raw`(${AMOUNT})\s*(?:-|–|to)\s*(${AMOUNT})`, "i"),
    apply: (r, [a, b]) => {
      if (a != null && b != null) {
        r.minPrice = Math.min(a, b);
        r.maxPrice = Math.max(a, b);
      }
    },
    hint: ([a, b]) => (a != null && b != null ? `₹${Math.min(a, b)}–₹${Math.max(a, b)}` : null),
  },
  {
    pattern: new RegExp(
      String.raw`\b(?:under|below|less\s+than|cheaper\s+than|upto|up\s+to|within|max(?:imum)?)\s+(${AMOUNT})`,
      "i",
    ),
    apply: (r, [a]) => {
      if (a != null) r.maxPrice = a;
    },
    hint: ([a]) => (a != null ? `Under ₹${a.toLocaleString("en-IN")}` : null),
  },
  {
    pattern: new RegExp(
      String.raw`\b(?:above|over|more\s+than|at\s+least|min(?:imum)?|starting\s+(?:at|from))\s+(${AMOUNT})`,
      "i",
    ),
    apply: (r, [a]) => {
      if (a != null) r.minPrice = a;
    },
    hint: ([a]) => (a != null ? `Over ₹${a.toLocaleString("en-IN")}` : null),
  },
];

/** Wording that expresses a sort preference rather than a filter. */
const SORT_RULES: { pattern: RegExp; sort: SortOption; hint: string }[] = [
  { pattern: /\b(cheapest|lowest\s+price|least\s+expensive|budget)\b/i, sort: "price_low_high", hint: "Cheapest first" },
  { pattern: /\b(most\s+expensive|highest\s+price|premium|flagship)\b/i, sort: "price_high_low", hint: "Highest price first" },
  { pattern: /\b(best|top\s+rated|highest\s+rated|good)\b/i, sort: "rating", hint: "Highest rated first" },
  { pattern: /\b(newest|latest|new\s+launch|recently\s+launched)\b/i, sort: "newest", hint: "Newest first" },
  { pattern: /\b(deals?|discounts?|offers?|sale|bargain)\b/i, sort: "discount", hint: "Biggest discount first" },
];

/** Filler words that add nothing to a full-text match. */
const STOPWORDS = new Set([
  "a", "an", "the", "for", "with", "and", "or", "of", "in", "on", "me", "my",
  "show", "find", "get", "want", "need", "looking", "please", "some", "any",
  "price", "prices", "buy", "online", "india",
]);

export function parseSearchQuery(raw: string): ParsedQuery {
  const result: ParsedQuery = {
    text: "",
    raw: raw.trim(),
    variantAxes: {},
    appliedHints: [],
  };

  if (!raw || !raw.trim()) return result;

  let working = raw;

  // --- Price constraints ---------------------------------------------
  for (const rule of PRICE_RULES) {
    const match = working.match(rule.pattern);
    if (!match) continue;

    const amounts = match.slice(1).map((group) => (group ? parseAmount(group) : null));
    rule.apply(result, amounts);

    const hint = rule.hint(amounts);
    if (hint) result.appliedHints.push(hint);

    // Remove the matched phrase so it doesn't pollute the text query.
    working = working.replace(match[0], " ");
    break; // one price constraint per query
  }

  // --- Sort intent ----------------------------------------------------
  for (const rule of SORT_RULES) {
    const match = working.match(rule.pattern);
    if (!match) continue;
    result.impliedSort = rule.sort;
    result.appliedHints.push(rule.hint);
    working = working.replace(match[0], " ");
    break;
  }

  // --- Spec/variant constraints (shared with the matching system) -----
  const extracted = extractVariant({ title: working });

  // Only axes that genuinely narrow a search are treated as filters.
  // Colour is excluded on purpose: "black phone" should rank black phones
  // higher, not hide every other colour of the same model.
  const FILTERABLE: VariantAxis[] = ["ram", "storage", "capacity", "screen", "size"];
  for (const axis of FILTERABLE) {
    const value = extracted.axes[axis];
    if (value) {
      result.variantAxes[axis] = value;
      result.appliedHints.push(`${axis.toUpperCase()} ${value}`);
    }
  }

  // Strip only the tokens for axes we actually filtered on.
  const filteredAxisCount = Object.keys(result.variantAxes).length;
  if (filteredAxisCount > 0) {
    for (const token of [...extracted.tokens].sort((a, b) => b.length - a.length)) {
      const normalizedToken = normalizeText(token);
      if (!normalizedToken) continue;
      // Only strip if the token corresponds to a filtered axis value.
      const isFiltered = Object.values(result.variantAxes).some((v) =>
        normalizeText(token).includes(normalizeText(v).replace(/[^a-z0-9]/g, "")) ||
        normalizeText(v).includes(normalizedToken),
      );
      if (isFiltered) {
        working = working.replace(new RegExp(escapeRegex(token), "gi"), " ");
      }
    }
  }

  // --- Residual text --------------------------------------------------
  const words = normalizeText(working)
    .split(" ")
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));

  result.text = words.join(" ").trim();

  return result;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the query narrowed to nothing but still expressed filters. */
export function isFilterOnlyQuery(parsed: ParsedQuery): boolean {
  return (
    parsed.text.length === 0 &&
    (parsed.minPrice != null || parsed.maxPrice != null || Object.keys(parsed.variantAxes).length > 0)
  );
}

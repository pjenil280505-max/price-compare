/**
 * VARIANT EXTRACTION — the safety-critical component.
 *
 * Extracts variant axes (storage, RAM, size, colour, …) from a title and
 * explicit attributes, and produces a canonical signature string.
 *
 * The "never merge 256GB with 512GB" requirement is enforced here in two
 * independent ways, so a bug in one still leaves the other standing:
 *
 *   1. STRUCTURAL — variant rows are keyed by signature. Two items with
 *      different signatures cannot resolve to the same variant row, no
 *      matter how similar their titles are or how confident the matcher is.
 *   2. EXPLICIT — hasVariantConflict() hard-blocks a merge whenever two
 *      items specify DIFFERENT values on the SAME axis. This is checked
 *      even for GTIN matches, because a feed with a wrong barcode should
 *      produce a review item, not a silently wrong merge.
 *
 * Deliberate asymmetry: a MISSING axis is not a conflict (one feed may
 * simply not mention storage), but it does reduce confidence, so such
 * pairs go to review rather than auto-merging.
 */

export type VariantAxis =
  | "storage"
  | "ram"
  | "color"
  | "size"
  | "capacity"
  | "length"
  | "screen"
  | "count";

export interface ExtractedVariant {
  /** Canonical axis -> canonical value. */
  axes: Partial<Record<VariantAxis, string>>;
  /** Raw substrings consumed, so normalize.ts can strip them from the product key. */
  tokens: string[];
}

/** Axes where a mismatch means "definitely a different physical item". */
const HARD_AXES: readonly VariantAxis[] = ["storage", "ram", "capacity", "length", "screen", "count", "size"];

/**
 * Colour is intentionally NOT a hard axis for *product* identity — "Black"
 * and "Blue" are the same product, different variants. It still separates
 * variant rows (it's part of the signature), but it doesn't block two items
 * from attaching to the same product.
 */
const SOFT_AXES: readonly VariantAxis[] = ["color"];

// ---------------------------------------------------------------------
// Unit canonicalization
// ---------------------------------------------------------------------

/** Normalizes any digital-size expression to whole megabytes for comparison. */
function toMegabytes(value: number, unit: string): number | null {
  switch (unit.toLowerCase()) {
    case "kb":
      return value / 1024;
    case "mb":
      return value;
    case "gb":
      return value * 1024;
    case "tb":
      return value * 1024 * 1024;
    default:
      return null;
  }
}

/** Renders megabytes back to the largest clean unit: 262144 -> "256GB". */
function formatDigitalSize(mb: number): string {
  if (mb >= 1024 * 1024 && mb % (1024 * 1024) === 0) return `${mb / (1024 * 1024)}TB`;
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024}GB`;
  if (mb >= 1) return `${Math.round(mb)}MB`;
  return `${Math.round(mb * 1024)}KB`;
}

/**
 * Base colours are the actual colour; modifiers are marketing prefixes that
 * qualify one ("Midnight Black", "Titanium Gray"). Matching must prefer the
 * base — otherwise "Midnight Black" and "Black" become different variants,
 * fragmenting one product across two rows.
 */
const BASE_COLORS = [
  "black", "white", "silver", "gray", "grey", "gold", "blue", "navy",
  "green", "red", "pink", "purple", "violet", "yellow", "orange", "brown",
  "beige", "cream", "maroon", "teal", "turquoise", "bronze", "copper", "ivory",
  "olive", "mint", "lavender",
];

/** Only used when no base colour appears anywhere in the title. */
const MODIFIER_COLORS = [
  "rose gold", "midnight", "starlight", "graphite", "charcoal", "titanium",
];

const COLOR_WORDS = [...BASE_COLORS, ...MODIFIER_COLORS];

const SIZE_WORDS: Record<string, string> = {
  xxs: "XXS", "2xs": "XXS",
  xs: "XS", "extra small": "XS",
  s: "S", small: "S",
  m: "M", medium: "M",
  l: "L", large: "L",
  xl: "XL", "extra large": "XL",
  xxl: "XXL", "2xl": "XXL",
  xxxl: "XXXL", "3xl": "XXXL",
};

// ---------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------

export function extractVariant(params: {
  title: string;
  attributes?: Record<string, string>;
}): ExtractedVariant {
  const axes: Partial<Record<VariantAxis, string>> = {};
  const tokens: string[] = [];
  const title = params.title;
  const lower = title.toLowerCase();

  // --- Explicit attributes win over anything parsed from the title -----
  // A feed that states color/storage structurally is more reliable than
  // regexing a marketing string.
  const attrs = params.attributes ?? {};
  for (const [rawKey, rawValue] of Object.entries(attrs)) {
    if (!rawValue) continue;
    const key = rawKey.toLowerCase().replace(/[^a-z]/g, "");
    const value = String(rawValue).trim();
    if (!value) continue;

    if (key.includes("storage") || key.includes("internalmemory") || key.includes("capacity")) {
      const parsed = parseDigitalSize(value);
      if (parsed) { axes.storage = parsed; tokens.push(value); }
    } else if (key.includes("ram")) {
      const parsed = parseDigitalSize(value);
      if (parsed) { axes.ram = parsed; tokens.push(value); }
    } else if (key.includes("colour") || key.includes("color")) {
      axes.color = canonicalColor(value) ?? value.toLowerCase();
      tokens.push(value);
    } else if (key === "size" || key.includes("shoesize") || key.includes("clothingsize")) {
      const canonical = canonicalSize(value);
      if (canonical) { axes.size = canonical; tokens.push(value); }
    } else if (key.includes("displaysize") || key.includes("screensize")) {
      const inches = value.match(/([\d.]+)/);
      if (inches) { axes.screen = `${Number(inches[1])}IN`; tokens.push(value); }
    }
  }

  // --- RAM before storage -------------------------------------------
  // Order matters: "8GB RAM 128GB Storage" must not assign 8GB to storage.
  // The RAM pattern is anchored to the RAM keyword on either side.
  let ramMatchText: string | null = null;
  if (!axes.ram) {
    const ramMatch =
      lower.match(/(\d+(?:\.\d+)?)\s*(kb|mb|gb|tb)\s*(?:of\s*)?ram\b/i) ??
      lower.match(/\bram\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(kb|mb|gb|tb)/i);
    if (ramMatch) {
      const size = parseDigitalSize(`${ramMatch[1]}${ramMatch[2]}`);
      if (size) { axes.ram = size; tokens.push(ramMatch[0]); ramMatchText = ramMatch[0]; }
    }
  }

  // --- Storage -------------------------------------------------------
  if (!axes.storage) {
    // Search a residual string with the RAM phrase removed. The earlier
    // approach — matching on the full string then checking for overlap —
    // found the RAM figure first, rejected it, and then gave up, silently
    // dropping storage entirely from "12GB RAM 512GB".
    const residual = ramMatchText ? lower.replace(ramMatchText.toLowerCase(), " ") : lower;

    const storageMatch =
      residual.match(/(\d+(?:\.\d+)?)\s*(gb|tb|mb)\s*(?:internal\s*)?(?:storage|rom|ssd|hdd|emmc|memory)\b/i) ??
      residual.match(/\b(\d+(?:\.\d+)?)\s*(gb|tb)\b/i);

    if (storageMatch) {
      const size = parseDigitalSize(`${storageMatch[1]}${storageMatch[2]}`);
      if (size) { axes.storage = size; tokens.push(storageMatch[0]); }
    }
  }

  // --- Volume / weight capacity (consumables, appliances) ------------
  if (!axes.capacity) {
    const capMatch = lower.match(/\b(\d+(?:\.\d+)?)\s*(ml|l|litre|liter|g|kg|gm|gram)\b/i);
    if (capMatch) {
      const canonical = canonicalCapacity(Number(capMatch[1]), capMatch[2]);
      if (canonical) { axes.capacity = canonical; tokens.push(capMatch[0]); }
    }
  }

  // --- Screen size ---------------------------------------------------
  if (!axes.screen) {
    const screenMatch = lower.match(/\b(\d+(?:\.\d+)?)\s*(?:inch|inches|"|”)\b/i);
    if (screenMatch) { axes.screen = `${Number(screenMatch[1])}IN`; tokens.push(screenMatch[0]); }
  }

  // --- Multi-pack count ----------------------------------------------
  if (!axes.count) {
    const packMatch = lower.match(/\b(?:pack\s*of\s*(\d+)|(\d+)\s*(?:pcs|pieces|pack)\b)/i);
    const n = packMatch?.[1] ?? packMatch?.[2];
    if (n && Number(n) > 1) { axes.count = `x${Number(n)}`; tokens.push(packMatch![0]); }
  }

  // --- Colour --------------------------------------------------------
  if (!axes.color) {
    // Base colours first (longest within the group, so "rose gold" style
    // multi-word base entries still work), modifiers only as a fallback.
    const scan = (list: string[]): boolean => {
      for (const color of [...list].sort((a, b) => b.length - a.length)) {
        const pattern = new RegExp(`\\b${color.replace(/\s/g, "\\s+")}\\b`, "i");
        const m = lower.match(pattern);
        if (m) {
          axes.color = canonicalColor(color)!;
          tokens.push(m[0]);
          return true;
        }
      }
      return false;
    };
    if (!scan(BASE_COLORS)) scan(MODIFIER_COLORS);
  }

  // --- Apparel size --------------------------------------------------
  if (!axes.size) {
    const sizeMatch = lower.match(/\bsize\s*[:\-]?\s*(xxxl|xxl|xl|xs|xxs|[sml])\b/i);
    if (sizeMatch) {
      const canonical = canonicalSize(sizeMatch[1]);
      if (canonical) { axes.size = canonical; tokens.push(sizeMatch[0]); }
    }
  }

  return { axes, tokens };
}

function parseDigitalSize(value: string): string | undefined {
  const m = value.match(/(\d+(?:\.\d+)?)\s*(kb|mb|gb|tb)/i);
  if (!m) return undefined;
  const mb = toMegabytes(Number(m[1]), m[2]);
  if (mb == null || mb <= 0) return undefined;
  return formatDigitalSize(mb);
}

function canonicalColor(value: string): string | undefined {
  const lower = value.toLowerCase().trim();
  if (lower === "grey") return "gray";
  const sorted = [...COLOR_WORDS].sort((a, b) => b.length - a.length);
  for (const color of sorted) {
    if (lower.includes(color)) return color === "grey" ? "gray" : color;
  }
  return undefined;
}

function canonicalSize(value: string): string | undefined {
  const lower = value.toLowerCase().trim();
  if (SIZE_WORDS[lower]) return SIZE_WORDS[lower];
  // Numeric sizes (shoes, waist) stay numeric.
  const numeric = lower.match(/^(\d+(?:\.\d+)?)$/);
  if (numeric) return numeric[1];
  return undefined;
}

/** Normalizes volume to ml and weight to g so 1L === 1000ml. */
function canonicalCapacity(value: number, unit: string): string | undefined {
  const u = unit.toLowerCase();
  if (u === "ml") return `${Math.round(value)}ML`;
  if (u === "l" || u === "litre" || u === "liter") return `${Math.round(value * 1000)}ML`;
  if (u === "g" || u === "gm" || u === "gram") return `${Math.round(value)}G`;
  if (u === "kg") return `${Math.round(value * 1000)}G`;
  return undefined;
}

/**
 * Deterministic signature: axes sorted alphabetically, joined.
 * "color=black|storage=256GB". Empty string when no axes were found,
 * which downstream treats as the single "Standard" variant.
 */
export function buildVariantSignature(axes: Partial<Record<VariantAxis, string>>): string {
  const entries = Object.entries(axes)
    .filter(([, v]) => v != null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${v}`).join("|");
}

/** Human-readable label for the variant row, e.g. "256GB · Black". */
export function buildVariantLabel(axes: Partial<Record<VariantAxis, string>>): string {
  const order: VariantAxis[] = ["storage", "ram", "capacity", "screen", "size", "length", "count", "color"];
  const parts = order
    .map((axis) => axes[axis])
    // typeof, not Boolean(): the latter does not narrow the type.
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map((v) => (v.length <= 4 ? v : v.charAt(0).toUpperCase() + v.slice(1)));
  return parts.join(" · ") || "Standard";
}

export interface VariantConflict {
  axis: VariantAxis;
  left: string;
  right: string;
  severity: "hard" | "soft";
}

/**
 * Returns every axis where both sides specify a value AND the values
 * differ. A missing value on either side is NOT a conflict.
 *
 * Any "hard" conflict must block an automatic merge unconditionally —
 * including when GTINs match, since that indicates bad source data that a
 * human should look at rather than a match to trust.
 */
export function findVariantConflicts(
  left: Partial<Record<VariantAxis, string>>,
  right: Partial<Record<VariantAxis, string>>,
): VariantConflict[] {
  const conflicts: VariantConflict[] = [];
  const axes = new Set([...Object.keys(left), ...Object.keys(right)] as VariantAxis[]);

  for (const axis of axes) {
    const a = left[axis];
    const b = right[axis];
    if (!a || !b) continue;
    if (a.toLowerCase() === b.toLowerCase()) continue;

    conflicts.push({
      axis,
      left: a,
      right: b,
      severity: HARD_AXES.includes(axis) ? "hard" : SOFT_AXES.includes(axis) ? "soft" : "hard",
    });
  }

  return conflicts;
}

export function hasHardVariantConflict(
  left: Partial<Record<VariantAxis, string>>,
  right: Partial<Record<VariantAxis, string>>,
): boolean {
  return findVariantConflicts(left, right).some((c) => c.severity === "hard");
}

/** Axes present on one side but absent on the other — lowers confidence. */
export function countAxisGaps(
  left: Partial<Record<VariantAxis, string>>,
  right: Partial<Record<VariantAxis, string>>,
): number {
  const axes = new Set([...Object.keys(left), ...Object.keys(right)] as VariantAxis[]);
  let gaps = 0;
  for (const axis of axes) {
    if (Boolean(left[axis]) !== Boolean(right[axis])) gaps += 1;
  }
  return gaps;
}

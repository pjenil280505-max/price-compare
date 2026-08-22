/**
 * Accessibility tests.
 *
 * These parse the actual component source and look for the violations that
 * genuinely occur in this codebase: images without alt text, icon-only
 * buttons with no accessible name, form inputs with no label, and buttons
 * missing an explicit type.
 *
 * They cannot replace a screen-reader pass or an axe run in a real browser
 * — those need a DOM. What they do catch is regressions, which is what a
 * test suite is actually for.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail, null, 1) : ""); }
}

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const FILES = [...collect("components"), ...collect("app")];
const SOURCES = new Map(FILES.map((f) => [f, readFileSync(f, "utf8")]));

/**
 * Extracts each JSX opening tag for a given element name.
 *
 * Cannot be a simple `[^>]*` regex: JSX attributes routinely contain `>`
 * inside expressions (arrow functions, comparisons), which terminates such
 * a match early and silently truncates the tag — making attributes at the
 * end, like aria-label, invisible to these checks. This walks brace depth
 * and quote state to find the real tag boundary.
 */
function tagsOf(source: string, tag: string): string[] {
  const out: string[] = [];
  const opener = new RegExp(`<${tag}(?=[\\s/>])`, "g");
  let match: RegExpExecArray | null;

  while ((match = opener.exec(source)) !== null) {
    let i = match.index + match[0].length;
    let depth = 0;
    let quote: string | null = null;

    while (i < source.length) {
      const ch = source[i];

      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
      } else if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
      } else if (ch === ">" && depth === 0) {
        out.push(source.slice(match.index, i + 1));
        break;
      }
      i += 1;
    }
  }
  return out;
}

console.log("Images have alt text");
{
  const offenders: string[] = [];
  for (const [file, source] of SOURCES) {
    for (const tag of [...tagsOf(source, "Image"), ...tagsOf(source, "img")]) {
      // alt="" is valid and correct for decorative images.
      if (!/\salt\s*=/.test(tag)) offenders.push(`${file}: ${tag.slice(0, 90)}`);
    }
  }
  check("every Image/img has an alt attribute", offenders.length === 0, offenders);
}

console.log("Icon-only controls have accessible names");
{
  const offenders: string[] = [];
  for (const [file, source] of SOURCES) {
    for (const tag of tagsOf(source, "button")) {
      const hasName = /aria-label\s*=|aria-labelledby\s*=/.test(tag);
      // Find the button's inner content to see whether it has visible text.
      const index = source.indexOf(tag);
      const body = source.slice(index + tag.length, index + tag.length + 400);
      const closing = body.indexOf("</button>");
      const inner = closing === -1 ? body : body.slice(0, closing);

      // Text content = anything that isn't a JSX tag, expression or whitespace.
      const visibleText = inner
        .replace(/<[^>]*>/g, "")
        .replace(/\{[^}]*\}/g, "")
        .trim();

      if (!hasName && visibleText.length === 0 && !tag.endsWith("/>")) {
        offenders.push(`${file}: ${tag.slice(0, 90)}`);
      }
    }
  }
  check("no icon-only button without aria-label", offenders.length === 0, offenders);
}

console.log("Buttons declare an explicit type");
{
  // A <button> inside a form defaults to type="submit", which silently
  // submits when the author meant an ordinary click handler.
  const offenders: string[] = [];
  for (const [file, source] of SOURCES) {
    for (const tag of tagsOf(source, "button")) {
      if (!/\stype\s*=/.test(tag)) offenders.push(`${file}: ${tag.slice(0, 80)}`);
    }
  }
  check("every <button> has an explicit type", offenders.length === 0, offenders);
}

console.log("Decorative icons are hidden from screen readers");
{
  const offenders: string[] = [];
  const ICONS = [
    "Search", "X", "Menu", "Heart", "User", "Sun", "Moon", "Star", "Check",
    "AlertCircle", "AlertTriangle", "ArrowDown", "ArrowUp", "ChevronDown",
    "Clock", "Bell", "Send", "Sparkles", "ExternalLink", "Trash2", "Play",
    "CheckCircle2", "XCircle", "Info", "ShieldCheck", "Construction",
  ];
  for (const [file, source] of SOURCES) {
    for (const icon of ICONS) {
      for (const tag of tagsOf(source, icon)) {
        // An icon next to visible text is decorative and must be hidden,
        // or a screen reader announces a meaningless element name.
        if (!/aria-hidden/.test(tag) && !/aria-label/.test(tag)) {
          offenders.push(`${file}: ${tag.slice(0, 70)}`);
        }
      }
    }
  }
  check("decorative icons carry aria-hidden", offenders.length === 0, offenders.slice(0, 12));
}

console.log("Form inputs are labelled");
{
  const offenders: string[] = [];
  for (const [file, source] of SOURCES) {
    // The shared Input component renders its own <label>; raw <input>
    // elements elsewhere must supply one.
    if (file.endsWith("components/ui/Input.tsx")) continue;
    for (const tag of tagsOf(source, "input")) {
      const isCheckboxOrRadio = /type\s*=\s*"(checkbox|radio)"/.test(tag);
      const labelled = /aria-label\s*=|aria-labelledby\s*=|id\s*=/.test(tag);
      // Checkboxes here are wrapped in <label>, which is valid.
      const wrappedInLabel = source.slice(Math.max(0, source.indexOf(tag) - 300), source.indexOf(tag)).includes("<label");
      if (!labelled && !(isCheckboxOrRadio && wrappedInLabel)) {
        offenders.push(`${file}: ${tag.slice(0, 90)}`);
      }
    }
  }
  check("raw inputs are labelled", offenders.length === 0, offenders);
}

console.log("Toggle switches expose state");
{
  const offenders: string[] = [];
  for (const [file, source] of SOURCES) {
    for (const tag of tagsOf(source, "button")) {
      if (!/role\s*=\s*"switch"/.test(tag)) continue;
      // A switch with no aria-checked is announced as a plain button, so
      // its on/off state is invisible to a screen reader.
      if (!/aria-checked/.test(tag)) offenders.push(`${file}: ${tag.slice(0, 80)}`);
    }
  }
  check("role=switch always has aria-checked", offenders.length === 0, offenders);
}

console.log("Tables are navigable as data");
{
  const offenders: string[] = [];
  for (const [file, source] of SOURCES) {
    if (!source.includes("<table")) continue;
    const headers = tagsOf(source, "th");
    const unscoped = headers.filter((h) => !/scope\s*=/.test(h));
    if (unscoped.length > 0) offenders.push(`${file}: ${unscoped.length} <th> without scope`);
    if (!source.includes("<caption")) offenders.push(`${file}: table without <caption>`);
  }
  check("tables have scoped headers and a caption", offenders.length === 0, offenders);
}

console.log("Reduced motion is respected everywhere animation happens");
{
  const offenders: string[] = [];
  for (const [file, source] of SOURCES) {
    const animates =
      /whileHover|whileTap|whileInView|animate=\{|variants=\{/.test(source) ||
      /repeat:\s*Infinity/.test(source);
    if (!animates) continue;

    const respects =
      source.includes("useReducedMotionSafe") ||
      source.includes("withMotionPreference") ||
      source.includes("reduced");

    if (!respects) offenders.push(file);
  }
  check("animated components check reduced-motion", offenders.length === 0, offenders);
}
{
  // Global CSS safety net, in case a component ever forgets.
  const css = readFileSync("styles/globals.css", "utf8");
  check("global prefers-reduced-motion rule exists", css.includes("@media (prefers-reduced-motion: reduce)"));
  check("global rule caps animation duration", /animation-duration:\s*0\.01ms\s*!important/.test(css));
  check("global rule caps iteration count", /animation-iteration-count:\s*1\s*!important/.test(css));
}

console.log("Keyboard support");
{
  const layout = readFileSync("app/layout.tsx", "utf8");
  check("skip-to-content link exists", layout.includes("Skip to content"));
  check("skip link targets main", layout.includes("#main-content"));
  const marketing = readFileSync("app/(marketing)/layout.tsx", "utf8");
  check("main landmark has the target id", marketing.includes('id="main-content"'));

  const css = readFileSync("styles/globals.css", "utf8");
  check("visible focus ring defined", css.includes(":focus-visible"));
  // outline:none without a replacement indicator makes the site
  // unusable by keyboard.
  const strippedFocus = [...SOURCES].filter(
    ([, s]) => /focus:outline-none/.test(s) && !/focus-visible:ring|focus-visible:outline/.test(s),
  );
  check("focus outline never removed without a replacement", strippedFocus.length === 0,
    strippedFocus.map(([f]) => f));
}

console.log("Language and viewport");
{
  const layout = readFileSync("app/layout.tsx", "utf8");
  check("html has a lang attribute", /lang="[a-z]{2}(-[A-Z]{2})?"/.test(layout));
  // Capping zoom breaks pinch-to-zoom for low-vision users.
  check("zoom is not capped", !/maximumScale:\s*1/.test(layout));
  check("userScalable not disabled", !/userScalable:\s*false/.test(layout));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

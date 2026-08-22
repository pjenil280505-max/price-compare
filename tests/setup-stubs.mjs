/**
 * Creates minimal offline stubs in node_modules for packages the test
 * harness needs but that can't be installed without network access.
 *
 * These are NOT substitutes for the real dependencies — they implement only
 * the surface the code under test touches. `npm install` overwrites them
 * with the genuine packages. node_modules is gitignored, so nothing here
 * is ever committed or shipped.
 *
 * Run: node tests/setup-stubs.mjs
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function stub(name, indexSource, extraFiles = null, exportsMap = null) {
  const dir = path.join(ROOT, "node_modules", name);
  // Never clobber a real installed dependency.
  if (existsSync(path.join(dir, "package.json"))) {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    if (pkg.version !== "0.0.0-teststub") return;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name,
        version: "0.0.0-teststub",
        type: "module",
        main: "index.js",
        exports: exportsMap ?? { ".": "./index.js" },
      },
      null,
      2,
    ),
  );
  writeFileSync(path.join(dir, "index.js"), indexSource);

  for (const [fileName, contents] of Object.entries(extraFiles ?? {})) {
    writeFileSync(path.join(dir, fileName), contents);
  }
}

const SERVER_ONLY_THROW = [
  'throw new Error(',
  '  "This module cannot be imported from a Client Component module. " +',
  '    "It should only be used from a Server Component."',
  ');',
].join("\n");

stub(
  "server-only",
  // Mirrors the REAL package exactly: importing it throws unless the
  // consumer selects the "react-server" export condition. A no-op stub
  // here previously hid a whole class of failure that only appeared once
  // real dependencies were installed.
  SERVER_ONLY_THROW,
  { "empty.js": "export {};" },
  // The published exports map. The test runner selects "react-server"
  // (see scripts/test-all.mjs), which is the package's own intended
  // escape hatch — the same one Next.js and React's bundlers use.
  { ".": { "react-server": "./empty.js", default: "./index.js" } },
);

stub(
  "clsx",
  `export function clsx(...args) {
  const out = [];
  const walk = (v) => {
    if (!v) return;
    if (typeof v === "string" || typeof v === "number") { out.push(String(v)); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === "object") { for (const [k, on] of Object.entries(v)) if (on) out.push(k); }
  };
  args.forEach(walk);
  return out.join(" ");
}
export default clsx;
`,
);

stub("tailwind-merge", `export function twMerge(...a) { return a.filter(Boolean).join(" "); }\nexport default twMerge;\n`);

// zod stub with REAL validation semantics, so schema tests are meaningful
// rather than always-passing.
stub(
  "zod",
  `class ZodError extends Error {
  constructor(issues) { super("Validation failed"); this.name = "ZodError"; this.issues = issues; }
}
const ok = (data) => ({ success: true, data });
const err = (issues) => ({ success: false, error: new ZodError(issues) });

class Schema {
  constructor(fn) { this._fn = fn; }
  _run(v, p) { return this._fn(v, p); }
  safeParse(v) { const r = this._run(v, []); return r.ok ? ok(r.value) : err(r.issues); }
  parse(v) { const r = this.safeParse(v); if (!r.success) throw r.error; return r.data; }
  optional() { return new Schema((v, p) => (v === undefined ? { ok: true, value: undefined } : this._run(v, p))); }
  nullable() { return new Schema((v, p) => (v === null ? { ok: true, value: null } : this._run(v, p))); }
  default(d) { return new Schema((v, p) => (v === undefined ? { ok: true, value: typeof d === "function" ? d() : d } : this._run(v, p))); }
  min(n, m) { return new Schema((v, p) => { const r = this._run(v, p); if (!r.ok) return r;
    const len = typeof r.value === "string" || Array.isArray(r.value) ? r.value.length : r.value;
    return len >= n ? r : { ok: false, issues: [{ path: p, message: m || \`too small (min \${n})\` }] }; }); }
  max(n, m) { return new Schema((v, p) => { const r = this._run(v, p); if (!r.ok) return r;
    const len = typeof r.value === "string" || Array.isArray(r.value) ? r.value.length : r.value;
    return len <= n ? r : { ok: false, issues: [{ path: p, message: m || \`too big (max \${n})\` }] }; }); }
  nonnegative() { return new Schema((v, p) => { const r = this._run(v, p); if (!r.ok) return r;
    return r.value >= 0 ? r : { ok: false, issues: [{ path: p, message: "must be >= 0" }] }; }); }
  positive() { return new Schema((v, p) => { const r = this._run(v, p); if (!r.ok) return r;
    return r.value > 0 ? r : { ok: false, issues: [{ path: p, message: "must be > 0" }] }; }); }
  finite() { return new Schema((v, p) => { const r = this._run(v, p); if (!r.ok) return r;
    return Number.isFinite(r.value) ? r : { ok: false, issues: [{ path: p, message: "must be finite" }] }; }); }
  int() { return new Schema((v, p) => { const r = this._run(v, p); if (!r.ok) return r;
    return Number.isInteger(r.value) ? r : { ok: false, issues: [{ path: p, message: "must be int" }] }; }); }
  url() { return new Schema((v, p) => { const r = this._run(v, p); if (!r.ok) return r;
    try { new URL(r.value); return r; } catch { return { ok: false, issues: [{ path: p, message: "invalid url" }] }; } }); }
  uuid() { return new Schema((v, p) => { const r = this._run(v, p); if (!r.ok) return r;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.value)
      ? r : { ok: false, issues: [{ path: p, message: "invalid uuid" }] }; }); }
  trim() { return new Schema((v, p) => { const r = this._run(v, p); if (!r.ok) return r;
    return { ok: true, value: typeof r.value === "string" ? r.value.trim() : r.value }; }); }
  toLowerCase() { return new Schema((v, p) => { const r = this._run(v, p); if (!r.ok) return r;
    return { ok: true, value: typeof r.value === "string" ? r.value.toLowerCase() : r.value }; }); }
  email() { return new Schema((v, p) => { const r = this._run(v, p); if (!r.ok) return r;
    return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$/.test(r.value)
      ? r : { ok: false, issues: [{ path: p, message: "invalid email" }] }; }); }
  transform(fn) { return new Schema((v, p) => { const r = this._run(v, p); if (!r.ok) return r;
    return { ok: true, value: fn(r.value) }; }); }
  refine(fn, msg) { return new Schema((v, p) => { const r = this._run(v, p); if (!r.ok) return r;
    return fn(r.value) ? r : { ok: false, issues: [{ path: p, message: msg || "refine failed" }] }; }); }
  or(other) { return new Schema((v, p) => { const r = this._run(v, p); return r.ok ? r : other._run(v, p); }); }
}
const prim = (type) => new Schema((v, p) =>
  typeof v === type ? { ok: true, value: v } : { ok: false, issues: [{ path: p, message: \`expected \${type}\` }] });

export const z = {
  string: () => prim("string"),
  number: () => new Schema((v, p) => typeof v === "number" && !Number.isNaN(v)
    ? { ok: true, value: v } : { ok: false, issues: [{ path: p, message: "expected number" }] }),
  boolean: () => prim("boolean"),
  literal: (lit) => new Schema((v, p) => v === lit
    ? { ok: true, value: v } : { ok: false, issues: [{ path: p, message: \`expected \${lit}\` }] }),
  enum: (vals) => new Schema((v, p) => vals.includes(v)
    ? { ok: true, value: v } : { ok: false, issues: [{ path: p, message: "bad enum value" }] }),
  unknown: () => new Schema((v) => ({ ok: true, value: v })),
  array: (inner) => new Schema((v, p) => {
    if (!Array.isArray(v)) return { ok: false, issues: [{ path: p, message: "expected array" }] };
    const out = []; const issues = [];
    v.forEach((item, i) => { const r = inner._run(item, [...p, i]); if (r.ok) out.push(r.value); else issues.push(...r.issues); });
    return issues.length ? { ok: false, issues } : { ok: true, value: out };
  }),
  record: () => new Schema((v, p) => (v && typeof v === "object" && !Array.isArray(v))
    ? { ok: true, value: v } : { ok: false, issues: [{ path: p, message: "expected object" }] }),
  object: (shape) => new Schema((v, p) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, issues: [{ path: p, message: "expected object" }] };
    const out = {}; const issues = [];
    for (const [key, schema] of Object.entries(shape)) {
      const r = schema._run(v[key], [...p, key]);
      if (r.ok) { if (r.value !== undefined) out[key] = r.value; } else issues.push(...r.issues);
    }
    return issues.length ? { ok: false, issues } : { ok: true, value: out };
  }),
};
export { ZodError };
export default { z, ZodError };
`,
);

// next/server — only NextResponse.json is exercised by the code under test.
{
  const dir = path.join(ROOT, "node_modules", "next");
  mkdirSync(path.join(dir, "server"), { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "next",
        version: "0.0.0-teststub",
        type: "module",
        exports: { "./server": "./server/index.js" },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(dir, "server", "index.js"),
    `export class NextResponse {
  constructor(body, init) { this.body = body; this.status = init?.status ?? 200; }
  static json(data, init) { const r = new NextResponse(data, init); r.data = data; return r; }
  static redirect(url, init) { const r = new NextResponse(null, init); r.url = url; return r; }
}
export class NextRequest {}
`,
  );
}

console.log("Offline test stubs ready.");

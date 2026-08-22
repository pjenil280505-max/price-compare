/**
 * SERVER/CLIENT IMPORT BOUNDARY AUDIT
 *
 * The `server-only` package throws if it is ever pulled into a client
 * bundle. That guard is real and must keep working — but it only fires at
 * build time, on whatever chain the bundler happens to walk.
 *
 * This test walks the FULL transitive runtime import graph from every
 * "use client" entry point and fails if any of them can reach a
 * server-only module. It is the check that makes it safe for the test
 * runner to select the package's "react-server" export condition: the
 * boundary is asserted here explicitly rather than relied upon as a
 * side-effect of module loading.
 *
 * `import type` is excluded deliberately — type imports are erased at
 * build time and cannot pull a runtime module into a bundle.
 */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail, null, 1) : ""); }
}

const ROOT = process.cwd();

function collect(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(path.relative(ROOT, full));
  }
  return out;
}

function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.normalize(path.join(path.dirname(fromFile), spec));
  else return null; // bare package — outside our graph

  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx", ""]) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return path.relative(ROOT, candidate);
    }
  }
  return null;
}

const FILES = [...collect("app"), ...collect("components"), ...collect("lib"), ...collect("hooks")];

const clientEntries = new Set<string>();
const serverOnlyModules = new Set<string>();
const graph = new Map<string, string[]>();

for (const file of FILES) {
  const source = readFileSync(file, "utf8");

  // The directive must be in the first few lines to take effect.
  if (/^\s*["']use client["']/m.test(source.split("\n").slice(0, 5).join("\n"))) {
    clientEntries.add(file);
  }
  if (/import\s+["']server-only["']/.test(source)) {
    serverOnlyModules.add(file);
  }

  const deps: string[] = [];

  // Value imports only. A named import list that is entirely `type X`
  // members is erased too, so it is skipped.
  for (const m of source.matchAll(/^import\s+(?!type\s)([^;]*?)\s*from\s*["']([^"']+)["']/gm)) {
    const clause = m[1].trim();
    if (/^\{\s*(?:type\s+\w+\s*,?\s*)+\}$/.test(clause)) continue;
    const resolved = resolveSpecifier(m[2], file);
    if (resolved) deps.push(resolved);
  }
  // Side-effect imports: import "./x"
  for (const m of source.matchAll(/^import\s+["']([^"']+)["']/gm)) {
    const resolved = resolveSpecifier(m[1], file);
    if (resolved) deps.push(resolved);
  }

  graph.set(file, deps);
}

console.log("Graph");
check("files were scanned", FILES.length > 100, FILES.length);
check("client entry points found", clientEntries.size > 0, clientEntries.size);
check("server-only modules found", serverOnlyModules.size > 0, serverOnlyModules.size);

console.log("No client component can reach a server-only module");
{
  const violations: string[][] = [];

  for (const entry of clientEntries) {
    const path_: Map<string, string[]> = new Map([[entry, [entry]]]);
    const queue = [entry];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dep of graph.get(current) ?? []) {
        if (path_.has(dep)) continue;
        path_.set(dep, [...path_.get(current)!, dep]);
        if (serverOnlyModules.has(dep)) {
          violations.push(path_.get(dep)!);
          continue;
        }
        queue.push(dep);
      }
    }
  }

  check(
    "no client -> server-only import chain exists",
    violations.length === 0,
    violations.map((chain) => chain.join(" -> ")),
  );
}

console.log("Service-role client is never reachable from the client bundle");
{
  const adminModule = "lib/supabase/admin.ts";
  const violations: string[][] = [];

  for (const entry of clientEntries) {
    const path_: Map<string, string[]> = new Map([[entry, [entry]]]);
    const queue = [entry];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dep of graph.get(current) ?? []) {
        if (path_.has(dep)) continue;
        path_.set(dep, [...path_.get(current)!, dep]);
        if (dep === adminModule) {
          violations.push(path_.get(dep)!);
          continue;
        }
        queue.push(dep);
      }
    }
  }

  check(
    "no client -> service-role client chain exists",
    violations.length === 0,
    violations.map((chain) => chain.join(" -> ")),
  );
}

console.log("Server-only guards are on the modules that need them");
{
  // Any module reading a non-public environment variable must be
  // server-only, or its value could be inlined into a client bundle.
  const missing: string[] = [];

  for (const file of FILES) {
    if (serverOnlyModules.has(file)) continue;
    if (clientEntries.has(file)) continue;
    // Route handlers and pages are server contexts by construction.
    if (/^app\/.*\/(route|page|layout)\.tsx?$/.test(file)) continue;

    const source = readFileSync(file, "utf8");
    const secretReads = [...source.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)]
      .map((m) => m[1])
      .filter((name) => !name.startsWith("NEXT_PUBLIC_") && name !== "NODE_ENV" && name !== "VERCEL_URL");

    if (secretReads.length > 0) missing.push(`${file}: ${[...new Set(secretReads)].join(", ")}`);
  }

  check("every module reading a private env var is server-only", missing.length === 0, missing);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

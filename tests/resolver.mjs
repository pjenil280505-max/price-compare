/**
 * Node ESM resolver hook used ONLY by the offline test harness.
 *
 * The app's source uses bundler-style imports ("@/lib/utils", "./types")
 * with no file extension, which Next.js/webpack resolve natively but raw
 * Node ESM does not. This hook adds the same resolution so tests can
 * exercise the real source files rather than copies.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];

/**
 * Specifiers replaced with a local test double.
 *
 * `next/server` cannot load in a plain Node process — it expects the full
 * framework runtime. The stub lives in tests/stubs/ rather than being
 * written into node_modules, because mutating a real dependency is what
 * previously broke `next build`.
 */
const TEST_DOUBLES = new Map([["next/server", "tests/stubs/next-server.mjs"]]);

export async function resolve(specifier, context, nextResolve) {
  const double = TEST_DOUBLES.get(specifier);
  if (double) {
    return { url: pathToFileURL(path.join(ROOT, double)).href, shortCircuit: true };
  }

  let target = null;

  if (specifier.startsWith("@/")) {
    target = path.join(ROOT, specifier.slice(2));
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : ROOT;
    target = path.resolve(path.dirname(parentPath), specifier);
  }

  if (target) {
    if (existsSync(target) && !existsSync(path.join(target, "package.json"))) {
      const stat = await import("node:fs").then((fs) => fs.statSync(target));
      if (stat.isFile()) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    for (const ext of EXTENSIONS) {
      const candidate = `${target}${ext}`;
      if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
    for (const ext of EXTENSIONS) {
      const candidate = path.join(target, `index${ext}`);
      if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}

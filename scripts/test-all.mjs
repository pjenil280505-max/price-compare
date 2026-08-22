#!/usr/bin/env node
/**
 * Test runner.
 *
 * Runs every suite in tests/, aggregates the counts, and exits non-zero if
 * anything failed. Output is deliberately compact: the primary place these
 * results get read is the GitHub Actions log on a phone.
 *
 * Usage:
 *   node scripts/test-all.mjs            run everything
 *   node scripts/test-all.mjs a11y seo   run matching suites only
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filters = process.argv.slice(2);

// Stubs must exist before any suite imports application code.
const setup = spawnSync("node", ["tests/setup-stubs.mjs"], { cwd: ROOT, encoding: "utf8" });
if (setup.status !== 0) {
  console.error("Could not prepare test stubs:\n", setup.stderr);
  process.exit(1);
}

const suites = readdirSync(path.join(ROOT, "tests"))
  .filter((f) => f.endsWith(".test.ts"))
  .filter((f) => filters.length === 0 || filters.some((needle) => f.includes(needle)))
  .sort();

if (suites.length === 0) {
  console.error(`No suites matched: ${filters.join(", ")}`);
  process.exit(1);
}

let totalPassed = 0;
let totalFailed = 0;
const failedSuites = [];
const startedAt = Date.now();

console.log(`Running ${suites.length} suite${suites.length === 1 ? "" : "s"}\n`);

for (const suite of suites) {
  const result = spawnSync(
    "node",
    [
      "--experimental-strip-types",
      // `server-only` deliberately throws unless it is loaded inside a
      // React Server Component. Its package exports map publishes a
      // "react-server" condition that resolves to an empty module — the
      // same mechanism Next.js and React's own bundlers use. Selecting
      // that condition is the package's intended escape hatch, not a
      // bypass: the real module still ships and still throws in a client
      // bundle. tests/a11y + tests/user-security assert the boundary
      // independently, and a full transitive import audit confirms no
      // client component reaches a server-only module.
      "--conditions=react-server",
      "--import",
      "./tests/register.mjs",
      `tests/${suite}`,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const summary = output.match(/(\d+) passed, (\d+) failed/);

  const passed = summary ? Number(summary[1]) : 0;
  const failed = summary ? Number(summary[2]) : 0;

  totalPassed += passed;
  totalFailed += failed;

  const name = suite.replace(".test.ts", "");

  if (result.status === 0 && failed === 0 && summary) {
    console.log(`  PASS  ${name.padEnd(22)} ${passed} assertions`);
  } else {
    failedSuites.push(name);
    // A suite that crashed before printing a summary is a failure even
    // though it reported zero failed assertions — surface it as such
    // rather than letting it silently contribute nothing.
    console.log(`  FAIL  ${name.padEnd(22)} ${summary ? `${failed} failed` : "crashed before reporting"}`);
    const detail = output
      .split("\n")
      .filter((line) => line.includes("FAIL:") || line.includes("Error"))
      .slice(0, 8);
    for (const line of detail) console.log(`        ${line.trim()}`);
    if (!summary) {
      for (const line of output.split("\n").slice(-6)) {
        if (line.trim()) console.log(`        ${line.trim()}`);
      }
    }
  }
}

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

console.log(
  `\n${totalPassed} assertions passed, ${totalFailed} failed across ` +
    `${suites.length} suites in ${seconds}s`,
);

if (failedSuites.length > 0) {
  console.log(`\nFailing suites: ${failedSuites.join(", ")}`);
  process.exit(1);
}

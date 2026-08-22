# Testing

Designed for phone-only development: everything runs in CI and the results
are readable from the GitHub mobile app.

## Running

```bash
npm test                 # every suite, ~3 seconds
npm test seo a11y        # only matching suites
npm run typecheck:server # type-check the server/lib layer
npm run test:e2e         # Playwright (needs a running app)
```

`npm test` needs **no dependencies installed** — it runs against offline
stubs created by `tests/setup-stubs.mjs`, so it works on a fresh checkout
and in CI without a registry.

## What is actually executed vs. what is not

This distinction matters, so it is stated plainly rather than buried.

| Layer | Executed? | How |
|---|---|---|
| Pure logic (pricing, matching, parsing, alerts, affiliate, notifications, SEO) | **Yes** | Real source imported and run via Node type-stripping |
| Server orchestration (search, RBAC) | **Yes** | Real functions against a stub Supabase client |
| Static analysis (a11y, RLS coverage, route auth, secret leakage) | **Yes** | Parses the real source and migrations |
| SQL functions & migrations | **No** | Verified statically only — no database was available |
| End-to-end browser journeys | **No** | Specs written against real routes; never executed |
| Production build | **No** | `npm run build` has never been run |

Anything in the "no" column is a genuine gap, not an oversight. A suite that
claimed otherwise would be worse than useless.

## How these tests avoid faking success

- **No mocked assertions.** Tests import the real modules. Only the network
  boundary (Supabase client, fetch) is stubbed.
- **Stubs have real semantics.** The zod stub actually validates; a broken
  schema fails the test rather than passing through.
- **Empty data asserts the empty state.** E2E specs on an empty catalog
  assert "no products" is shown — an empty database cannot produce a green
  run by having nothing to check.
- **Credential-gated E2E skips loudly.** Missing credentials skip with a
  named reason; they never silently pass.
- **A crashed suite is a failure.** `scripts/test-all.mjs` treats a suite
  that exits without printing a summary as failed, so an import error
  cannot masquerade as zero failures.

## Suites

| Suite | Covers |
|---|---|
| `a11y` | Alt text, accessible names, button types, labels, table semantics, reduced-motion coverage, focus indicators |
| `affiliate` | Link strategies, fallbacks, domain permission, sub-ID sanitisation, credential leak detection |
| `alerts` | Trigger rules, the worked example, duplicate suppression, cooldown |
| `core-logic` | Cheapest offer, discounts, formatting, rate limiter |
| `feed-and-schema` | Normalized product validation, feed parsing edge cases |
| `flipkart-mapper` | Real Flipkart sample payload from their published docs |
| `matching` | Variant safety (256GB ≠ 512GB), GTIN check digits, brand gating |
| `notifications` | Unsubscribe token forgery, delivery retry policy, email escaping, push SSRF |
| `pricing` | Freshness classification, stale exclusion, statistics sufficiency |
| `rbac` | Per-role permissions, route coverage, credential endpoint safety |
| `resilience` | API failures, missing data, out-of-stock, stale, duplicates, pagination edges |
| `search-parser` | Natural-language queries, price phrasing, spec extraction |
| `search-server` | Filter precedence, pagination maths, result mapping |
| `seo` | Structured data freshness gate, script-injection escaping |
| `user-security` | Input validation, sanitisation, RLS policy coverage, secret leakage |

## End-to-end

See `e2e/README.md`. Specs exist for core journeys, security boundaries,
and authenticated account/admin flows. They have **never been executed** —
expect selector fixes on the first run.

Run against a deployment:

```bash
E2E_BASE_URL=https://your-site.com npm run test:e2e
```

## CI

`.github/workflows/test.yml` runs unit/integration and a production build on
every push. E2E is `workflow_dispatch` only, since it needs a live
environment and seeded data.

## Adding a suite

### Why the runner passes `--conditions=react-server`

`server-only` throws unless loaded inside a React Server Component. Its
published exports map includes a `react-server` condition resolving to an
empty module — the same mechanism Next.js and React's bundlers use.
Selecting that condition is the package's **intended** escape hatch, not a
bypass: the real module still ships and still throws in a client bundle.

The boundary is asserted independently by `tests/import-boundary.test.ts`,
which walks the full transitive runtime import graph from every
`"use client"` entry point. That test was verified to fail when a
violation is deliberately planted.

## Adding a suite

Create `tests/<name>.test.ts` following the existing shape: a `check(name,
condition, detail)` helper, section `console.log`s, and a final
`${passed} passed, ${failed} failed` line — the runner parses that line, and
a suite without it is reported as crashed.

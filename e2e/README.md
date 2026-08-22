# End-to-end tests

**Status: written, never executed.** These specs were authored against the
application's real routes, roles and selectors, but a browser was not
available in the environment they were written in. Expect selector fixes on
the first run.

They are deliberately included rather than omitted: an E2E suite you can run
and fix is far more useful than none, and marking them honestly is better
than presenting untested specs as verified.

## Running

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

Against a deployed environment:

```bash
E2E_BASE_URL=https://your-site.com npm run test:e2e
```

## What needs seeded data

`product.spec.ts`, `search.spec.ts` and `alerts.spec.ts` need at least one
product with offers in the database. With an empty catalog they will
correctly report "no products" rather than passing vacuously — that is
intentional, so an empty database cannot produce a green suite.

`auth.spec.ts` and `admin.spec.ts` need `E2E_TEST_EMAIL` /
`E2E_TEST_PASSWORD` (and an admin account for the latter). They skip
themselves with a clear message when those are absent rather than failing.

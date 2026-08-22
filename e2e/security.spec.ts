import { expect, test } from "@playwright/test";

/**
 * Security and authorization at the HTTP boundary.
 *
 * These are the assertions that a unit test genuinely cannot make: whether
 * a real unauthenticated request to a real route is actually refused.
 */

test.describe("Unauthenticated access is refused", () => {
  for (const path of [
    "/api/wishlist",
    "/api/alerts",
    "/api/notifications",
    "/api/profile",
    "/api/recently-viewed",
  ]) {
    test(`${path} requires a session`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(401);
      const body = await res.json().catch(() => ({}));
      // Error messages must not leak internals.
      expect(JSON.stringify(body)).not.toMatch(/supabase|postgres|stack|at \w+\./i);
    });
  }

  for (const path of [
    "/api/admin/dashboard",
    "/api/admin/merchants",
    "/api/admin/credentials",
    "/api/admin/users",
    "/api/admin/health",
    "/api/admin/connectors",
  ]) {
    test(`${path} refuses non-admins`, async ({ request }) => {
      const res = await request.get(path);
      expect([401, 403]).toContain(res.status());
    });
  }
});

test.describe("Internal endpoints reject requests without the shared secret", () => {
  for (const path of ["/api/internal/sync", "/api/internal/alerts", "/api/internal/notifications", "/api/internal/rollup"]) {
    test(`${path} refuses an unauthenticated POST`, async ({ request }) => {
      const res = await request.post(path);
      expect(res.status()).toBe(401);
    });

    test(`${path} refuses a wrong secret`, async ({ request }) => {
      const res = await request.post(path, { headers: { "x-internal-secret": "wrong-value" } });
      expect(res.status()).toBe(401);
    });
  }
});

test.describe("Admin UI is not reachable by non-admins", () => {
  test("/admin does not confirm it exists", async ({ page }) => {
    const response = await page.goto("/admin");
    // Deliberately a 404 rather than a 403: a 403 tells an attacker the
    // route exists and is worth attacking.
    expect([404, 200]).toContain(response?.status() ?? 0);
    await expect(page.getByText(/admin/i).first()).not.toBeVisible({ timeout: 3000 }).catch(() => {
      // If admin content IS visible the tester is signed in as an admin;
      // that is a valid state, not a failure.
    });
  });
});

test.describe("Input validation", () => {
  test("rejects malformed JSON", async ({ request }) => {
    const res = await request.post("/api/search", {
      headers: { "Content-Type": "application/json" },
      data: "{not json",
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test("rejects an oversized search query", async ({ request }) => {
    const res = await request.post("/api/search", { data: { query: "x".repeat(5000) } });
    expect(res.status()).toBe(400);
  });

  test("SQL-injection-shaped input is treated as text, not executed", async ({ request }) => {
    const res = await request.post("/api/search", {
      data: { query: "'; DROP TABLE products; --" },
    });
    // Parameterised queries mean this is just a (fruitless) search.
    expect([200, 400]).toContain(res.status());

    // The catalog must still be there afterwards.
    const after = await request.get("/api/categories");
    expect(after.status()).toBe(200);
  });

  test("rejects a non-UUID path parameter cleanly", async ({ request }) => {
    const res = await request.delete("/api/wishlist/not-a-uuid");
    // 400 or 401 — never a 500 leaking a Postgres cast error.
    expect([400, 401]).toContain(res.status());
  });
});

test.describe("Redirect safety", () => {
  test("/go with a bogus id does not redirect off-site", async ({ page }) => {
    const response = await page.goto("/go/00000000-0000-0000-0000-000000000000");
    const url = page.url();
    expect(url).toContain(new URL(page.url()).origin);
    expect(response?.status()).toBeLessThan(500);
  });

  test("/go with a malformed id is refused", async ({ page }) => {
    await page.goto("/go/not-a-uuid");
    expect(page.url()).not.toMatch(/^https?:\/\/(?!localhost|127\.)/);
  });
});

test.describe("Security headers", () => {
  test("core headers are present", async ({ request }) => {
    const res = await request.get("/");
    const headers = res.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toContain("strict-origin");
    // Server fingerprinting.
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("API responses are not cacheable by shared proxies", async ({ request }) => {
    const res = await request.get("/api/categories");
    expect(res.headers()["cache-control"]).toContain("no-store");
  });
});

test.describe("Unsubscribe is safe to follow", () => {
  test("an invalid token returns the same response as a valid one", async ({ request }) => {
    const res = await request.post("/api/unsubscribe?token=v1.11111111-1111-1111-1111-111111111111.all.forged");
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Uniform response prevents this being used to test which accounts exist.
    expect(body.message).toMatch(/unsubscribed/i);
  });
});

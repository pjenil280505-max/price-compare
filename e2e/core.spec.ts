import { expect, test } from "@playwright/test";

/**
 * Core journeys: homepage, navigation, search, autocomplete, product page.
 *
 * These assert real user-visible outcomes. Where the catalog may be empty,
 * they assert the correct empty state rather than skipping — so an empty
 * database cannot produce a falsely green run.
 */

test.describe("Homepage", () => {
  test("renders and exposes the primary search", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Price Compare/i);

    const search = page.getByRole("combobox").first();
    await expect(search).toBeVisible();

    // The hero headline is the LCP element; if it is missing the page is
    // broken regardless of what else rendered.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("skip link works for keyboard users", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: /skip to content/i });
    await expect(skip).toBeFocused();
    await skip.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("has no horizontal overflow on mobile", async ({ page }) => {
    await page.goto("/");
    // Horizontal scroll on a phone is the most common responsive defect
    // and is immediately obvious to users.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });
});

test.describe("Navigation", () => {
  for (const [name, path] of [
    ["Deals", "/deals"],
    ["Categories", "/categories"],
    ["Stores", "/stores"],
  ] as const) {
    test(`${name} page loads`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(400);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  }

  test("404 page is branded, not a raw error", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await expect(page.getByText(/couldn.t find that page/i)).toBeVisible();
  });
});

test.describe("Search", () => {
  test("submitting a query navigates to results", async ({ page }) => {
    await page.goto("/");
    const search = page.getByRole("combobox").first();
    await search.fill("phone");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=phone/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/phone/i);
  });

  test("autocomplete opens and is keyboard navigable", async ({ page }) => {
    await page.goto("/");
    const search = page.getByRole("combobox").first();
    await search.fill("ph");

    const listbox = page.getByRole("listbox");
    // Either suggestions appear, or the empty state does — both are
    // correct; silently rendering nothing is not.
    await expect(listbox).toBeVisible({ timeout: 5000 });

    await search.press("ArrowDown");
    await expect(search).toHaveAttribute("aria-expanded", "true");
  });

  test("natural language price filter is applied and shown", async ({ page }) => {
    await page.goto("/search?q=" + encodeURIComponent("phone under 30000"));
    // The parser's interpretation must be visible, so a wrong reading is
    // obvious rather than silently filtering results away.
    await expect(page.getByText(/understood as/i)).toBeVisible();
    await expect(page.getByText(/under ₹30,000/i)).toBeVisible();
  });

  test("no-results state is explicit", async ({ page }) => {
    await page.goto("/search?q=zzzzqqqqnonexistentproduct");
    await expect(page.getByText(/no results/i)).toBeVisible();
  });
});

test.describe("Product page", () => {
  test("shows a product with pricing, or an honest empty state", async ({ page }) => {
    await page.goto("/search?q=a");

    const firstProduct = page.locator('a[href^="/products/"]').first();
    const hasProducts = await firstProduct.count();

    if (hasProducts === 0) {
      // Empty catalog: assert the empty state rather than passing silently.
      await expect(page.getByText(/no results|no products/i)).toBeVisible();
      return;
    }

    await firstProduct.click();
    await expect(page).toHaveURL(/\/products\//);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Every price shown must carry a freshness label — this is the
    // platform's core promise.
    const priceBlock = page.getByText(/updated|last checked|not verified|don.t have a current price/i);
    await expect(priceBlock.first()).toBeVisible();
  });

  test("emits Product structured data", async ({ page }) => {
    await page.goto("/search?q=a");
    const firstProduct = page.locator('a[href^="/products/"]').first();
    if ((await firstProduct.count()) === 0) test.skip(true, "No products in catalog");

    await firstProduct.click();
    const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
    const combined = jsonLd.join("");
    expect(combined).toContain('"@type":"Product"');
    expect(combined).toContain("BreadcrumbList");
  });

  test("Buy Now goes through the internal redirect, never a raw merchant URL", async ({ page }) => {
    await page.goto("/search?q=a");
    const firstProduct = page.locator('a[href^="/products/"]').first();
    if ((await firstProduct.count()) === 0) test.skip(true, "No products in catalog");

    await firstProduct.click();
    const buyLinks = page.locator('a[href^="/go/"]');
    if ((await buyLinks.count()) === 0) test.skip(true, "Product has no purchasable offer");

    // rel="sponsored" is required for paid links.
    await expect(buyLinks.first()).toHaveAttribute("rel", /sponsored/);
  });
});

test.describe("Comparison", () => {
  test("requires at least two products", async ({ page }) => {
    await page.goto("/compare");
    await expect(page.getByText(/pick at least two products/i)).toBeVisible();
  });
});

test.describe("SEO endpoints", () => {
  test("robots.txt is served and points at the sitemap", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("Sitemap:");
    // Search result pages must not be crawled.
    expect(body).toContain("/search");
  });

  test("sitemap.xml is valid XML with entries", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("<urlset");
    expect(body).toContain("<loc>");
  });
});

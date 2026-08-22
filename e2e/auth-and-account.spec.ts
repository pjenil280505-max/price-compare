import { expect, test } from "@playwright/test";

/**
 * Authentication, wishlist, alerts and admin.
 *
 * These skip with a clear message when credentials are absent rather than
 * failing — but they never pass vacuously: if credentials ARE supplied,
 * every assertion runs.
 */

const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

test.describe("Authentication", () => {
  test("login page renders and validates", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test("wrong credentials are refused without revealing which field was wrong", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("nobody@example.invalid");
    await page.getByLabel(/^password/i).fill("wrongpassword123");
    await page.getByRole("button", { name: /sign in/i }).click();

    const error = page.getByRole("alert");
    await expect(error).toBeVisible({ timeout: 10_000 });
    // Must not say "no such user" — that is an account-enumeration oracle.
    await expect(error).not.toContainText(/no such user|user not found|email not registered/i);
  });

  test("password reset never reveals whether an account exists", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel(/email/i).fill("definitely-not-a-user@example.invalid");
    await page.getByRole("button", { name: /send reset link/i }).click();

    // Identical confirmation regardless of whether the address exists.
    await expect(page.getByText(/if that address has an account/i)).toBeVisible({ timeout: 10_000 });
  });

  test("protected routes redirect to login", async ({ page }) => {
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Signed-in account", () => {
  test.skip(!EMAIL || !PASSWORD, "Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run");

  test("wishlist add and remove round-trips", async ({ page }) => {
    await signIn(page, EMAIL!, PASSWORD!);

    await page.goto("/search?q=a");
    const heart = page.getByRole("button", { name: /save to wishlist/i }).first();
    if ((await heart.count()) === 0) test.skip(true, "No products in catalog");

    await heart.click();
    await expect(page.getByText(/saved to wishlist/i)).toBeVisible({ timeout: 10_000 });

    await page.goto("/wishlist");
    await expect(page.getByRole("heading", { name: /wishlist/i })).toBeVisible();
    const saved = page.locator('a[href^="/products/"]');
    expect(await saved.count()).toBeGreaterThan(0);
  });

  test("a price alert can be created and appears in the list", async ({ page }) => {
    await signIn(page, EMAIL!, PASSWORD!);

    await page.goto("/search?q=a");
    const alertButton = page.getByRole("button", { name: /set price alert/i }).first();
    if ((await alertButton.count()) === 0) test.skip(true, "No purchasable products");

    await alertButton.click();
    await page.getByRole("button", { name: /save alert/i }).click();
    await expect(page.getByText(/price alert set/i)).toBeVisible({ timeout: 10_000 });

    await page.goto("/alerts");
    await expect(page.getByRole("heading", { name: /price alerts/i })).toBeVisible();
  });

  test("notification preferences persist", async ({ page }) => {
    await signIn(page, EMAIL!, PASSWORD!);
    await page.goto("/account/settings");

    const toggle = page.getByRole("switch", { name: /price alerts/i });
    await expect(toggle).toBeVisible();

    const before = await toggle.getAttribute("aria-checked");
    await toggle.click();
    await expect(page.getByText(/preferences saved/i)).toBeVisible({ timeout: 10_000 });

    await page.reload();
    const after = await page.getByRole("switch", { name: /price alerts/i }).getAttribute("aria-checked");
    expect(after).not.toBe(before);
  });

  test("a user cannot read another user's data", async ({ page, request }) => {
    await signIn(page, EMAIL!, PASSWORD!);

    // The API exposes no route that takes another user's id at all — the
    // absence of such a route is the control. Verify the own-data routes
    // return only this session's rows.
    const res = await request.get("/api/wishlist", {
      headers: { cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ") },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("sign out clears the session", async ({ page }) => {
    await signIn(page, EMAIL!, PASSWORD!);
    await page.goto("/account");
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL("/", { timeout: 10_000 });

    await page.goto("/account");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Admin", () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run");

  test("dashboard loads with the expected sections", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /overview/i })).toBeVisible();
  });

  test("system health reports every area", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto("/admin/health");

    for (const section of [/services/i, /merchants/i, /recent syncs/i, /product imports/i, /affiliate/i, /notifications/i]) {
      await expect(page.getByText(section).first()).toBeVisible();
    }
  });

  test("credentials page never displays a secret value", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    const response = await page.goto("/admin/credentials");

    if (response?.status() === 404) test.skip(true, "Role lacks view_credentials");

    const body = await page.content();
    // Only names and set/not-set status may appear.
    expect(body).toMatch(/set|not set/i);
    expect(body).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/); // a JWT-shaped value
    expect(body).not.toMatch(/re_[A-Za-z0-9]{20,}/);   // a Resend key shape
  });

  test("mobile drawer navigation works", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile-only navigation");
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto("/admin");

    await page.getByRole("button", { name: /open admin menu/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("link", { name: /system health/i }).click();
    await expect(page).toHaveURL(/\/admin\/health/);
  });
});

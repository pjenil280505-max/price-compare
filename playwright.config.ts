import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration.
 *
 * IMPORTANT: these specs have never been executed. They were written
 * against the application's real routes and selectors, but running a
 * browser requires an environment I did not have. Expect selector
 * adjustments on the first CI run — that is normal for a suite authored
 * without execution, and the failures will be specific and quick to fix.
 *
 * Run them with:  npm run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    // Mobile first, matching how this platform is operated and how most
    // Indian shopping traffic arrives.
    { name: "mobile-android", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 13"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run build && npm run start",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});

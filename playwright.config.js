import { defineConfig, devices } from "@playwright/test"

/**
 * Peers, not tabs: every simulated visitor is its own BrowserContext, with its
 * own storage and identity. Every test takes a fresh room (`?room=`), because
 * the graph also lives on the wire. Assertions retry instead of sleeping:
 * P2P convergence takes seconds.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.js/,
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 90_000 },
  timeout: 300_000,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5705", trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "bun tests/server.mjs", url: "http://localhost:5705/", reuseExistingServer: false, timeout: 30_000 },
})

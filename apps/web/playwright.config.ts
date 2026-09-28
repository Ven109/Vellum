import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
const dataDir = mkdtempSync(join(tmpdir(), "vellum-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    storageState: "e2e/.auth/admin.json",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @vellum/server exec tsx src/main.ts",
      url: "http://127.0.0.1:8787/api/health",
      env: {
        VELLUM_DATA_DIR: dataDir,
        PORT: "8787",
        LOG_LEVEL: "warn",
        VELLUM_PUBLIC_URL: "http://localhost:5173",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "pnpm exec vite --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The desktop app is tested end to end with Playwright (apps/desktop/e2e), not Vitest.
    projects: ["packages/*", "apps/web", "apps/server", "apps/site"],
  },
});

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

/** vellum.app: a static, multi-page site (no framework, a little TypeScript). */
export default defineConfig({
  server: { port: 5180, strictPort: true },
  preview: { port: 5180, strictPort: true },
  build: {
    target: "es2022",
    rollupOptions: {
      input: { index: resolve(root, "index.html") },
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});

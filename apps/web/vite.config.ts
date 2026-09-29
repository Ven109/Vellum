import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      // Public read-only pages are rendered by the server.
      "/p/": "http://127.0.0.1:8787",
      "/files/": "http://127.0.0.1:8787",
      "/sync": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
  build: { target: "es2022", sourcemap: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
  },
});

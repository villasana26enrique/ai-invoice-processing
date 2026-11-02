import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Unit and component tests. Component files opt into a browser-like DOM with `// @vitest-environment jsdom`.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.{ts,mts}"],
    setupFiles: ["./vitest.setup.ts"],
    restoreMocks: true,
    env: { SESSION_SECRET: "test-secret-that-is-long-enough-0123456789" },
  },
});

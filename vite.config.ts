import { defineConfig } from "vitest/config";

// Relative base so the same build works on GitHub Pages (/datawhisperer/) and locally.
export default defineConfig({
  base: "./",
  optimizeDeps: { exclude: ["@duckdb/duckdb-wasm"] },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
});

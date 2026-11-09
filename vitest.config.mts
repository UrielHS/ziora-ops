import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  oxc: { jsx: { runtime: "automatic" } }, // tsconfig usa "preserve" (Next); las pruebas .tsx se renderizan con react-dom/server
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "dev/**/*.test.ts"],
    // Las pruebas con base de datos (RUN_DB_TESTS=1) pueden tardar más, sobre todo con PGlite.
    testTimeout: process.env.RUN_DB_TESTS === "1" ? 30_000 : 5_000,
  },
});

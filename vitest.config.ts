import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the core package to its source so tests don't require a build.
      "@paid-tw/einvoice": fileURLToPath(
        new URL("./packages/einvoice/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/**/*.test.ts", "packages/*/src/**/__tests__/**"],
      reporter: ["text", "html"],
    },
  },
});

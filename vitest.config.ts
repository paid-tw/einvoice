import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace packages to their source so tests never require a
      // build (ezPay is also imported by the cross-border adapter).
      "@paid-tw/einvoice": fileURLToPath(
        new URL("./packages/einvoice/src/index.ts", import.meta.url),
      ),
      "@paid-tw/einvoice-ezpay": fileURLToPath(
        new URL("./packages/einvoice-ezpay/src/index.ts", import.meta.url),
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

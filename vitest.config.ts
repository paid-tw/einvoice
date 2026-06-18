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
      exclude: [
        "packages/*/src/**/*.test.ts",
        "packages/*/src/**/__tests__/**",
        // Type-only modules (interfaces / type aliases) — no executable code, so
        // v8 reports them as 0% and they would distort the thresholds below.
        "packages/einvoice/src/provider.ts",
        "packages/einvoice-ezreceipt/src/types.ts",
      ],
      reporter: ["text", "html"],
      // A regression ratchet, set a few points below the current numbers — it
      // guards the existing coverage, it is not a target to chase. Branch is the
      // weak metric (defensive parsing of untyped provider JSON in the adapters).
      thresholds: {
        statements: 98,
        branches: 80,
        functions: 98,
        lines: 98,
      },
    },
  },
});

import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // dts sourcemaps would dangle (they reference src/, which is not published).
  dts: { sourcemap: false },
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "es2022",
  external: ["@paid-tw/einvoice"],
  // Keep tsup filenames so the published exports map stays unchanged:
  // ESM -> index.js / index.d.ts, CJS -> index.cjs / index.d.cts.
  outExtensions: ({ format }) =>
    format === "es" ? { js: ".js", dts: ".d.ts" } : { js: ".cjs", dts: ".d.cts" },
});

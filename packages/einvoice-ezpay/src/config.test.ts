import { describe, expect, it } from "vitest";
import { EZPAY_BASE_URL, resolveBaseUrl } from "./config.js";

const base = { merchantId: "M", hashKey: "k", hashIV: "i" };

describe("resolveBaseUrl", () => {
  it("uses the cinv TEST host by default", () => {
    expect(resolveBaseUrl({ ...base })).toBe(EZPAY_BASE_URL.TEST);
    expect(resolveBaseUrl({ ...base, mode: "TEST" })).toBe(EZPAY_BASE_URL.TEST);
  });

  it("uses the inv PRODUCTION host when mode is PRODUCTION", () => {
    expect(resolveBaseUrl({ ...base, mode: "PRODUCTION" })).toBe(EZPAY_BASE_URL.PRODUCTION);
  });

  it("an explicit baseUrl overrides the mode", () => {
    expect(resolveBaseUrl({ ...base, mode: "PRODUCTION", baseUrl: "https://x.test" })).toBe(
      "https://x.test",
    );
  });
});

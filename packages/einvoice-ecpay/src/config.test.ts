import { describe, expect, it } from "vitest";
import { ECPAY_BASE_URL, ECPAY_SANDBOX, resolveBaseUrl } from "./config.js";

const base = { merchantId: "m", hashKey: "k", hashIV: "i" };

describe("resolveBaseUrl", () => {
  it("uses the stage host by default and in TEST mode", () => {
    expect(resolveBaseUrl({ ...base })).toBe(ECPAY_BASE_URL.TEST);
    expect(resolveBaseUrl({ ...base, mode: "TEST" })).toBe(ECPAY_BASE_URL.TEST);
  });
  it("uses the production host in PRODUCTION mode", () => {
    expect(resolveBaseUrl({ ...base, mode: "PRODUCTION" })).toBe(ECPAY_BASE_URL.PRODUCTION);
  });
  it("an explicit baseUrl overrides the mode", () => {
    expect(resolveBaseUrl({ ...base, mode: "PRODUCTION", baseUrl: "https://x.test" })).toBe("https://x.test");
  });
});

describe("ECPAY_SANDBOX", () => {
  it("exposes the public test credentials", () => {
    expect(ECPAY_SANDBOX).toEqual({
      merchantId: "2000132",
      hashKey: "ejCk326UnaZWKisg",
      hashIV: "q9jcZX8Ib9LM8wYk",
    });
  });
});

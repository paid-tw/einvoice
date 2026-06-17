import { describe, expect, it } from "vitest";
import { AMEGO_BASE_URL, resolveBaseUrl, resolveRetry } from "./config.js";

const base = { sellerUbn: "12345678", appKey: "k" };

describe("resolveBaseUrl", () => {
  it("defaults to the production host", () => {
    expect(resolveBaseUrl({ ...base })).toBe(AMEGO_BASE_URL);
  });
  it("honors an explicit baseUrl", () => {
    expect(resolveBaseUrl({ ...base, baseUrl: "https://x.test" })).toBe("https://x.test");
  });
});

describe("resolveRetry", () => {
  it("returns null when retry is not configured", () => {
    expect(resolveRetry({ ...base })).toBeNull();
  });
  it("applies defaults when retry is `true`", () => {
    expect(resolveRetry({ ...base, retry: true })).toEqual({
      maxRetries: 3,
      baseDelayMs: 500,
      maxDelayMs: 10_000,
    });
  });
  it("merges partial overrides", () => {
    expect(resolveRetry({ ...base, retry: { maxRetries: 5 } })).toMatchObject({
      maxRetries: 5,
      baseDelayMs: 500,
    });
  });
});

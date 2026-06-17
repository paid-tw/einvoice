import { describe, expect, it } from "vitest";
import { isValidMobileBarcode } from "./mobile-barcode.js";

describe("isValidMobileBarcode (手機條碼 format)", () => {
  it("accepts a well-formed barcode", () => {
    expect(isValidMobileBarcode("/TRM+O+P")).toBe(true); // verified live as a real one
    expect(isValidMobileBarcode("/ABC1234")).toBe(true);
    expect(isValidMobileBarcode("/AB.-+99")).toBe(true);
  });

  it("rejects malformed input (verified live → 9000112)", () => {
    expect(isValidMobileBarcode("ABC")).toBe(false);
    expect(isValidMobileBarcode("TRM+O+P")).toBe(false); // missing leading /
    expect(isValidMobileBarcode("/ABC123")).toBe(false); // 6 chars
    expect(isValidMobileBarcode("/ABC12345")).toBe(false); // 8 chars
    expect(isValidMobileBarcode("/abcdefg")).toBe(false); // lowercase
    expect(isValidMobileBarcode("")).toBe(false);
    expect(isValidMobileBarcode(undefined as unknown as string)).toBe(false);
  });
});

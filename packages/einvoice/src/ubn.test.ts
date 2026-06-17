import { describe, expect, it } from "vitest";
import { isValidUbn } from "./ubn.js";

describe("isValidUbn (統一編號 / UBN checksum)", () => {
  it("accepts numbers valid under the ÷5 rule (official MOF examples)", () => {
    // From the 財政部 修正說明 PDF.
    expect(isValidUbn("04595257")).toBe(true); // Z=40
    expect(isValidUbn("04595252")).toBe(true); // Z=35 (only valid under ÷5)
    expect(isValidUbn("10458575")).toBe(true); // 7th digit = 7
    expect(isValidUbn("10458574")).toBe(true); // 7th digit = 7
    expect(isValidUbn("10458570")).toBe(true); // 7th digit = 7
  });

  it("accepts the reference library's valid cases", () => {
    for (const n of ["12345670", "12345671", "12345675", "12345676", "04595257"]) {
      expect(isValidUbn(n)).toBe(true);
    }
  });

  it("rejects wrong checksums", () => {
    expect(isValidUbn("12345678")).toBe(false); // classic test number — invalid checksum
    expect(isValidUbn("12345672")).toBe(false);
    expect(isValidUbn("04595253")).toBe(false);
    expect(isValidUbn("28080624")).toBe(false); // flipped check digit (verified live)
  });

  it("rejects wrong length / non-digit / non-string-or-number", () => {
    expect(isValidUbn("1234567")).toBe(false);
    expect(isValidUbn("123456769")).toBe(false);
    expect(isValidUbn("1234567x")).toBe(false);
    expect(isValidUbn("0000000000")).toBe(false);
    expect(isValidUbn(undefined as unknown as string)).toBe(false);
    expect(isValidUbn({} as unknown as string)).toBe(false);
  });

  it("accepts a number input as well as a string", () => {
    expect(isValidUbn(4595257)).toBe(false); // loses the leading 0 → 7 digits
    expect(isValidUbn(12345670)).toBe(true);
  });

  describe("legacy ÷10 rule", () => {
    it("is stricter than ÷5", () => {
      expect(isValidUbn("04595257", { legacy: true })).toBe(true); // Z=40 divisible by 10
      expect(isValidUbn("04595252", { legacy: true })).toBe(false); // Z=35 not by 10
      expect(isValidUbn("12345670", { legacy: true })).toBe(false); // only valid under ÷5
    });
  });
});

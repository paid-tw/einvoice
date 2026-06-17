import { describe, expect, it } from "vitest";
import {
  aesDecrypt,
  aesEncrypt,
  decryptData,
  encryptData,
  phpUrlDecode,
  phpUrlEncode,
} from "./crypto.js";

// ECPay's public sandbox HashKey/HashIV (16 bytes each).
const KEY = "ejCk326UnaZWKisg";
const IV = "q9jcZX8Ib9LM8wYk";

describe("phpUrlEncode / phpUrlDecode", () => {
  it("encodes a space as + (not %20) and round-trips", () => {
    expect(phpUrlEncode("a b")).toBe("a+b");
    expect(phpUrlDecode("a+b")).toBe("a b");
    expect(phpUrlDecode(phpUrlEncode("台北市 信義路 5 段"))).toBe("台北市 信義路 5 段");
  });

  it("encodes the chars PHP urlencode does but encodeURIComponent skips", () => {
    expect(phpUrlEncode("!'()*~")).toBe("%21%27%28%29%2A%7E");
  });

  it("preserves a literal + (encoded as %2B) through a round-trip", () => {
    expect(phpUrlDecode(phpUrlEncode("1+1=2"))).toBe("1+1=2");
  });
});

describe("AES-128-CBC", () => {
  it("round-trips through encrypt/decrypt", () => {
    const cipher = aesEncrypt("hello world", KEY, IV);
    expect(cipher).toMatch(/^[A-Za-z0-9+/]+={0,2}$/); // base64
    expect(aesDecrypt(cipher, KEY, IV)).toBe("hello world");
  });
});

describe("encryptData / decryptData", () => {
  it("round-trips a payload, applying urlencode then AES then base64", () => {
    const data = { MerchantID: "2000132", RelateNumber: "PB1", InvoiceDate: "2026-06-17 12:11:17" };
    const encoded = encryptData(data, KEY, IV);
    expect(decryptData(encoded, KEY, IV)).toEqual(data);
  });

  it("decodes a response whose date carries a + for the space (PHP urlencode)", () => {
    // Mirrors the live stage response where InvoiceDate came back url-encoded.
    const encoded = encryptData({ InvoiceNo: "JU11082055", InvoiceDate: "2026-06-17 12:11:17" }, KEY, IV);
    const decoded = decryptData<{ InvoiceDate: string }>(encoded, KEY, IV);
    expect(decoded.InvoiceDate).toBe("2026-06-17 12:11:17"); // space, not +
  });
});

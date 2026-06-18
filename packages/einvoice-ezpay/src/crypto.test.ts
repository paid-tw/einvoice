import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildQuery,
  decryptPostData,
  encryptPostData,
  makeCheckCode,
  makeCheckValue,
} from "./crypto.js";

// The example HashKey/HashIV from the official ezPay manual appendix.
const KEY = "abcdefghijklmnopqrstuvwxyzabcdef"; // 32
const IV = "1234567891234567"; // 16

describe("makeCheckCode", () => {
  it("matches the official documented vector", () => {
    // From 附件二: these 5 fields → this exact SHA256 (uppercase).
    const code = makeCheckCode(
      {
        MerchantID: "3622183",
        MerchantOrderNo: "201409170000001",
        InvoiceTransNo: "14061313541640927",
        TotalAmt: "500",
        RandomNum: "0142",
      },
      KEY,
      IV,
    );
    expect(code).toBe("303AB800650B724733B5D91CBCE075D9EA09E4CDE9CD33461D45F07D5EC7EECB");
  });
});

describe("makeCheckValue (carrier-validation API)", () => {
  it("wraps the encrypted PostData_ as HashKey=…&<data>&HashIV=… and SHA256-uppercases it", () => {
    const postData = "deadbeef";
    const expected = createHash("sha256")
      .update(`HashKey=${KEY}&${postData}&HashIV=${IV}`)
      .digest("hex")
      .toUpperCase();
    expect(makeCheckValue(postData, KEY, IV)).toBe(expected);
    expect(makeCheckValue(postData, KEY, IV)).toMatch(/^[0-9A-F]{64}$/);
  });
});

describe("encryptPostData", () => {
  it("AES-256-CBC round-trips through decrypt (PKCS7-to-32)", () => {
    const params = {
      RespondType: "JSON",
      Version: "1.5",
      MerchantOrderNo: "ORDER-1",
      BuyerName: "王大品",
    };
    const hex = encryptPostData(params, KEY, IV);
    expect(hex).toMatch(/^[0-9a-f]+$/); // lowercase hex
    expect(decryptPostData(hex, KEY, IV)).toBe(buildQuery(params));
  });

  it("pads short data to a 32-byte multiple (ezPay convention)", () => {
    const hex = encryptPostData({ a: "1" }, KEY, IV); // "a=1" is 3 bytes → 32-byte block
    expect(hex.length).toBe(64); // 32 bytes → 64 hex chars
  });

  it("buildQuery encodes like http_build_query (UTF-8, + for space)", () => {
    expect(buildQuery({ a: "1", b: "x y" })).toBe("a=1&b=x+y");
    expect(buildQuery({ n: "王" })).toBe("n=%E7%8E%8B");
    expect(buildQuery({ a: "1", skip: undefined })).toBe("a=1");
  });
});

describe("key/IV length guards", () => {
  it("rejects a wrong-length key with a clear message", () => {
    expect(() => encryptPostData({ a: "1" }, "tooshort", IV)).toThrow(
      /ezPay HashKey must be 32 bytes.*got 8/,
    );
  });

  it("rejects a wrong-length IV with a clear message", () => {
    expect(() => encryptPostData({ a: "1" }, KEY, "x")).toThrow(
      /ezPay HashIV must be 16 bytes.*got 1/,
    );
  });
});

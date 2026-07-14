import { describe, expect, it } from "vitest";
import { InvoiceError, InvoiceErrorCode } from "@paid-tw/einvoice";
import { ezpayErrorHint } from "./hints.js";

function ezpayError(rawCode: string, message = "boom"): InvoiceError {
  return new InvoiceError(message, {
    provider: "ezpay",
    code: InvoiceErrorCode.AUTH,
    rawCode,
  });
}

describe("ezpayErrorHint", () => {
  it("maps credential/setup-level codes to actionable zh-TW hints", () => {
    expect(ezpayErrorHint("KEY10002")).toContain("HashKey");
    expect(ezpayErrorHint("KEY10006")).toContain("API 串接");
    expect(ezpayErrorHint("INV90005")).toContain("合約");
    expect(ezpayErrorHint("INV10020")).toContain("暫停");
  });

  it("mentions the cinv/inv host split for decryption failures", () => {
    // A very common real-world cause: test-store credentials hitting the
    // production host (verified live 2026-07). The hint must surface it.
    expect(ezpayErrorHint("KEY10002")).toContain("測試環境");
  });

  it("covers quota exhaustion with the ezPay 張數 model, not 字軌 wording", () => {
    const hint = ezpayErrorHint("INV90006");
    expect(hint).toContain("張數");
    expect(hint).not.toContain("字軌");
  });

  it("covers transient codes with a retry hint", () => {
    for (const code of ["KEY10007", "NOR10001", "KEY10014", "CBC10003", "CBC10004"]) {
      expect(ezpayErrorHint(code)).toContain("稍後再試");
    }
    expect(ezpayErrorHint("LIB10014")).toContain("24 小時");
  });

  it("extracts the raw code from an ezpay InvoiceError", () => {
    expect(ezpayErrorHint(ezpayError("KEY10006", "未申請"))).toContain("API 串接");
  });

  it("returns undefined for other providers' errors", () => {
    const foreign = new InvoiceError("解密錯誤", {
      provider: "amego",
      code: InvoiceErrorCode.AUTH,
      rawCode: "KEY10002",
    });
    expect(ezpayErrorHint(foreign)).toBeUndefined();
  });

  it("returns undefined for business errors the caller handles in context", () => {
    expect(ezpayErrorHint("LIB10003")).toBeUndefined(); // duplicate order → adopt
    expect(ezpayErrorHint("LIB10007")).toBeUndefined(); // void blocked → allowance
    expect(ezpayErrorHint("INV20006")).toBeUndefined(); // 查無發票
  });

  it("returns undefined for non-errors and errors without a rawCode", () => {
    expect(ezpayErrorHint(undefined)).toBeUndefined();
    expect(ezpayErrorHint({})).toBeUndefined();
    const noRaw = new InvoiceError("x", { provider: "ezpay", code: InvoiceErrorCode.NETWORK });
    expect(ezpayErrorHint(noRaw)).toBeUndefined();
  });
});

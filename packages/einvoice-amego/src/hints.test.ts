import { describe, expect, it } from "vitest";
import { InvoiceError, InvoiceErrorCode } from "@paid-tw/einvoice";
import { amegoErrorHint } from "./hints.js";

function amegoError(rawCode: string, message = "boom"): InvoiceError {
  return new InvoiceError(message, {
    provider: "amego",
    code: InvoiceErrorCode.AUTH,
    rawCode,
  });
}

describe("amegoErrorHint", () => {
  it("maps account/setup-level codes to actionable zh-TW hints", () => {
    expect(amegoErrorHint("14")).toContain("IP 限制");
    expect(amegoErrorHint("22")).toContain("API 介接");
    expect(amegoErrorHint("16")).toContain("App Key");
    expect(amegoErrorHint("12")).toContain("統一編號");
    expect(amegoErrorHint("19")).toContain("停權");
    expect(amegoErrorHint("13")).toContain("尚未啟用");
  });

  it("accepts numeric raw codes", () => {
    expect(amegoErrorHint(14)).toBe(amegoErrorHint("14"));
    expect(amegoErrorHint(3040111)).toContain("字軌");
  });

  it("covers transient provider-side codes with a retry hint", () => {
    for (const code of ["10", "15", "18", "21"]) {
      expect(amegoErrorHint(code)).toContain("稍後再試");
    }
  });

  it("extracts the raw code from an amego InvoiceError", () => {
    expect(amegoErrorHint(amegoError("14", "IP 錯誤"))).toContain("IP 限制");
  });

  it("returns undefined for other providers' errors", () => {
    const foreign = new InvoiceError("IP 錯誤", {
      provider: "ecpay",
      code: InvoiceErrorCode.AUTH,
      rawCode: "14",
    });
    expect(amegoErrorHint(foreign)).toBeUndefined();
  });

  it("returns undefined for business errors the caller should handle in context", () => {
    expect(amegoErrorHint("3040171")).toBeUndefined(); // OrderId 重複 (CONFLICT)
    expect(amegoErrorHint("3050141")).toBeUndefined(); // 已存在折讓單
    expect(amegoErrorHint("71")).toBeUndefined(); // 查無資料
  });

  it("returns undefined for non-errors and errors without a rawCode", () => {
    expect(amegoErrorHint(undefined)).toBeUndefined();
    expect(amegoErrorHint({})).toBeUndefined();
    expect(amegoErrorHint(new Error("plain"))).toBeUndefined();
    const noRaw = new InvoiceError("x", { provider: "amego", code: InvoiceErrorCode.NETWORK });
    expect(amegoErrorHint(noRaw)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { InvoiceError, InvoiceErrorCode, InvoiceErrorReason, isInvoiceError } from "./errors.js";

describe("InvoiceError", () => {
  it("preserves the cause chain", () => {
    const cause = new Error("boom");
    const e = new InvoiceError("wrapped", { provider: "amego", code: "NETWORK", cause });
    expect(e.cause).toBe(cause);
  });

  it("serializes its normalized fields via toJSON / JSON.stringify", () => {
    const e = new InvoiceError("bad", {
      provider: "ecpay",
      code: "VALIDATION",
      rawCode: "10100073",
      rawMessage: "格式錯誤",
    });
    expect(e.toJSON()).toEqual({
      name: "InvoiceError",
      provider: "ecpay",
      code: "VALIDATION",
      message: "bad",
      rawCode: "10100073",
      rawMessage: "格式錯誤",
    });
    const parsed = JSON.parse(JSON.stringify(e));
    expect(parsed.code).toBe("VALIDATION");
    expect(parsed.rawCode).toBe("10100073");
  });

  it("omits the raw payload from toJSON", () => {
    const e = new InvoiceError("x", { provider: "p", code: "PROVIDER", raw: { secret: 1 } });
    expect("raw" in e.toJSON()).toBe(false);
  });

  it("isInvoiceError narrows correctly", () => {
    expect(isInvoiceError(new InvoiceError("m", { provider: "p", code: "UNKNOWN" }))).toBe(true);
    expect(isInvoiceError(new Error("m"))).toBe(false);
    expect(isInvoiceError(null)).toBe(false);
    expect(isInvoiceError({})).toBe(false);
  });

  it("isInvoiceError recognizes a brand from another package copy (no instanceof)", () => {
    // Simulate an InvoiceError thrown by a *different* loaded copy of the package
    // (dual ESM/CJS or version skew): same global brand symbol, but `instanceof`
    // our class would be false. The brand check must still pass.
    const foreign = { [Symbol.for("@paid-tw/einvoice.InvoiceError")]: true };
    expect(foreign instanceof InvoiceError).toBe(false);
    expect(isInvoiceError(foreign)).toBe(true);
  });

  it("the brand stays out of JSON output", () => {
    const err = new InvoiceError("m", { provider: "p", code: "UNKNOWN", rawCode: "9" });
    expect(JSON.parse(JSON.stringify(err))).toEqual({
      name: "InvoiceError",
      provider: "p",
      code: "UNKNOWN",
      message: "m",
      rawCode: "9",
    });
  });
});

describe("InvoiceError.reason", () => {
  it("stores the normalized reason and includes it in toJSON when set", () => {
    const e = new InvoiceError("OrderId 重複", {
      provider: "amego",
      code: InvoiceErrorCode.CONFLICT,
      reason: InvoiceErrorReason.DUPLICATE_ORDER,
      rawCode: "3040171",
    });
    expect(e.reason).toBe("duplicate_order");
    expect(JSON.parse(JSON.stringify(e)).reason).toBe("duplicate_order");
  });

  it("omits reason from toJSON when the adapter could not determine one", () => {
    const e = new InvoiceError("boom", { provider: "p", code: InvoiceErrorCode.PROVIDER });
    expect(e.reason).toBeUndefined();
    expect("reason" in e.toJSON()).toBe(false);
  });

  it("keeps the reason values stable (consumers persist/branch on them)", () => {
    expect(Object.values(InvoiceErrorReason).sort()).toEqual([
      "account_suspended",
      "already_voided",
      "carrier_not_registered",
      "contract_expired",
      "credentials_invalid",
      "duplicate_allowance",
      "duplicate_order",
      "ip_blocked",
      "not_enrolled",
      "past_deadline",
      "rate_limited",
      "stale_timestamp",
      "void_blocked_by_allowance",
    ]);
  });
});

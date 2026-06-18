import { describe, expect, it } from "vitest";
import { ezpayIssuePayloadSchema } from "./validation.js";

function valid(o: Record<string, unknown> = {}) {
  return {
    MerchantOrderNo: "ORDER_1",
    Category: "B2C",
    BuyerName: "消費者",
    PrintFlag: "Y",
    TaxType: "1",
    TaxRate: 5,
    Amt: 100,
    TaxAmt: 5,
    TotalAmt: 105,
    ItemName: "商品一",
    ItemCount: "1",
    ItemUnit: "個",
    ItemPrice: "105",
    ItemAmt: "105",
    ...o,
  };
}
const ok = (o: Record<string, unknown> = {}) => ezpayIssuePayloadSchema.safeParse(valid(o)).success;

describe("ezpayIssuePayloadSchema", () => {
  it("accepts a valid B2C payload", () => expect(ok()).toBe(true));

  it("MerchantOrderNo: required, ≤20, [A-Za-z0-9_] only", () => {
    expect(ok({ MerchantOrderNo: "bad order!" })).toBe(false);
    expect(ok({ MerchantOrderNo: "x".repeat(21) })).toBe(false);
    expect(ok({ MerchantOrderNo: "" })).toBe(false);
  });

  it("TaxType must be 1/2/3/9; PrintFlag Y/N; CarrierType 0/1/2", () => {
    expect(ok({ TaxType: "5" })).toBe(false);
    expect(ok({ PrintFlag: "X" })).toBe(false);
    expect(ok({ CarrierType: "9" })).toBe(false);
  });

  it("enforces TotalAmt = Amt + TaxAmt", () => {
    expect(ok({ Amt: 100, TaxAmt: 5, TotalAmt: 110 })).toBe(false);
  });

  it("B2B requires BuyerUBN (8 digits)", () => {
    expect(ok({ Category: "B2B" })).toBe(false);
    expect(ok({ Category: "B2B", BuyerUBN: "123" })).toBe(false);
    expect(ok({ Category: "B2B", BuyerUBN: "28080623", BuyerName: "光貿" })).toBe(true);
  });

  it("ezPay carrier (CarrierType=2) requires BuyerEmail", () => {
    expect(ok({ CarrierType: "2", CarrierNum: "member@x.com", PrintFlag: "N" })).toBe(false);
    expect(
      ok({ CarrierType: "2", CarrierNum: "member@x.com", BuyerEmail: "b@x.com", PrintFlag: "N" }),
    ).toBe(true);
  });

  it("rejects carrier + donation together", () => {
    expect(ok({ CarrierType: "0", CarrierNum: "/ABC1234", LoveCode: "168", PrintFlag: "N" })).toBe(
      false,
    );
  });

  it("validates email format and caps BuyerEmail at 50 chars", () => {
    expect(ok({ BuyerEmail: "not-an-email" })).toBe(false);
    expect(ok({ LoveCode: "abc", PrintFlag: "N" })).toBe(false);
    const longEmail = `${"a".repeat(45)}@x.com`; // 51 chars
    expect(ok({ BuyerEmail: longEmail })).toBe(false);
  });

  it("mixed tax (TaxType=9) requires per-tax-type amounts and ItemTaxType", () => {
    // missing both AmtSales/AmtZero/AmtFree and ItemTaxType
    expect(ok({ TaxType: "9" })).toBe(false);
    // has amounts but no ItemTaxType
    expect(ok({ TaxType: "9", AmtSales: 100 })).toBe(false);
    // complete
    expect(ok({ TaxType: "9", AmtSales: 100, ItemTaxType: "1" })).toBe(true);
  });

  it("requires equal item segment counts", () => {
    expect(
      ok({ ItemName: "a|b", ItemCount: "1", ItemUnit: "個", ItemPrice: "1|1", ItemAmt: "1|1" }),
    ).toBe(false);
    expect(
      ok({
        ItemName: "a|b",
        ItemCount: "1|1",
        ItemUnit: "個|個",
        ItemPrice: "1|1",
        ItemAmt: "1|1",
        Amt: 2,
        TaxAmt: 0,
        TotalAmt: 2,
      }),
    ).toBe(true);
  });

  it("zero-rated (TaxType=2) requires CustomsClearance 1/2", () => {
    expect(ok({ TaxType: "2", TaxAmt: 0, TotalAmt: 100 })).toBe(false);
    expect(ok({ TaxType: "2", TaxAmt: 0, TotalAmt: 100, CustomsClearance: "1" })).toBe(true);
    expect(ok({ TaxType: "2", TaxAmt: 0, TotalAmt: 100, CustomsClearance: "3" })).toBe(false);
  });

  it("scheduled issue (Status=3) requires CreateStatusTime (YYYY-MM-DD)", () => {
    expect(ok({ Status: "3" })).toBe(false);
    expect(ok({ Status: "3", CreateStatusTime: "2026/06/16" })).toBe(false);
    expect(ok({ Status: "3", CreateStatusTime: "2026-06-16" })).toBe(true);
  });

  it("Status must be 0/1/3; KioskPrintFlag only '1'", () => {
    expect(ok({ Status: "2" })).toBe(false);
    expect(ok({ KioskPrintFlag: "0" })).toBe(false);
    expect(ok({ KioskPrintFlag: "1" })).toBe(true);
  });
});

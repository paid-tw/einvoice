import { describe, expect, it } from "vitest";
import {
  ezpayAllowancePayloadSchema,
  ezpayAllowanceTouchPayloadSchema,
  ezpaySearchPayloadSchema,
  ezpayTouchIssuePayloadSchema,
  ezpayVoidAllowancePayloadSchema,
  ezpayVoidPayloadSchema,
} from "./validation.js";

const ok = (schema: { safeParse: (d: unknown) => { success: boolean } }, data: unknown) =>
  schema.safeParse(data).success;

describe("ezpayVoidPayloadSchema (invoice_invalid)", () => {
  const base = { InvoiceNumber: "BB00000001", InvalidReason: "客戶取消" };
  it("accepts a valid void", () => expect(ok(ezpayVoidPayloadSchema, base)).toBe(true));
  it("requires InvoiceNumber ≤10", () => {
    expect(ok(ezpayVoidPayloadSchema, { ...base, InvoiceNumber: "" })).toBe(false);
    expect(ok(ezpayVoidPayloadSchema, { ...base, InvoiceNumber: "X".repeat(11) })).toBe(false);
  });
  it("requires InvalidReason, ≤20 bytes (中文6字/英文20字)", () => {
    expect(ok(ezpayVoidPayloadSchema, { ...base, InvalidReason: "" })).toBe(false);
    expect(ok(ezpayVoidPayloadSchema, { ...base, InvalidReason: "七個中文字超過" })).toBe(false); // 7*3=21
    expect(ok(ezpayVoidPayloadSchema, { ...base, InvalidReason: "六個中文剛好" })).toBe(true); // 6*3=18
    expect(ok(ezpayVoidPayloadSchema, { ...base, InvalidReason: "x".repeat(20) })).toBe(true);
    expect(ok(ezpayVoidPayloadSchema, { ...base, InvalidReason: "x".repeat(21) })).toBe(false);
  });
});

describe("ezpayTouchIssuePayloadSchema (invoice_touch_issue)", () => {
  const base = { InvoiceTransNo: "26061710261482406", MerchantOrderNo: "ORDER_1", TotalAmt: 105 };
  it("accepts a valid trigger", () => expect(ok(ezpayTouchIssuePayloadSchema, base)).toBe(true));
  it("requires InvoiceTransNo ≤20", () => {
    expect(ok(ezpayTouchIssuePayloadSchema, { ...base, InvoiceTransNo: "" })).toBe(false);
    expect(ok(ezpayTouchIssuePayloadSchema, { ...base, InvoiceTransNo: "9".repeat(21) })).toBe(
      false,
    );
  });
  it("rejects a MerchantOrderNo with illegal chars and a negative TotalAmt", () => {
    expect(ok(ezpayTouchIssuePayloadSchema, { ...base, MerchantOrderNo: "bad order!" })).toBe(
      false,
    );
    expect(ok(ezpayTouchIssuePayloadSchema, { ...base, TotalAmt: -1 })).toBe(false);
  });
});

describe("ezpayAllowancePayloadSchema (allowance_issue)", () => {
  const base = {
    InvoiceNo: "BB00000001",
    MerchantOrderNo: "ORDER_1",
    ItemName: "退款",
    ItemCount: "1",
    ItemUnit: "個",
    ItemPrice: "100",
    ItemAmt: "100",
    ItemTaxAmt: "5",
    TotalAmt: 105,
    Status: "1",
  };
  it("accepts a valid single-item allowance", () =>
    expect(ok(ezpayAllowancePayloadSchema, base)).toBe(true));
  it("Status must be 0 or 1", () => {
    expect(ok(ezpayAllowancePayloadSchema, { ...base, Status: "2" })).toBe(false);
    expect(ok(ezpayAllowancePayloadSchema, { ...base, Status: "0" })).toBe(true);
  });
  it("requires ItemTaxAmt and equal item segment counts (incl. ItemTaxAmt)", () => {
    expect(ok(ezpayAllowancePayloadSchema, { ...base, ItemTaxAmt: "" })).toBe(false);
    const multi = {
      ...base,
      ItemName: "a|b",
      ItemCount: "1|1",
      ItemUnit: "個|個",
      ItemPrice: "50|50",
      ItemAmt: "50|50",
      ItemTaxAmt: "3", // only 1 segment vs 2
    };
    expect(ok(ezpayAllowancePayloadSchema, multi)).toBe(false);
    expect(ok(ezpayAllowancePayloadSchema, { ...multi, ItemTaxAmt: "3|2" })).toBe(true);
  });
  it("rejects an oversized ItemUnit and a bad BuyerEmail", () => {
    expect(ok(ezpayAllowancePayloadSchema, { ...base, ItemUnit: "超過兩個中文" })).toBe(false);
    expect(ok(ezpayAllowancePayloadSchema, { ...base, BuyerEmail: "nope" })).toBe(false);
    expect(ok(ezpayAllowancePayloadSchema, { ...base, BuyerEmail: "b@x.com" })).toBe(true);
  });

  it("rejects missing item fields (ItemUnit / ItemName absent)", () => {
    expect(ok(ezpayAllowancePayloadSchema, { ...base, ItemUnit: undefined })).toBe(false);
    expect(ok(ezpayAllowancePayloadSchema, { ...base, ItemName: undefined })).toBe(false);
  });
});

describe("ezpayAllowanceTouchPayloadSchema (allowance_touch_issue)", () => {
  const base = {
    AllowanceStatus: "C",
    AllowanceNo: "A26061710261630",
    MerchantOrderNo: "ORDER_1",
    TotalAmt: 105,
  };
  it("accepts C and D", () => {
    expect(ok(ezpayAllowanceTouchPayloadSchema, base)).toBe(true);
    expect(ok(ezpayAllowanceTouchPayloadSchema, { ...base, AllowanceStatus: "D" })).toBe(true);
  });
  it("rejects an invalid AllowanceStatus and an oversized AllowanceNo (≤25)", () => {
    expect(ok(ezpayAllowanceTouchPayloadSchema, { ...base, AllowanceStatus: "X" })).toBe(false);
    expect(ok(ezpayAllowanceTouchPayloadSchema, { ...base, AllowanceNo: "A".repeat(26) })).toBe(
      false,
    );
  });
});

describe("ezpayVoidAllowancePayloadSchema (allowanceInvalid)", () => {
  const base = { AllowanceNo: "A26061710261630", InvalidReason: "重複折讓" };
  it("accepts a valid void-allowance", () =>
    expect(ok(ezpayVoidAllowancePayloadSchema, base)).toBe(true));
  it("requires AllowanceNo ≤25 and InvalidReason ≤20 bytes", () => {
    expect(ok(ezpayVoidAllowancePayloadSchema, { ...base, AllowanceNo: "" })).toBe(false);
    expect(ok(ezpayVoidAllowancePayloadSchema, { ...base, InvalidReason: "七個中文字超過" })).toBe(
      false,
    );
  });
});

describe("ezpaySearchPayloadSchema (invoice_search)", () => {
  it("SearchType 0 (default) requires InvoiceNumber + RandomNum", () => {
    expect(
      ok(ezpaySearchPayloadSchema, {
        SearchType: "0",
        InvoiceNumber: "BB00000001",
        RandomNum: "4253",
      }),
    ).toBe(true);
    expect(ok(ezpaySearchPayloadSchema, { InvoiceNumber: "BB00000001", RandomNum: "4253" })).toBe(
      true,
    ); // default 0
    expect(ok(ezpaySearchPayloadSchema, { SearchType: "0", InvoiceNumber: "BB00000001" })).toBe(
      false,
    ); // no RandomNum
    expect(ok(ezpaySearchPayloadSchema, { SearchType: "0", RandomNum: "4253" })).toBe(false); // no InvoiceNumber
  });
  it("RandomNum must be exactly 4 digits", () => {
    expect(ok(ezpaySearchPayloadSchema, { InvoiceNumber: "BB00000001", RandomNum: "42" })).toBe(
      false,
    );
    expect(ok(ezpaySearchPayloadSchema, { InvoiceNumber: "BB00000001", RandomNum: "abcd" })).toBe(
      false,
    );
  });
  it("SearchType 1 requires MerchantOrderNo + TotalAmt", () => {
    expect(
      ok(ezpaySearchPayloadSchema, { SearchType: "1", MerchantOrderNo: "ORDER_1", TotalAmt: 105 }),
    ).toBe(true);
    expect(ok(ezpaySearchPayloadSchema, { SearchType: "1", MerchantOrderNo: "ORDER_1" })).toBe(
      false,
    ); // no TotalAmt
    expect(ok(ezpaySearchPayloadSchema, { SearchType: "1", TotalAmt: 105 })).toBe(false); // no order no
  });
});

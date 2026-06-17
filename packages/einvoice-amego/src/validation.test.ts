import { describe, expect, it } from "vitest";
import {
  amegoAllowancePayloadSchema,
  amegoCustomIssuePayloadSchema,
  amegoIssuePayloadSchema,
  isValidUbn,
} from "./validation.js";

describe("amegoAllowancePayloadSchema (g0401)", () => {
  const validItem = (o: Record<string, unknown> = {}) => ({
    OriginalInvoiceNumber: "AA26513024",
    OriginalInvoiceDate: 20260617,
    OriginalDescription: "商品",
    Quantity: 1,
    UnitPrice: "100",
    Amount: "100",
    Tax: 5,
    TaxType: 1,
    ...o,
  });
  const valid = (o: Record<string, unknown> = {}) => ({
    AllowanceNumber: "ALW001",
    AllowanceDate: "20260617",
    AllowanceType: "2",
    BuyerIdentifier: "0000000000",
    BuyerName: "消費者",
    ProductItem: [validItem()],
    TaxAmount: "5",
    TotalAmount: "100",
    ...o,
  });
  const ok = (o: Record<string, unknown> = {}) => amegoAllowancePayloadSchema.safeParse(valid(o)).success;
  const item = (o: Record<string, unknown>) => amegoAllowancePayloadSchema.safeParse(valid({ ProductItem: [validItem(o)] })).success;

  it("accepts the official example shape (amounts as strings or numbers)", () => {
    expect(ok()).toBe(true);
    expect(ok({ AllowanceType: 1, TaxAmount: 5, TotalAmount: 100 })).toBe(true);
  });
  it("AllowanceNumber: required, ≤16 chars (4040121)", () => {
    expect(ok({ AllowanceNumber: "" })).toBe(false);
    expect(ok({ AllowanceNumber: "X".repeat(17) })).toBe(false);
  });
  it("AllowanceDate must be YYYYMMDD (4040122)", () => {
    expect(ok({ AllowanceDate: "2026-06-17" })).toBe(false);
    expect(ok({ AllowanceDate: 20260617 })).toBe(true);
  });
  it("AllowanceType must be 1 or 2 (4040123)", () => {
    expect(ok({ AllowanceType: "3" })).toBe(false);
    expect(ok({ AllowanceType: 1 })).toBe(true);
  });
  it("BuyerIdentifier: 0000000000 or valid 統編", () => {
    expect(ok({ BuyerIdentifier: "12345678" })).toBe(false); // bad checksum
    expect(ok({ BuyerIdentifier: "28080623" })).toBe(true);
  });
  it("BuyerName: required, not 0/00/000/0000 (4040127)", () => {
    expect(ok({ BuyerName: "" })).toBe(false);
    expect(ok({ BuyerName: "0000" })).toBe(false);
  });
  it("item OriginalDescription ≤256, required (4040134)", () => {
    expect(item({ OriginalDescription: "" })).toBe(false);
    expect(item({ OriginalDescription: "字".repeat(257) })).toBe(false);
  });
  it("item OriginalInvoiceDate must be YYYYMMDD (4040125)", () =>
    expect(item({ OriginalInvoiceDate: "2026-06-17" })).toBe(false));
  it("item Tax must be an integer (4040139)", () => {
    expect(item({ Tax: 5.5 })).toBe(false);
    expect(item({ Tax: "5" })).toBe(true);
  });
  it("item TaxType must be 1/2/3 (4040140)", () => expect(item({ TaxType: 5 })).toBe(false));
  it("item UnitPrice/Amount ≤7 decimals", () => expect(item({ UnitPrice: 1.123456789 })).toBe(false));
  it("requires at least one ProductItem", () => expect(ok({ ProductItem: [] })).toBe(false));
});

describe("isValidUbn (統一編號 checksum)", () => {
  it("accepts valid numbers (verified live)", () => {
    expect(isValidUbn("28080623")).toBe(true);
    expect(isValidUbn("10458575")).toBe(true);
  });
  it("rejects a flipped check digit", () => expect(isValidUbn("28080624")).toBe(false));
  it("rejects non-8-digit input", () => {
    expect(isValidUbn("123")).toBe(false);
    expect(isValidUbn("1234567x")).toBe(false);
    expect(isValidUbn("0000000000")).toBe(false);
  });
});

/** A valid built f0401 payload (B2C, 含稅 105). */
function validIssue(overrides: Record<string, unknown> = {}) {
  return {
    OrderId: "o1",
    BuyerIdentifier: "0000000000",
    BuyerName: "消費者",
    ProductItem: [{ Description: "商品", Quantity: 1, UnitPrice: 105, Amount: 105, TaxType: 1 }],
    SalesAmount: 105,
    FreeTaxSalesAmount: 0,
    ZeroTaxSalesAmount: 0,
    TaxType: 1,
    TaxRate: "0.05",
    TaxAmount: 0,
    TotalAmount: 105,
    ...overrides,
  };
}
const ok = (o: Record<string, unknown>) => amegoIssuePayloadSchema.safeParse(validIssue(o)).success;
const item = (o: Record<string, unknown>) =>
  amegoIssuePayloadSchema.safeParse(validIssue({ ProductItem: [{ Description: "x", Quantity: 1, UnitPrice: 105, Amount: 105, TaxType: 1, ...o }] })).success;

describe("amegoIssuePayloadSchema — buyer", () => {
  it("accepts a valid payload", () => expect(ok({})).toBe(true));
  it("rejects BuyerName 0/00/000/0000", () => {
    expect(ok({ BuyerName: "0000" })).toBe(false);
    expect(ok({ BuyerName: "00" })).toBe(false);
  });
  it("rejects empty BuyerName", () => expect(ok({ BuyerName: "" })).toBe(false));
  it("rejects a malformed 統編", () => {
    expect(ok({ BuyerIdentifier: "123" })).toBe(false);
    expect(ok({ BuyerIdentifier: "1234567x" })).toBe(false);
  });
  it("accepts a valid 統編 but rejects a bad checksum (Amego enforces it too)", () => {
    expect(ok({ BuyerIdentifier: "28080623" })).toBe(true);
    expect(ok({ BuyerIdentifier: "28080624" })).toBe(false);
  });
  it("rejects a malformed email (server silently accepts it)", () =>
    expect(ok({ BuyerEmailAddress: "not-an-email" })).toBe(false));
  it("accepts a valid email", () => expect(ok({ BuyerEmailAddress: "a@b.co" })).toBe(true));
  it("rejects MainRemark > 200", () => expect(ok({ MainRemark: "字".repeat(201) })).toBe(false));
});

describe("amegoIssuePayloadSchema — items", () => {
  it("rejects Description > 256", () => expect(item({ Description: "字".repeat(257) })).toBe(false));
  it("rejects Unit > 6", () => expect(item({ Unit: "1234567" })).toBe(false));
  it("rejects Remark > 120", () => expect(item({ Remark: "字".repeat(121) })).toBe(false));
  it("rejects RelateNumber > 50", () => expect(item({ RelateNumber: "x".repeat(51) })).toBe(false));
  it("rejects item TaxType outside 1–3", () => expect(item({ TaxType: 5 })).toBe(false));
  it("rejects > 7 decimal places on Quantity", () => expect(item({ Quantity: 1.123456789 })).toBe(false));
  it("allows a negative line Amount (e.g. discount)", () =>
    expect(item({ UnitPrice: -2, Amount: -2 })).toBe(true));
  it("requires at least one item", () => expect(ok({ ProductItem: [] })).toBe(false));
});

describe("amegoIssuePayloadSchema — amounts & tax", () => {
  it("rejects invoice TaxType outside 1/2/3/4/9", () => expect(ok({ TaxType: 7 })).toBe(false));
  it("rejects negative SalesAmount", () => expect(ok({ SalesAmount: -105, TotalAmount: 105 })).toBe(false));
  it("rejects a malformed Currency, accepts ISO 4217", () => {
    expect(ok({ Currency: "US" })).toBe(false);
    expect(ok({ Currency: "usd" })).toBe(false);
    expect(ok({ Currency: "USD" })).toBe(true);
  });
  it("rejects a non-numeric ExchangeRate", () =>
    expect(ok({ ExchangeRate: "abc" as unknown as number })).toBe(false));
});

describe("amegoIssuePayloadSchema — conditional rules", () => {
  it("rejects DetailVat=0 without a 統編, allows it with one", () => {
    expect(ok({ DetailVat: 0 })).toBe(false);
    expect(ok({ BuyerIdentifier: "28080623", DetailVat: 0 })).toBe(true);
  });
  it("requires a carrier code for known carrier types", () => {
    expect(ok({ CarrierType: "3J0002" })).toBe(false);
    expect(ok({ CarrierType: "3J0002", CarrierId1: "/ABC1234", CarrierId2: "/ABC1234" })).toBe(true);
  });
  it("validates member carrier (amego) id format", () => {
    expect(ok({ CarrierType: "amego", CarrierId1: "xyz" })).toBe(false);
    expect(ok({ CarrierType: "amego", CarrierId1: "a0912345678" })).toBe(true);
    expect(ok({ CarrierType: "amego", CarrierId1: "user@example.com" })).toBe(true);
  });
  it("requires CustomsClearanceMark + ZeroTaxRateReason for zero-rated", () => {
    const zero = { TaxType: 2, ProductItem: [{ Description: "x", Quantity: 1, UnitPrice: 100, Amount: 100, TaxType: 2 }], SalesAmount: 0, ZeroTaxSalesAmount: 100, TotalAmount: 100 };
    expect(ok(zero)).toBe(false);
    expect(ok({ ...zero, CustomsClearanceMark: 1, ZeroTaxRateReason: 71 })).toBe(true);
  });
  it("rejects a malformed NPOBAN", () => {
    expect(ok({ NPOBAN: "abc" })).toBe(false);
    expect(ok({ NPOBAN: "168" })).toBe(true);
  });
  it("validates printer + mark enums", () => {
    expect(ok({ PrinterLang: 9 })).toBe(false);
    expect(ok({ PrintMark: "X" })).toBe(false);
    expect(ok({ PrintMark: "Y" })).toBe(true);
    expect(ok({ GroupMark: "x" })).toBe(false);
    expect(ok({ GroupMark: "*" })).toBe(true);
  });

  it("accepts PrinterLang 3 (UTF-8) and a model-code PrinterType (verified live)", () => {
    expect(ok({ PrinterLang: 3 })).toBe(true);
    expect(ok({ PrinterType: 2, PrintDetail: 2 })).toBe(true);
    expect(ok({ PrintDetail: 5 })).toBe(false);
  });

  it("accepts TrackApiCode and BrandName", () =>
    expect(ok({ TrackApiCode: "API01", BrandName: "品牌" })).toBe(true));

  it("enforces TaxAdjustment=1 preconditions (server silently accepts violations)", () => {
    const b2bUntaxed = {
      BuyerIdentifier: "28080623",
      BuyerName: "光貿科技有限公司",
      DetailVat: 0,
      ProductItem: [{ Description: "x", Quantity: 1, UnitPrice: 110, Amount: 110, TaxType: 1 }],
      SalesAmount: 110, // 尾數 10 → 5% lands on x.5
      TaxAmount: 5,
      TotalAmount: 115,
    };
    expect(ok({ ...b2bUntaxed, TaxAdjustment: 1 })).toBe(true);
    // B2C / 含稅 → invalid even though Amego accepts it
    expect(ok({ TaxAdjustment: 1 })).toBe(false);
    // 統編 + DetailVat=0 but SalesAmount tail not in {10,30,50,70,90}
    expect(ok({ ...b2bUntaxed, SalesAmount: 100, TaxAdjustment: 1 })).toBe(false);
  });
});

describe("amegoCustomIssuePayloadSchema (f0401_custom)", () => {
  const validCustom = (o: Record<string, unknown> = {}) =>
    amegoCustomIssuePayloadSchema.safeParse(
      validIssue({ InvoiceNumber: "AA00000010", InvoiceDate: "20260617", InvoiceTime: "16:40:42", RandomNumber: "1234", PrintMark: "Y", order_id: "C1", OrderId: undefined, ...o }),
    ).success;

  it("accepts a valid custom record", () => expect(validCustom()).toBe(true));
  it("requires InvoiceNumber", () => expect(validCustom({ InvoiceNumber: undefined })).toBe(false));
  it("requires PrintMark (verified live)", () => expect(validCustom({ PrintMark: undefined })).toBe(false));
  it("PrintMark=N requires a carrier or donation", () => {
    expect(validCustom({ PrintMark: "N" })).toBe(false);
    expect(validCustom({ PrintMark: "N", NPOBAN: "168" })).toBe(true);
    expect(validCustom({ PrintMark: "N", CarrierType: "3J0002", CarrierId1: "/ABC1234" })).toBe(true);
  });
  it("requires InvoiceDate as YYYYMMDD", () => {
    expect(validCustom({ InvoiceDate: "2026-06-17" })).toBe(false);
    expect(validCustom({ InvoiceDate: "20260617" })).toBe(true);
  });
  it("requires InvoiceTime as hh:mm:ss", () => {
    expect(validCustom({ InvoiceTime: "164042" })).toBe(false);
    expect(validCustom({ InvoiceTime: "16:40:42" })).toBe(true);
  });
  it("rejects RandomNumber that isn't 4 digits", () => expect(validCustom({ RandomNumber: "12" })).toBe(false));
  it("rejects SellerPersonInCharge > 30", () => expect(validCustom({ SellerPersonInCharge: "人".repeat(31) })).toBe(false));
  it("requires order_id or OrderId", () => expect(validCustom({ order_id: undefined, OrderId: undefined })).toBe(false));
});

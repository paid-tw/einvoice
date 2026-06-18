import { describe, expect, it } from "vitest";
import { ecpayIssuePayloadSchema } from "./validation.js";
import { ecpayTaxType } from "./provider.js";

function valid(o: Record<string, unknown> = {}) {
  return {
    RelateNumber: "ORDER_1",
    Print: "0",
    Donation: "0",
    CarrierType: "1",
    CarrierNum: "",
    TaxType: "1",
    SalesAmount: 100,
    InvType: "07",
    Items: [
      {
        ItemSeq: 1,
        ItemName: "商品",
        ItemCount: 1,
        ItemWord: "式",
        ItemPrice: 100,
        ItemAmount: 100,
        ItemTaxType: "1",
      },
    ],
    ...o,
  };
}
const ok = (o: Record<string, unknown> = {}) => ecpayIssuePayloadSchema.safeParse(valid(o)).success;

describe("ecpayIssuePayloadSchema", () => {
  it("accepts a valid carrier invoice", () => expect(ok()).toBe(true));

  it("RelateNumber: required, ≤50 chars (live: 50 ok, 51 → 2001003)", () => {
    expect(ok({ RelateNumber: "" })).toBe(false);
    expect(ok({ RelateNumber: "x".repeat(50) })).toBe(true);
    expect(ok({ RelateNumber: "x".repeat(51) })).toBe(false);
  });

  it("CustomerEmail ≤80 chars (live: 82 → 2001010)", () => {
    expect(ok({ CustomerEmail: `${"a".repeat(70)}@example.com` })).toBe(false); // 82 chars
  });

  it("enforces SalesAmount = round(Σ ItemAmount) for vat=1, but is lenient for vat=0", () => {
    expect(ok({ SalesAmount: 999 })).toBe(false); // vat=1 default, mismatch
    // vat=0: the API recomputes, so a mismatch is tolerated (live-verified).
    expect(
      ok({
        vat: "0",
        SalesAmount: 105,
        Items: [
          {
            ItemSeq: 1,
            ItemName: "a",
            ItemCount: 1,
            ItemWord: "式",
            ItemPrice: 100,
            ItemAmount: 100,
            ItemTaxType: "1",
          },
        ],
      }),
    ).toBe(true);
  });

  it("paper invoices (Print=1) need name + address + email/phone", () => {
    expect(ok({ Print: "1", CarrierType: "" })).toBe(false);
    expect(ok({ Print: "1", CarrierType: "", CustomerName: "王", CustomerAddr: "台北" })).toBe(
      false,
    );
    expect(
      ok({
        Print: "1",
        CarrierType: "",
        CustomerName: "王",
        CustomerAddr: "台北",
        CustomerEmail: "a@b.c",
      }),
    ).toBe(true);
    expect(
      ok({
        Print: "1",
        CarrierType: "",
        CustomerName: "王",
        CustomerAddr: "台北",
        CustomerPhone: "0900000000",
      }),
    ).toBe(true);
  });

  it("a B2C carrier invoice cannot print (live: 5000015)", () => {
    expect(ok({ Print: "1" })).toBe(false); // carrier + Print=1
  });

  it("allows carrier + donation together (live情境一: accepted)", () => {
    expect(ok({ Donation: "1", CarrierType: "1", LoveCode: "168001" })).toBe(true);
    expect(ok({ Donation: "1", CarrierType: "", LoveCode: "" })).toBe(false); // still needs a love code
  });

  it("allows B2B + carrier (live情境二: accepted)", () => {
    // B2B + carrier1 + Print=0 (the valid() base carrier).
    expect(ok({ CustomerIdentifier: "53538851" })).toBe(true);
    // B2B + Print=0 + no carrier is rejected (live: 5000028).
    expect(ok({ CustomerIdentifier: "53538851", CarrierType: "", Print: "0" })).toBe(false);
  });

  it("zero-rated (TaxType 2) requires ClearanceMark (live: 5000007)", () => {
    const zero = {
      TaxType: "2",
      Items: [
        {
          ItemSeq: 1,
          ItemName: "a",
          ItemCount: 1,
          ItemWord: "式",
          ItemPrice: 100,
          ItemAmount: 100,
          ItemTaxType: "2",
        },
      ],
    };
    expect(ok(zero)).toBe(false); // no ClearanceMark
    expect(ok({ ...zero, ClearanceMark: "2" })).toBe(true); // ZeroTaxRateReason NOT required (live)
  });

  it("mixed tax (TaxType=9) needs ItemTaxType on every item + ClearanceMark", () => {
    expect(
      ok({
        TaxType: "9",
        ClearanceMark: "1",
        Items: [
          {
            ItemSeq: 1,
            ItemName: "a",
            ItemCount: 1,
            ItemWord: "式",
            ItemPrice: 100,
            ItemAmount: 100,
          },
        ],
      }),
    ).toBe(false);
  });

  it("validates field formats (Identifier 8 digits, LoveCode 3–7 digits)", () => {
    expect(ok({ CustomerIdentifier: "123" })).toBe(false);
    expect(ok({ Donation: "1", CarrierType: "", LoveCode: "12" })).toBe(false);
  });
});

describe("ecpayTaxType", () => {
  it("maps each unified tax type", () => {
    expect(ecpayTaxType("TAXABLE")).toBe("1");
    expect(ecpayTaxType("SPECIAL")).toBe("1");
    expect(ecpayTaxType("ZERO_RATED")).toBe("2");
    expect(ecpayTaxType("TAX_FREE")).toBe("3");
  });
});

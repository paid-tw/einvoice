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
    Items: [{ ItemSeq: 1, ItemName: "商品", ItemCount: 1, ItemWord: "式", ItemPrice: 100, ItemAmount: 100, ItemTaxType: "1" }],
    ...o,
  };
}
const ok = (o: Record<string, unknown> = {}) => ecpayIssuePayloadSchema.safeParse(valid(o)).success;

describe("ecpayIssuePayloadSchema", () => {
  it("accepts a valid carrier invoice", () => expect(ok()).toBe(true));

  it("RelateNumber: required, ≤30 chars", () => {
    expect(ok({ RelateNumber: "" })).toBe(false);
    expect(ok({ RelateNumber: "x".repeat(31) })).toBe(false);
  });

  it("enforces SalesAmount = Σ ItemPrice × ItemCount", () => {
    expect(ok({ SalesAmount: 999 })).toBe(false);
    expect(
      ok({
        SalesAmount: 250,
        Items: [
          { ItemSeq: 1, ItemName: "a", ItemCount: 1, ItemWord: "式", ItemPrice: 100, ItemAmount: 100, ItemTaxType: "1" },
          { ItemSeq: 2, ItemName: "b", ItemCount: 3, ItemWord: "式", ItemPrice: 50, ItemAmount: 150, ItemTaxType: "1" },
        ],
      }),
    ).toBe(true);
  });

  it("paper invoices (Print=1) need name + address + email/phone", () => {
    expect(ok({ Print: "1", CarrierType: "" })).toBe(false); // missing all
    expect(ok({ Print: "1", CarrierType: "", CustomerName: "王", CustomerAddr: "台北" })).toBe(false); // no email/phone
    expect(ok({ Print: "1", CarrierType: "", CustomerName: "王", CustomerAddr: "台北", CustomerEmail: "a@b.c" })).toBe(true);
    expect(ok({ Print: "1", CarrierType: "", CustomerName: "王", CustomerAddr: "台北", CustomerPhone: "0900000000" })).toBe(true);
  });

  it("carrier/donation invoices must not print (Print=0)", () => {
    expect(ok({ Print: "1" })).toBe(false); // carrier + Print=1
  });

  it("donation needs a love code and excludes a carrier", () => {
    expect(ok({ Donation: "1", CarrierType: "", LoveCode: "" })).toBe(false); // no love code
    expect(ok({ Donation: "1", CarrierType: "", LoveCode: "168001" })).toBe(true);
    expect(ok({ Donation: "1", LoveCode: "168001" })).toBe(false); // carrier + donation
  });

  it("B2B (CustomerIdentifier) cannot use a carrier", () => {
    expect(ok({ CustomerIdentifier: "53538851" })).toBe(false); // has carrier
    expect(
      ok({ CustomerIdentifier: "53538851", CarrierType: "", Print: "1", CustomerName: "公司", CustomerAddr: "台北", CustomerEmail: "a@b.c" }),
    ).toBe(true);
  });

  it("validates field formats (Identifier 8 digits, LoveCode 3–7 digits)", () => {
    expect(ok({ CustomerIdentifier: "123", CarrierType: "" })).toBe(false);
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

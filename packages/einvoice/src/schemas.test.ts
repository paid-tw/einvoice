import { describe, expect, it } from "vitest";
import { carrierSchema, issueInvoiceInputSchema } from "./schemas.js";
import type { IssueInvoiceInput } from "./types.js";

const valid: IssueInvoiceInput = {
  orderId: "o1",
  buyer: {},
  items: [{ description: "x", quantity: 1, unitPrice: 100, amount: 100 }],
  amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
  taxType: "TAXABLE",
  priceMode: "TAX_INCLUSIVE",
};

describe("issueInvoiceInputSchema", () => {
  it("accepts a well-formed invoice", () => {
    expect(issueInvoiceInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects when total ≠ sales + tax", () => {
    const r = issueInvoiceInputSchema.safeParse({
      ...valid,
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 999 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects carrier + donation together", () => {
    const r = issueInvoiceInputSchema.safeParse({
      ...valid,
      carrier: { type: "MOBILE_BARCODE", code: "/ABC1234" },
      donation: { npoban: "168" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects donating a B2B invoice", () => {
    const r = issueInvoiceInputSchema.safeParse({
      ...valid,
      buyer: { ubn: "28080623" },
      donation: { npoban: "168" },
    });
    expect(r.success).toBe(false);
  });

  it("accepts a foreign currency with an exchange rate", () => {
    const r = issueInvoiceInputSchema.safeParse({ ...valid, currency: "USD", exchangeRate: 31.5 });
    expect(r.success).toBe(true);
  });

  it("requires exchangeRate when currency is not TWD", () => {
    const r = issueInvoiceInputSchema.safeParse({ ...valid, currency: "USD" });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed currency code", () => {
    expect(issueInvoiceInputSchema.safeParse({ ...valid, currency: "usd" }).success).toBe(false);
    expect(issueInvoiceInputSchema.safeParse({ ...valid, currency: "DOLLAR" }).success).toBe(false);
  });

  it("allows TWD without an exchange rate", () => {
    expect(issueInvoiceInputSchema.safeParse({ ...valid, currency: "TWD" }).success).toBe(true);
  });
});

describe("carrierSchema", () => {
  it("validates a mobile-barcode format", () => {
    expect(carrierSchema.safeParse({ type: "MOBILE_BARCODE", code: "/ABC1234" }).success).toBe(true);
    expect(carrierSchema.safeParse({ type: "MOBILE_BARCODE", code: "bad" }).success).toBe(false);
  });
});

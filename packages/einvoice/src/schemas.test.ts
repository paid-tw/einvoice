import { describe, expect, it } from "vitest";
import { InvoiceError } from "./errors.js";
import {
  allowanceInputSchema,
  carrierSchema,
  issueInvoiceInputSchema,
  parseInput,
} from "./schemas.js";
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

describe("allowanceInputSchema (shared amountSummarySchema invariant)", () => {
  const validAllowance = {
    invoiceNumber: "AB12345678",
    allowanceId: "a1",
    items: [{ description: "x", quantity: 1, unitPrice: 100, amount: 100 }],
    amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
  };

  it("accepts a consistent allowance amount", () => {
    expect(allowanceInputSchema.safeParse(validAllowance).success).toBe(true);
  });

  it("rejects an inconsistent allowance amount (total ≠ sales + tax)", () => {
    const r = allowanceInputSchema.safeParse({
      ...validAllowance,
      amount: { salesAmount: 100, taxAmount: 50, totalAmount: 999 },
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["amount", "totalAmount"]);
  });
});

describe("parseInput", () => {
  it("returns the parsed data on success", () => {
    expect(parseInput(issueInvoiceInputSchema, valid, "amego")).toMatchObject({ orderId: "o1" });
  });

  it("throws an InvoiceError(VALIDATION) — not a ZodError — on failure", () => {
    let thrown: unknown;
    try {
      parseInput(
        issueInvoiceInputSchema,
        { ...valid, amount: { salesAmount: 100, taxAmount: 5, totalAmount: 999 } },
        "ecpay",
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InvoiceError);
    const err = thrown as InvoiceError;
    expect(err.code).toBe("VALIDATION");
    expect(err.provider).toBe("ecpay");
    expect(err.message).toMatch(/totalAmount/);
    expect(Array.isArray(err.raw)).toBe(true); // the Zod issues are preserved
  });
});

describe("carrierSchema", () => {
  it("validates a mobile-barcode format", () => {
    expect(carrierSchema.safeParse({ type: "MOBILE_BARCODE", code: "/ABC1234" }).success).toBe(
      true,
    );
    expect(carrierSchema.safeParse({ type: "MOBILE_BARCODE", code: "bad" }).success).toBe(false);
  });
});

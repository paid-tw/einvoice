import { describe, expect, it } from "vitest";
import { InvoiceError } from "./errors.js";
import { MockProvider } from "./mock.js";
import { composeTaxExclusive } from "./utils.js";
import type { IssueInvoiceInput } from "./types.js";

function sampleInput(overrides: Partial<IssueInvoiceInput> = {}): IssueInvoiceInput {
  const amount = composeTaxExclusive(1000);
  return {
    orderId: "order-1",
    buyer: { email: "buyer@example.com" },
    items: [
      { description: "訂閱方案", quantity: 1, unitPrice: 1000, amount: 1000 },
    ],
    amount,
    taxType: "TAXABLE",
    priceMode: "TAX_EXCLUSIVE",
    ...overrides,
  };
}

describe("MockProvider", () => {
  it("issues an invoice and echoes the orderId", async () => {
    const provider = new MockProvider();
    const result = await provider.issue(sampleInput());
    expect(result.invoiceNumber).toMatch(/^MK\d{8}$/);
    expect(result.orderId).toBe("order-1");
    expect(result.totalAmount).toBe(1050);
    expect(result.status).toBe("ISSUED");
  });

  it("queries by orderId", async () => {
    const provider = new MockProvider();
    const issued = await provider.issue(sampleInput());
    const found = await provider.query({ orderId: "order-1" });
    expect(found.invoiceNumber).toBe(issued.invoiceNumber);
  });

  it("rejects voiding an unknown invoice with NOT_FOUND", async () => {
    const provider = new MockProvider();
    await expect(
      provider.void({ invoiceNumber: "MK99999999", reason: "test" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<InvoiceError>);
  });

  it("rejects an invoice that uses both carrier and donation", async () => {
    const provider = new MockProvider();
    await expect(
      provider.issue(
        sampleInput({
          carrier: { type: "MOBILE_BARCODE", code: "/ABC1234" },
          donation: { npoban: "168" },
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("voids an issued invoice, then rejects a second void with CONFLICT", async () => {
    const provider = new MockProvider();
    const { invoiceNumber } = await provider.issue(sampleInput());
    const voided = await provider.void({ invoiceNumber, reason: "退款" });
    expect(voided.status).toBe("VOIDED");
    await expect(provider.void({ invoiceNumber, reason: "again" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("records an allowance and reflects ALLOWANCE status on query", async () => {
    const provider = new MockProvider();
    const { invoiceNumber } = await provider.issue(sampleInput());
    const allowance = await provider.allowance({
      invoiceNumber,
      allowanceId: "ALW-1",
      items: [{ description: "退款", quantity: 1, unitPrice: 1000, amount: 1000 }],
      amount: composeTaxExclusive(1000),
    });
    expect(allowance.allowanceNumber).toMatch(/^AL\d{8}$/);
    const found = await provider.query({ invoiceNumber });
    expect(found.status).toBe("ALLOWANCE");
    const cancel = await provider.voidAllowance({
      invoiceNumber,
      allowanceNumber: allowance.allowanceNumber,
    });
    expect(cancel.allowanceNumber).toBe(allowance.allowanceNumber);
  });

  it("rejects an allowance against an unknown invoice", async () => {
    const provider = new MockProvider();
    await expect(
      provider.allowance({
        invoiceNumber: "MK00000000",
        allowanceId: "ALW-X",
        items: [{ description: "x", quantity: 1, unitPrice: 1, amount: 1 }],
        amount: { salesAmount: 1, taxAmount: 0, totalAmount: 1 },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a query that matches nothing", async () => {
    const provider = new MockProvider();
    await expect(provider.query({ orderId: "nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

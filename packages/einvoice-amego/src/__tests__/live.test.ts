import { beforeAll, describe, expect, it } from "vitest";
import { createAmegoProvider } from "../provider.js";

/**
 * Live lifecycle test against the real Amego sandbox. Skipped unless AMEGO_LIVE=1
 * so the normal/CI suite stays offline and deterministic.
 *
 *   AMEGO_LIVE=1 \
 *   AMEGO_SELLER=12345678 \
 *   AMEGO_APP_KEY=... \
 *   pnpm --filter @paid-tw/einvoice-amego exec vitest run live
 */
const live = process.env.AMEGO_LIVE === "1";

describe.skipIf(!live)("Amego live lifecycle", () => {
  const provider = createAmegoProvider({
    sellerTaxId: process.env.AMEGO_SELLER ?? "12345678",
    appKey: process.env.AMEGO_APP_KEY ?? "",
  });

  let invoiceNumber: string;

  beforeAll(async () => {
    const res = await provider.issue({
      orderId: `IT${Date.now()}`,
      buyer: { taxId: "28080623", name: "光貿科技有限公司" },
      items: [{ description: "整合測試商品", quantity: 1, unitPrice: 105, amount: 105 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
      taxType: "TAXABLE",
      priceMode: "TAX_INCLUSIVE",
    });
    invoiceNumber = res.invoiceNumber;
    expect(invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
  });

  it("queries the issued invoice (nested data, type discriminator)", async () => {
    const res = await provider.query({ invoiceNumber });
    expect(res.amount.totalAmount).toBe(105);
    expect(res.buyer.taxId).toBe("28080623");
    expect(res.items.length).toBeGreaterThan(0);
  });

  it("looks up a company name (array payload)", async () => {
    const res = await provider.banQuery("28080623");
    expect(res.code).toBe(0);
  });

  it("queries by orderId (type:'order')", async () => {
    const orderId = String((await provider.query({ invoiceNumber })).orderId);
    const res = await provider.query({ orderId });
    expect(res.invoiceNumber).toBe(invoiceNumber);
  });

  it("lists invoices with real date filters and returns data (regression: was silently empty)", async () => {
    const res = await provider.invoice.list({
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      limit: 20,
    });
    expect(res.code).toBe(0);
    // The bug returned data_total:0 with wrong field names; correct fields return rows.
    expect(Number(res.data_total)).toBeGreaterThan(0);
    expect(Array.isArray(res.data)).toBe(true);
  });

  it("issues a foreign-currency (USD) invoice — amounts stay TWD", async () => {
    const res = await provider.issue({
      orderId: `IU${Date.now()}`,
      buyer: {},
      items: [{ description: "cross-border", quantity: 1, unitPrice: 105, amount: 105 }],
      amount: { salesAmount: 105, taxAmount: 0, totalAmount: 105 },
      taxType: "TAXABLE",
      priceMode: "TAX_INCLUSIVE",
      currency: "USD",
      exchangeRate: 31.5,
    });
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
  });

  it("voids the invoice (array payload, no CancelReason)", async () => {
    const res = await provider.void({ invoiceNumber, reason: "整合測試作廢" });
    expect(res.status).toBe("VOIDED");
  });
});

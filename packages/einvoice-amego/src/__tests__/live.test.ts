import { describe, expect, it } from "vitest";
import { createAmegoProvider } from "../provider.js";

/**
 * Live smoke test against the real Amego sandbox. Skipped unless AMEGO_LIVE=1 to
 * keep the normal/CI suite offline and deterministic.
 *
 *   AMEGO_LIVE=1 \
 *   AMEGO_SELLER=12345678 \
 *   AMEGO_APP_KEY=sHeq7t8G1wiQvhAuIM27 \
 *   pnpm --filter @paid-tw/einvoice-amego exec vitest run live
 */
const live = process.env.AMEGO_LIVE === "1";

describe.skipIf(!live)("Amego live sandbox", () => {
  const provider = createAmegoProvider({
    sellerTaxId: process.env.AMEGO_SELLER ?? "12345678",
    appKey: process.env.AMEGO_APP_KEY ?? "sHeq7t8G1wiQvhAuIM27",
  });

  it("returns server time", async () => {
    const res = await provider.time();
    expect(res.code).toBe(0);
  });

  it("issues a real B2C invoice and gets a number back", async () => {
    const res = await provider.issue({
      orderId: `IT${Date.now()}`,
      buyer: {},
      items: [{ description: "整合測試商品", quantity: 1, unitPrice: 105, amount: 105 }],
      amount: { salesAmount: 105, taxAmount: 0, totalAmount: 105 },
      taxType: "TAXABLE",
      priceMode: "TAX_INCLUSIVE",
    });
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
    expect(res.randomCode).toMatch(/^\d{4}$/);
  });

  it("issues a real B2B invoice (statutory number)", async () => {
    const res = await provider.issue({
      orderId: `IB${Date.now()}`,
      buyer: { taxId: "28080623", name: "光貿科技有限公司" },
      items: [{ description: "整合測試商品", quantity: 1, unitPrice: 168, amount: 168 }],
      amount: { salesAmount: 160, taxAmount: 8, totalAmount: 168 },
      taxType: "TAXABLE",
      priceMode: "TAX_INCLUSIVE",
    });
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
  });
});

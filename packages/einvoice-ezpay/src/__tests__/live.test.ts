import { describe, expect, it } from "vitest";
import { createEzpayProvider } from "../provider.js";

/**
 * Live test against the ezPay TEST environment (cinv). Skipped unless
 * EZPAY_LIVE=1 so the normal/CI suite stays offline.
 *
 *   EZPAY_LIVE=1 EZPAY_MERCHANT_ID=… EZPAY_HASH_KEY=… EZPAY_HASH_IV=… \
 *   pnpm exec vitest run ezpay/src/__tests__/live
 */
const live =
  process.env.EZPAY_LIVE === "1" &&
  Boolean(process.env.EZPAY_MERCHANT_ID && process.env.EZPAY_HASH_KEY && process.env.EZPAY_HASH_IV);

describe.skipIf(!live)("ezPay live (test env)", () => {
  const provider = createEzpayProvider({
    merchantId: process.env.EZPAY_MERCHANT_ID!,
    hashKey: process.env.EZPAY_HASH_KEY!,
    hashIV: process.env.EZPAY_HASH_IV!,
    mode: "TEST",
  });

  let invoiceNumber: string;
  let randomCode: string;
  const orderId = `IT${Date.now()}`;

  it("issues a real B2C invoice (AES encryption verified end-to-end)", async () => {
    const res = await provider.issue({
      orderId,
      buyer: {},
      items: [{ description: "整合測試商品", quantity: 1, unitPrice: 105, amount: 105 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
      taxType: "TAXABLE",
      priceMode: "TAX_INCLUSIVE",
    });
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
    expect(res.randomCode).toMatch(/^\d{4}$/);
    invoiceNumber = res.invoiceNumber;
    randomCode = res.randomCode;
  });

  it("queries the issued invoice (SearchType 0: invoice + random)", async () => {
    const res = await provider.query({ invoiceNumber, providerOptions: { randomNum: randomCode } });
    expect(res.amount.totalAmount).toBe(105);
  });

  it("voids the issued invoice (full lifecycle)", async () => {
    const res = await provider.void({ invoiceNumber, reason: "整合測試作廢" });
    expect(res.status).toBe("VOIDED");
  });
});

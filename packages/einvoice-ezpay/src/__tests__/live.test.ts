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

describe.skipIf(!live)("ezPay live — allowance lifecycle", () => {
  const provider = createEzpayProvider({
    merchantId: process.env.EZPAY_MERCHANT_ID!,
    hashKey: process.env.EZPAY_HASH_KEY!,
    hashIV: process.env.EZPAY_HASH_IV!,
    mode: "TEST",
  });

  const orderId = `AL${Date.now()}`;
  let invoiceNumber: string;
  let allowanceNumber: string;

  it("issues a B2B invoice to credit", async () => {
    const res = await provider.issue({
      orderId,
      buyer: { ubn: "28080623", name: "光貿科技股份有限公司" },
      items: [{ description: "折讓測試商品", quantity: 1, unitPrice: 100, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
      taxType: "TAXABLE",
      priceMode: "TAX_EXCLUSIVE",
    });
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
    invoiceNumber = res.invoiceNumber;
  });

  it("opens an allowance (allowance_issue) and returns the AllowanceNo", async () => {
    const res = await provider.allowance({
      invoiceNumber,
      allowanceId: orderId,
      items: [{ description: "折讓測試商品", quantity: 1, unitPrice: 100, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
      providerOptions: { merchantOrderNo: orderId },
    });
    expect(res.allowanceNumber).toMatch(/^[A-Z]/);
    allowanceNumber = res.allowanceNumber;
  });

  it("voids the allowance (allowanceInvalid)", async () => {
    const res = await provider.voidAllowance({ invoiceNumber, allowanceNumber, reason: "測試作廢折讓" });
    expect(res.allowanceNumber).toBe(allowanceNumber);
  });
});

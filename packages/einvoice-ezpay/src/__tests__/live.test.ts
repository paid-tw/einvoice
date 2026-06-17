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

  it("issues a real B2C invoice (AES + response CheckCode verified end-to-end)", async () => {
    // verifyCheckCode defaults to true, so a successful issue here means the
    // live response's CheckCode matched our locally recomputed value.
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

describe.skipIf(!live)("ezPay live — 觸發開立 lifecycle", () => {
  const provider = createEzpayProvider({
    merchantId: process.env.EZPAY_MERCHANT_ID!,
    hashKey: process.env.EZPAY_HASH_KEY!,
    hashIV: process.env.EZPAY_HASH_IV!,
    mode: "TEST",
  });

  const orderId = `TI${Date.now()}`;
  let invoiceTransNo: string;
  let invoiceNumber: string;

  it("creates a held invoice (Status=0) returning an InvoiceTransNo, no number yet", async () => {
    const res = await provider.issuePending({
      orderId,
      buyer: {},
      items: [{ description: "觸發測試商品", quantity: 1, unitPrice: 105, amount: 105 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
      taxType: "TAXABLE",
      priceMode: "TAX_INCLUSIVE",
    });
    expect(res.invoiceTransNo).toMatch(/^\d+$/);
    invoiceTransNo = res.invoiceTransNo;
  });

  it("triggers the held invoice (invoice_touch_issue) → real InvoiceNumber", async () => {
    const res = await provider.triggerIssue({ invoiceTransNo, orderId, totalAmount: 105 });
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
    invoiceNumber = res.invoiceNumber;
  });

  it("voids the issued invoice (cleanup)", async () => {
    const res = await provider.void({ invoiceNumber, reason: "觸發測試作廢" });
    expect(res.status).toBe("VOIDED");
  });
});

describe.skipIf(!live)("ezPay live — 手機條碼/愛心碼驗證", () => {
  const provider = createEzpayProvider({
    merchantId: process.env.EZPAY_MERCHANT_ID!,
    hashKey: process.env.EZPAY_HASH_KEY!,
    hashIV: process.env.EZPAY_HASH_IV!,
    mode: "TEST",
  });

  // Covers IsExist=N: an unregistered barcode.
  it("validateMobileBarcode returns false for an unregistered barcode", async () => {
    expect(await provider.validateMobileBarcode("/ABC1234")).toBe(false);
  });

  // Covers IsExist=Y + the 'Lovecode' response-key casing quirk.
  it("validateLoveCode returns true for a registered love code (8585)", async () => {
    expect(await provider.validateLoveCode("8585")).toBe(true);
  });
});

describe.skipIf(!live)("ezPay live — 觸發折讓 (held → cancel)", () => {
  const provider = createEzpayProvider({
    merchantId: process.env.EZPAY_MERCHANT_ID!,
    hashKey: process.env.EZPAY_HASH_KEY!,
    hashIV: process.env.EZPAY_HASH_IV!,
    mode: "TEST",
  });

  const orderId = `TA${Date.now()}`;
  let invoiceNumber: string;
  let allowanceNumber: string;

  it("issues a B2B invoice to credit", async () => {
    const res = await provider.issue({
      orderId,
      buyer: { ubn: "28080623", name: "光貿科技股份有限公司" },
      items: [{ description: "折讓觸發商品", quantity: 1, unitPrice: 100, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
      taxType: "TAXABLE",
      priceMode: "TAX_EXCLUSIVE",
    });
    invoiceNumber = res.invoiceNumber;
    expect(invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
  });

  it("opens a held allowance (Status=0)", async () => {
    const res = await provider.allowance({
      invoiceNumber,
      allowanceId: orderId,
      items: [{ description: "折讓觸發商品", quantity: 1, unitPrice: 100, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
      providerOptions: { merchantOrderNo: orderId, status: "0" },
    });
    expect(res.allowanceNumber).toMatch(/^[A-Z]/);
    allowanceNumber = res.allowanceNumber;
  });

  it("cancels the held allowance (allowance_touch_issue, AllowanceStatus=D)", async () => {
    const res = await provider.triggerAllowance({
      allowanceNumber,
      orderId,
      totalAmount: 105,
      action: "CANCEL",
      invoiceNumber,
    });
    expect(res.allowanceNumber).toBe(allowanceNumber);
  });
});

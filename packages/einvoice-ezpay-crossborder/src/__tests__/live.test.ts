import { describe, expect, it } from "vitest";
import { EZPAY_CB_CURRENCIES } from "../currencies.js";
import { createEzpayCrossBorderProvider } from "../provider.js";

/**
 * Live test against the ezPay 境外電商 TEST environment (cinv). Skipped unless
 * EZPAY_CB_LIVE=1 so the normal/CI suite stays offline. Needs a cross-border
 * (境外電商) merchant — a standard ezPay merchant returns INV10023.
 *
 *   EZPAY_CB_LIVE=1 EZPAY_MERCHANT_ID=… EZPAY_HASH_KEY=… EZPAY_HASH_IV=… \
 *   pnpm exec vitest run ezpay-crossborder/src/__tests__/live
 */
const live =
  process.env.EZPAY_CB_LIVE === "1" &&
  Boolean(process.env.EZPAY_MERCHANT_ID && process.env.EZPAY_HASH_KEY && process.env.EZPAY_HASH_IV);

const LIVE_OPTS = { retry: 2 } as const;

const provider = () =>
  createEzpayCrossBorderProvider({
    merchantId: process.env.EZPAY_MERCHANT_ID!,
    hashKey: process.env.EZPAY_HASH_KEY!,
    hashIV: process.env.EZPAY_HASH_IV!,
    mode: "TEST",
  });

const buyer = { name: "跨境測試", email: "test@example.com" };
const oid = (p: string) => `${p}${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe.skipIf(!live)("ezPay cross-border live (test env) — TWD lifecycle", LIVE_OPTS, () => {
  const p = provider();
  const orderId = oid("CT");

  it("issues a TWD invoice, queries it by orderId, then voids it", async () => {
    const res = await p.issue({
      orderId,
      buyer,
      items: [{ description: "跨境商品", quantity: 1, unitPrice: 105, amount: 105 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
      taxType: "TAXABLE",
      priceMode: "TAX_INCLUSIVE",
    });
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
    expect(res.randomCode).toMatch(/^\d{4}$/);

    const q = await p.query({ orderId, providerOptions: { totalAmount: 105, currency: "TWD" } });
    expect(q.invoiceNumber).toBe(res.invoiceNumber);
    expect(q.amount).toEqual({ salesAmount: 100, taxAmount: 5, totalAmount: 105 });
    expect(q.status).toBe("ISSUED");
    expect(q.items.length).toBeGreaterThan(0);
    expect(q.buyer.email).toBe("test@example.com");

    const v = await p.void({ invoiceNumber: res.invoiceNumber, reason: "測試作廢" });
    expect(v.status).toBe("VOIDED");
  });
});

describe.skipIf(!live)("ezPay cross-border live (test env) — foreign currency", LIVE_OPTS, () => {
  const p = provider();

  it("issues a USD invoice with 2-decimal amounts and reads them back", async () => {
    const orderId = oid("CU");
    const res = await p.issue({
      orderId,
      buyer,
      items: [{ description: "Service", quantity: 1, unitPrice: 21.3, amount: 21.3 }],
      amount: { salesAmount: 20.3, taxAmount: 1, totalAmount: 21.3 },
      taxType: "TAXABLE",
      priceMode: "TAX_INCLUSIVE",
      currency: "USD",
      exchangeRate: 31.5,
    });
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
    expect(res.totalAmount).toBeCloseTo(21.3, 2);

    const q = await p.query({
      invoiceNumber: res.invoiceNumber,
      providerOptions: { randomCode: res.randomCode },
    });
    expect(q.amount.totalAmount).toBeCloseTo(21.3, 2);
    expect(q.amount.taxAmount).toBeCloseTo(1, 2);
  });
});

describe.skipIf(!live)(
  "ezPay cross-border live (test env) — allowance + two-phase",
  LIVE_OPTS,
  () => {
    const p = provider();

    it("issues an allowance (immediate confirm) then voids it", async () => {
      const orderId = oid("CA");
      const inv = await p.issue({
        orderId,
        buyer,
        items: [{ description: "商品", quantity: 2, unitPrice: 105, amount: 210 }],
        amount: { salesAmount: 200, taxAmount: 10, totalAmount: 210 },
        taxType: "TAXABLE",
        priceMode: "TAX_INCLUSIVE",
      });
      const al = await p.allowance({
        invoiceNumber: inv.invoiceNumber,
        allowanceId: orderId,
        items: [{ description: "商品", quantity: 1, unitPrice: 105, amount: 105 }],
        amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
        providerOptions: {
          currency: "TWD",
          buyerEmail: "test@example.com",
          merchantOrderNo: orderId,
          confirm: true,
        },
      });
      expect(al.allowanceNumber).toMatch(/^A\d+$/);
      const va = await p.voidAllowance({
        invoiceNumber: inv.invoiceNumber,
        allowanceNumber: al.allowanceNumber,
        reason: "測試",
      });
      expect(va.allowanceNumber).toBe(al.allowanceNumber);
    });

    it("stages a TRIGGER invoice then triggers it", async () => {
      const orderId = oid("CP");
      const pend = await p.issuePending({
        orderId,
        buyer,
        items: [{ description: "商品", quantity: 1, unitPrice: 105, amount: 105 }],
        amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
        taxType: "TAXABLE",
        priceMode: "TAX_INCLUSIVE",
      });
      expect(pend.invoiceTransNo).toMatch(/^\d+$/);
      const trig = await p.triggerIssue({
        invoiceTransNo: pend.invoiceTransNo,
        orderId,
        totalAmount: 105,
      });
      expect(trig.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
      expect(trig.status).toBe("ISSUED");
    });
  },
);

describe.skipIf(!live)(
  "ezPay cross-border live (test env) — every currency (附件三)",
  LIVE_OPTS,
  () => {
    const p = provider();

    it.each(EZPAY_CB_CURRENCIES)("issues a %s invoice", async (currency) => {
      const foreign = currency !== "TWD";
      const res = await p.issue({
        orderId: oid("CC"),
        buyer,
        items: [{ description: `${currency}商品`, quantity: 1, unitPrice: 21, amount: 21 }],
        amount: { salesAmount: 20, taxAmount: 1, totalAmount: 21 },
        taxType: "TAXABLE",
        priceMode: "TAX_INCLUSIVE",
        currency,
        ...(foreign ? { exchangeRate: 1 } : {}),
      });
      expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
    });

    // Verified live: a currency outside 附件三 is rejected with INV10002.
    it.each(["INR", "BRL", "ZZZ"])(
      "rejects unlisted currency %s with INV10002",
      async (currency) => {
        await expect(
          p.issue({
            orderId: oid("CX"),
            buyer,
            items: [{ description: "x", quantity: 1, unitPrice: 21, amount: 21 }],
            amount: { salesAmount: 20, taxAmount: 1, totalAmount: 21 },
            taxType: "TAXABLE",
            priceMode: "TAX_INCLUSIVE",
            currency,
            exchangeRate: 1,
          }),
        ).rejects.toMatchObject({ code: "VALIDATION", rawCode: "INV10002" });
      },
    );
  },
);

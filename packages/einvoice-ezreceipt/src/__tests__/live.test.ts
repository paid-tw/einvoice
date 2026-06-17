import { describe, expect, it } from "vitest";
import { createEzreceiptProvider } from "../provider.js";

/**
 * Live test against the ezReceipt 易發票 (COIMOTION) TEST environment. Skipped
 * unless EZRECEIPT_LIVE=1 and the creds are present. Uses a DEDICATED API account
 * (not the web-backend account — a shared account would fight over the token).
 *
 *   EZRECEIPT_LIVE=1 EZRECEIPT_APPCODE=… EZRECEIPT_APPKEY=… EZRECEIPT_ACCNAME=… \
 *   EZRECEIPT_PASSWORD=… pnpm exec vitest run ezreceipt/src/__tests__/live
 */
const env = process.env;
const live =
  env.EZRECEIPT_LIVE === "1" &&
  Boolean(env.EZRECEIPT_APPCODE && env.EZRECEIPT_APPKEY && env.EZRECEIPT_ACCNAME && env.EZRECEIPT_PASSWORD);

const LIVE_OPTS = { retry: 2 } as const;

const provider = () =>
  createEzreceiptProvider({
    appCode: env.EZRECEIPT_APPCODE!,
    appKey: env.EZRECEIPT_APPKEY!,
    accName: env.EZRECEIPT_ACCNAME!,
    password: env.EZRECEIPT_PASSWORD!,
    mode: "TEST",
  });

const member = () => `live_m_${Date.now()}${Math.floor(Math.random() * 1000)}`;
const order = () => `LO${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe.skipIf(!live)("ezReceipt live (test env) — B2C lifecycle", LIVE_OPTS, () => {
  const p = provider();

  it("issues → queries → allowances → voids the allowance → voids the invoice", async () => {
    const m = member();
    const inv = await p.issue({
      orderId: order(),
      buyer: { name: "測試買受人", email: m },
      items: [{ description: "live商品", quantity: 2, unitPrice: 50, amount: 100, unit: "件" }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
      taxType: "TAXABLE",
      priceMode: "TAX_EXCLUSIVE",
      carrier: { type: "MEMBER", code: m },
    });
    expect(inv.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);

    // query by invoice number (resolves the internal invID via invoice/list)
    const q = await p.query({ invoiceNumber: inv.invoiceNumber });
    expect(q.invoiceNumber).toBe(inv.invoiceNumber);
    expect(q.amount).toEqual({ salesAmount: 100, taxAmount: 5, totalAmount: 105 });
    expect(q.status).toBe("ISSUED");
    expect(q.items.length).toBeGreaterThan(0);

    const al = await p.allowance({
      invoiceNumber: inv.invoiceNumber,
      allowanceId: order(),
      items: [{ description: "live商品", quantity: 2, unitPrice: 50, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
    });
    expect(al.allowanceNumber).toMatch(/^S/);

    // No providerOptions.awID — the provider resolves it from awNo via allowance/list.
    const va = await p.voidAllowance({
      invoiceNumber: inv.invoiceNumber,
      allowanceNumber: al.allowanceNumber,
      reason: "live測試",
    });
    expect(va.allowanceNumber).toBe(al.allowanceNumber);

    const v = await p.void({ invoiceNumber: inv.invoiceNumber, reason: "live作廢" });
    expect(v.status).toBe("VOIDED");
    expect((await p.query({ invoiceNumber: inv.invoiceNumber })).status).toBe("VOIDED");
  });
});

describe.skipIf(!live)("ezReceipt live (test env) — variants", LIVE_OPTS, () => {
  const p = provider();
  const base = {
    items: [{ description: "商品", quantity: 1, unitPrice: 100, amount: 100 }],
    amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
    taxType: "TAXABLE" as const,
    priceMode: "TAX_EXCLUSIVE" as const,
  };

  it("issues a B2B invoice (issueTo 統編)", async () => {
    const res = await p.issue({ ...base, orderId: order(), buyer: { ubn: "53538851", name: "歐付寶測試", address: "台北市" } });
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
  });

  it("issues a mobile-barcode invoice", async () => {
    const res = await p.issue({ ...base, orderId: order(), buyer: {}, carrier: { type: "MOBILE_BARCODE", code: "/ABC1234" } });
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
  });

  it("lists the merchant's 字軌 tracks (extension)", async () => {
    const tracks = await p.listInvoiceTracks();
    expect(Array.isArray(tracks)).toBe(true);
    if (tracks.length) {
      expect(tracks[0]!.lead).toMatch(/^[A-Z]{2}$/);
      expect(String(tracks[0]!.startNo)).toMatch(/^\d{8}$/);
    }
  });

  it("issues a mixed-tax invoice (應稅 + 免稅)", async () => {
    const m = member();
    const res = await p.issue({
      orderId: order(),
      buyer: { name: "x", email: m },
      items: [
        { description: "應稅", quantity: 1, unitPrice: 100, amount: 100, taxType: "TAXABLE" },
        { description: "免稅", quantity: 1, unitPrice: 50, amount: 50, taxType: "TAX_FREE" },
      ],
      amount: { salesAmount: 150, taxAmount: 5, totalAmount: 155 },
      taxType: "TAXABLE",
      priceMode: "TAX_EXCLUSIVE",
      carrier: { type: "MEMBER", code: m },
    });
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
  });
});

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
  Boolean(
    env.EZRECEIPT_APPCODE &&
    env.EZRECEIPT_APPKEY &&
    env.EZRECEIPT_ACCNAME &&
    env.EZRECEIPT_PASSWORD,
  );

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
    const res = await p.issue({
      ...base,
      orderId: order(),
      buyer: { ubn: "53538851", name: "歐付寶測試", address: "台北市" },
    });
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
  });

  it("issues a mobile-barcode invoice", async () => {
    const res = await p.issue({
      ...base,
      orderId: order(),
      buyer: {},
      carrier: { type: "MOBILE_BARCODE", code: "/ABC1234" },
    });
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
  });

  it("issues a mobile-barcode invoice annotated with a 統編 (carrier + issueTo)", async () => {
    const res = await p.issue({
      ...base,
      orderId: order(),
      buyer: { name: "歐付寶測試", ubn: "53538851" },
      carrier: { type: "MOBILE_BARCODE", code: "/ABC1234" },
    });
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
    const q = await p.query({ invoiceNumber: res.invoiceNumber });
    expect(q.buyer.ubn).toBe("53538851");
  });

  it("issues a zero-rated invoice (zeroTaxReason + isCustom)", async () => {
    const m = member();
    const res = await p.issue({
      orderId: order(),
      buyer: { name: "零稅率", email: m },
      items: [{ description: "外銷商品", quantity: 1, unitPrice: 100, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 0, totalAmount: 100 },
      taxType: "ZERO_RATED",
      priceMode: "TAX_EXCLUSIVE",
      carrier: { type: "MEMBER", code: m },
      providerOptions: { zeroTaxReason: 71, clearanceMark: 1 },
    });
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
  });

  it("reports each line's remaining allowance quota (extension)", async () => {
    const m = member();
    const inv = await p.issue({
      ...base,
      orderId: order(),
      buyer: { name: "x", email: m },
      items: [{ description: "商品", quantity: 3, unitPrice: 100, amount: 300 }],
      amount: { salesAmount: 300, taxAmount: 15, totalAmount: 315 },
      carrier: { type: "MEMBER", code: m },
    });
    const quota = await p.getAllowanceQuota(inv.invoiceNumber);
    expect(quota.length).toBeGreaterThan(0);
    expect(quota[0]!.amount).toBe(300);
    expect(quota[0]!.tax).toBe(15);
  });

  it("lists issued invoices by period, and filters by invNo via prop (extension)", async () => {
    const m = member();
    const inv = await p.issue({
      ...base,
      orderId: order(),
      buyer: { name: "x", email: m },
      carrier: { type: "MEMBER", code: m },
    });
    // 期別 = bimonthly code (odd start month): June → 202605, not 202606.
    const [y, mo] = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
    })
      .format(inv.invoiceDate)
      .split("-");
    const period = `${y}${String(Number(mo) % 2 === 0 ? Number(mo) - 1 : Number(mo)).padStart(2, "0")}`;
    const all = await p.listInvoices({ period });
    expect(all.entries).toBeGreaterThan(0);
    const one = await p.listInvoices({ prop: "invNo", propValue: inv.invoiceNumber });
    expect(one.list.some((r) => r.invNo === inv.invoiceNumber)).toBe(true);
  });

  it("returns the print info (barcode + QR codes) for an invoice (extension)", async () => {
    const m = member();
    const inv = await p.issue({
      ...base,
      orderId: order(),
      buyer: { name: "x", email: m },
      carrier: { type: "MEMBER", code: m },
    });
    const info = await p.getInvoicePrintInfo(inv.invoiceNumber);
    expect(info.invNo).toBe(inv.invoiceNumber);
    expect(info.barCode).toBeTruthy();
    expect(info.qrCodeL).toBeTruthy();
    expect(info.qrCodeR).toBeTruthy();
    expect(info.prodList.length).toBeGreaterThan(0);
  });

  it("downloads an invoice print PDF (binary proof endpoint, extension)", async () => {
    const m = member();
    const inv = await p.issue({
      ...base,
      orderId: order(),
      buyer: { name: "x", email: m },
      carrier: { type: "MEMBER", code: m },
    });
    const pdf = await p.printInvoice([inv.invoiceNumber], { format: 25 });
    expect(pdf.contentType.toLowerCase()).toContain("pdf");
    expect(Array.from(pdf.data.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]); // %PDF
  }, 30_000);

  it("downloads an allowance print PDF (binary proof endpoint, extension)", async () => {
    const m = member();
    const inv = await p.issue({
      ...base,
      orderId: order(),
      buyer: { name: "x", email: m },
      carrier: { type: "MEMBER", code: m },
    });
    const al = await p.allowance({
      invoiceNumber: inv.invoiceNumber,
      allowanceId: order(),
      items: [{ description: "商品", quantity: 1, unitPrice: 100, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
    });
    const pdf = await p.printAllowance([(al.raw as { awID: number }).awID], { format: 2 });
    expect(pdf.contentType.toLowerCase()).toContain("pdf");
    expect(Array.from(pdf.data.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]); // %PDF
  }, 30_000);

  it("validates carriers and looks up a 統編 against 財政部 (extension)", async () => {
    expect(await p.lookupBusiness("53538851")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nid: "53538851", name: expect.stringContaining("歐付寶") }),
      ]),
    );
    expect(typeof (await p.checkMobileCode("/ABC1234"))).toBe("boolean");
    expect(typeof (await p.checkCharity("25885"))).toBe("boolean");
  }, 15_000);

  it("lists the store's logo ids (extension)", async () => {
    const logos = await p.listLogos();
    expect(Array.isArray(logos)).toBe(true);
  });

  it("lists the merchant's 字軌 tracks (extension)", async () => {
    const tracks = await p.listInvoiceTracks();
    expect(Array.isArray(tracks)).toBe(true);
    if (tracks.length) {
      expect(tracks[0]!.lead).toMatch(/^[A-Z]{2}$/);
      expect(String(tracks[0]!.startNo)).toMatch(/^\d{8}$/);
    }
  });

  it("issues an invoice with a discount line (negative price → mcType 100)", async () => {
    const m = member();
    const res = await p.issue({
      orderId: order(),
      buyer: { name: "折扣", email: m },
      items: [
        { description: "商品", quantity: 1, unitPrice: 100, amount: 100 },
        { description: "折扣", quantity: 1, unitPrice: -20, amount: -20 },
      ],
      amount: { salesAmount: 80, taxAmount: 4, totalAmount: 84 },
      taxType: "TAXABLE",
      priceMode: "TAX_EXCLUSIVE",
      carrier: { type: "MEMBER", code: m },
    });
    expect(res.totalAmount).toBe(84);
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

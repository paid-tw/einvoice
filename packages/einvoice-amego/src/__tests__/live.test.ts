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
    sellerUbn: process.env.AMEGO_SELLER ?? "12345678",
    appKey: process.env.AMEGO_APP_KEY ?? "",
  });

  let invoiceNumber: string;

  beforeAll(async () => {
    const res = await provider.issue({
      orderId: `IT${Date.now()}`,
      buyer: { ubn: "28080623", name: "光貿科技有限公司" },
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
    expect(res.buyer.ubn).toBe("28080623");
    expect(res.items.length).toBeGreaterThan(0);
  });

  it("looks up a company name (array payload)", async () => {
    const res = await provider.banQuery("28080623");
    expect(res.code).toBe(0);
  });

  it("reads server time via a plain GET (no code envelope)", async () => {
    const res = await provider.time();
    expect(typeof res.timestamp).toBe("number");
    expect(res.year).toBeGreaterThan(2024);
    expect(res).not.toHaveProperty("code");
  });

  it("reads the full track tree (track_all, nested layers)", async () => {
    const res = await provider.track.all({ year: 2026, period: 2 });
    expect(res.code).toBe(0);
    const l1 = (res.data as Array<Record<string, unknown>>)[0];
    expect(l1?.layer).toBe(1);
    expect(Array.isArray(l1?.data)).toBe(true);
  });

  it("reads API-numbering track status (Year/Period)", async () => {
    const res = await provider.track.status({ year: 2026, period: 2 });
    expect(res.code).toBe(0);
    expect(Array.isArray(res.data)).toBe(true);
    const rows = res.data as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("total_booklet");
    expect(rows[0]).toHaveProperty("status");
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

/**
 * Mutating flow: allocate a number booklet (track_get) then issue a self-numbered
 * invoice. Gated behind AMEGO_LIVE_MUTATE because each run irreversibly consumes
 * 50 invoice numbers from the merchant's track.
 */
const mutate = process.env.AMEGO_LIVE === "1" && process.env.AMEGO_LIVE_MUTATE === "1";
describe.skipIf(!mutate)("Amego live — custom numbering (consumes a booklet)", () => {
  const provider = createAmegoProvider({
    sellerUbn: process.env.AMEGO_SELLER ?? "12345678",
    appKey: process.env.AMEGO_APP_KEY ?? "",
  });

  it("track_get → issueCustom returns the allocated number in data[]", async () => {
    const alloc = await provider.track.get({ year: 2026, period: 2, book: 1 });
    const range = alloc.data as { code: string; start: string };
    const invoiceNumber = `${range.code}${range.start}`;
    const res = await provider.invoice.issueCustom(invoiceNumber, {
      order_id: `LCUST${Date.now()}`,
      InvoiceDate: "20260617",
      InvoiceTime: "16:40:42",
      RandomNumber: "4321",
      PrintMark: "Y",
      BuyerIdentifier: "0000000000",
      BuyerName: "消費者",
      ProductItem: [{ Description: "自訂配號測試", Quantity: 1, UnitPrice: 105, Amount: 105, TaxType: 1 }],
      SalesAmount: 105,
      FreeTaxSalesAmount: 0,
      ZeroTaxSalesAmount: 0,
      TaxType: 1,
      TaxRate: "0.05",
      TaxAmount: 0,
      TotalAmount: 105,
    });
    const out = (res.data as Array<{ invoice_number: string }>)[0];
    expect(out?.invoice_number).toBe(invoiceNumber);
  });
});

/**
 * Deliberately send invalid field values straight to the real API (via raw(),
 * bypassing local validation) and assert the exact error code Amego returns.
 * These are the source-of-truth for the offline error fixtures.
 */
describe.skipIf(!live)("Amego live — server rejects invalid values", () => {
  const provider = createAmegoProvider({
    sellerUbn: process.env.AMEGO_SELLER ?? "12345678",
    appKey: process.env.AMEGO_APP_KEY ?? "",
  });
  const item = { Description: "x", Quantity: "1", UnitPrice: "105", Amount: "105", TaxType: "1" };
  const base = (extra: Record<string, unknown>) => ({
    OrderId: `BAD${Date.now()}${Math.floor(performance.now())}`,
    BuyerIdentifier: "0000000000",
    BuyerName: "消費者",
    ProductItem: [item],
    SalesAmount: "105",
    FreeTaxSalesAmount: "0",
    ZeroTaxSalesAmount: "0",
    TaxType: "1",
    TaxRate: "0.05",
    TaxAmount: "0",
    TotalAmount: "105",
    ...extra,
  });

  it.each([
    ["empty BuyerName", { BuyerName: "" }, "3040123"],
    ["bad 統編 length", { BuyerIdentifier: "123" }, "3040121"],
    ["bad 統編 format", { BuyerIdentifier: "1234567x" }, "3040122"],
    ["item TaxType 5", { ProductItem: [{ ...item, TaxType: "5" }] }, "3040144"],
    ["DetailVat 0 no 統編", { DetailVat: 0 }, "3040162"],
  ])("rejects %s with code %s", async (_label, extra, code) => {
    const err = await provider.raw("/json/f0401", base(extra)).catch((e) => e);
    expect(err.rawCode).toBe(code);
    expect(err.code).toBe("VALIDATION");
  });

  it("rejects a bad 統編 checksum in ban_query (99)", async () => {
    const err = await provider.raw("/json/ban_query", [{ ban: "28080624" }]).catch((e) => e);
    expect(err.rawCode).toBe("99");
  });

  it("returns an empty name for a valid-format 統編 with no company (not an error)", async () => {
    const res = await provider.banQuery("10458575");
    expect(res.code).toBe(0);
    expect((res.data as Array<{ name: string }>)[0]?.name).toBe("");
  });

  it("rejects a zero-rated invoice missing the customs mark (3040179)", async () => {
    const err = await provider
      .raw("/json/f0401", base({
        ProductItem: [{ ...item, UnitPrice: "100", Amount: "100", TaxType: "2" }],
        SalesAmount: "0",
        ZeroTaxSalesAmount: "100",
        TaxType: "2",
        TotalAmount: "100",
      }))
      .catch((e) => e);
    expect(err.rawCode).toBe("3040179");
  });
});

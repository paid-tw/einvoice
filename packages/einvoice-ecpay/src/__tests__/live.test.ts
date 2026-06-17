import { describe, expect, it } from "vitest";
import { ECPAY_SANDBOX } from "../config.js";
import { createEcpayProvider } from "../provider.js";

/**
 * Live test against the ECPay B2C stage environment. Skipped unless ECPAY_LIVE=1.
 * Credentials default to the public {@link ECPAY_SANDBOX}, so `ECPAY_LIVE=1` alone
 * is enough; override with ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV.
 *
 *   ECPAY_LIVE=1 pnpm --filter @paid-tw/einvoice-ecpay exec vitest run live
 */
const live = process.env.ECPAY_LIVE === "1";
const LIVE_OPTS = { retry: 2 } as const;

function provider() {
  return createEcpayProvider({
    merchantId: process.env.ECPAY_MERCHANT_ID ?? ECPAY_SANDBOX.merchantId,
    hashKey: process.env.ECPAY_HASH_KEY ?? ECPAY_SANDBOX.hashKey,
    hashIV: process.env.ECPAY_HASH_IV ?? ECPAY_SANDBOX.hashIV,
    mode: "TEST",
  });
}

const carrierIssue = (orderId: string) => ({
  orderId,
  buyer: { email: "test@example.com" },
  items: [{ description: "整合測試商品", quantity: 2, unitPrice: 50, amount: 100 }],
  amount: { salesAmount: 100, taxAmount: 0, totalAmount: 100 },
  taxType: "TAXABLE" as const,
  priceMode: "TAX_INCLUSIVE" as const,
  carrier: { type: "MEMBER" as const },
});

describe.skipIf(!live)("ECPay live (stage) — issue → query → void", LIVE_OPTS, () => {
  const p = provider();
  const orderId = `IT${Date.now()}`;
  let invoiceNumber: string;
  let invoiceDate: string;

  it("issues a B2C carrier invoice (AES + envelope verified end-to-end)", async () => {
    const res = await p.issue(carrierIssue(orderId));
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
    expect(res.randomCode).toMatch(/^\d{4}$/);
    invoiceNumber = res.invoiceNumber;
    invoiceDate = res.invoiceDate.toISOString().slice(0, 10);
  });

  it("queries it by orderId (GetIssue) with items + amount", async () => {
    const res = await p.query({ orderId });
    expect(res.invoiceNumber).toBe(invoiceNumber);
    expect(res.amount.totalAmount).toBe(100);
    expect(res.items.length).toBeGreaterThan(0);
  });

  it("voids it (Invalid)", async () => {
    const res = await p.void({ invoiceNumber, reason: "整合測試作廢", providerOptions: { invoiceDate } });
    expect(res.status).toBe("VOIDED");
  });
});

describe.skipIf(!live)("ECPay live (stage) — Issue field-rule audit", LIVE_OPTS, () => {
  const p = provider();
  const base = (o = {}) => ({
    orderId: `AU${Date.now()}${Math.floor(Math.random() * 1000)}`,
    buyer: { email: "test@example.com" },
    items: [{ description: "商品", quantity: 1, unitPrice: 100, amount: 100 }],
    amount: { salesAmount: 100, taxAmount: 0, totalAmount: 100 },
    taxType: "TAXABLE" as const,
    priceMode: "TAX_INCLUSIVE" as const,
    carrier: { type: "MEMBER" as const },
    ...o,
  });

  // Verified live: zero-rated REQUIRES ClearanceMark (API: 5000007), but the
  // docs' "ZeroTaxRateReason required" is NOT enforced.
  it("issues a zero-rated invoice with ClearanceMark (no ZeroTaxRateReason needed)", async () => {
    const res = await p.issue(base({ taxType: "ZERO_RATED", providerOptions: { clearanceMark: "2" } }));
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
  });

  it("rejects a zero-rated invoice with no ClearanceMark locally", async () => {
    await expect(p.issue(base({ taxType: "ZERO_RATED" }))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  // Verified live: a B2B (統編) invoice CAN store a carrier (情境二) — our schema
  // no longer wrongly rejects it.
  it("issues a B2B invoice that stores an ECPay carrier", async () => {
    const res = await p.issue(base({ buyer: { ubn: "53538851", name: "歐付寶", email: "test@example.com" } }));
    expect(res.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
  });
});

describe.skipIf(!live)("ECPay live (stage) — 延遲/觸發開立", LIVE_OPTS, () => {
  const p = provider();
  const orderId = `TP${Date.now()}`;

  it("issuePending → triggerIssue assigns a real number", async () => {
    const pend = await p.issuePending(carrierIssue(orderId));
    expect(pend.relateNumber).toBe(orderId);
    const issued = await p.triggerIssue({ relateNumber: orderId });
    expect(issued.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
  });
});

describe.skipIf(!live)("ECPay live (stage) — 載具驗證", LIVE_OPTS, () => {
  const p = provider();

  it("validateMobileBarcode resolves a boolean", async () => {
    expect(typeof (await p.validateMobileBarcode("/ABC1234"))).toBe("boolean");
  });

  it("validateLoveCode resolves true for a registered code, with its organ name", async () => {
    expect(await p.validateLoveCode("168001")).toBe(true);
    expect(await p.lookupLoveCodeOrganName("168001")).toBeTruthy();
  });

  it("lookupCompanyName resolves a real company; 查無 → undefined; bad checksum throws", async () => {
    expect(await p.lookupCompanyName("97025978")).toContain("綠界");
    expect(await p.lookupCompanyName("00000000")).toBeUndefined(); // valid format, no data
    await expect(p.validateBan("12345678")).rejects.toMatchObject({ code: "VALIDATION" }); // bad checksum
  });
});

describe.skipIf(!live)("ECPay live (stage) — 查詢財政部配號", LIVE_OPTS, () => {
  const p = provider();
  const thisYear = String(new Date().getFullYear() - 1911); // 民國年

  it("lists the allocated 字軌 ranges for the current 民國年", async () => {
    const ranges = await p.getGovInvoiceWordSetting(thisYear);
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges[0]?.header).toMatch(/^[A-Z]{2}$/);
    expect(ranges[0]?.start).toMatch(/^\d{8}$/);
  });

  it("lists this merchant's own 字軌 with a use status", async () => {
    const tracks = await p.getInvoiceWordSetting({ invoiceYear: thisYear });
    expect(tracks.length).toBeGreaterThan(0);
    expect(tracks[0]?.trackId).toMatch(/^\d+$/);
    expect(tracks[0]?.status).toMatch(/^(INACTIVE|IN_USE|DISABLED|PAUSED|PENDING_REVIEW|REJECTED)$/);
  });

  // Read-only: a bogus TrackID confirms the endpoint without mutating a real 字軌.
  it("setInvoiceWordStatus rejects an unknown TrackID with NOT_FOUND", async () => {
    await expect(p.setInvoiceWordStatus("9999999", "ENABLE")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

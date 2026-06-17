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

  it("sends an issue notification (InvoiceNotify, stage validates but won't deliver)", async () => {
    await expect(
      p.sendNotification({ invoiceNumber, tag: "ISSUE", method: "EMAIL", recipient: "CUSTOMER", email: "test@example.com" }),
    ).resolves.toBeUndefined();
    // A non-winning invoice has no award data → NOT_FOUND, proving the AW tag is processed.
    await expect(
      p.sendNotification({ invoiceNumber, tag: "AWARD", method: "EMAIL", recipient: "CUSTOMER", email: "test@example.com" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("queries it by orderId (情境一) and by InvoiceNo+Date (情境二)", async () => {
    const byOrder = await p.query({ orderId });
    expect(byOrder.invoiceNumber).toBe(invoiceNumber);
    expect(byOrder.amount.totalAmount).toBe(100);
    expect(byOrder.items.length).toBeGreaterThan(0);
    const byInvoice = await p.query({ invoiceNumber, providerOptions: { invoiceDate } });
    expect(byInvoice.invoiceNumber).toBe(invoiceNumber);
    expect(byInvoice.amount.totalAmount).toBe(100);
  });

  it("creates an online allowance (線上折讓) pending buyer confirmation, with a 72h expiry", async () => {
    // Its own invoice — a pending online allowance would consume the shared one's budget.
    const oid = `${orderId}O`;
    const oinv = await p.issue(carrierIssue(oid));
    const res = await p.allowanceOnline(
      {
        invoiceNumber: oinv.invoiceNumber,
        allowanceId: oid,
        items: [{ description: "整合測試商品", quantity: 2, unitPrice: 50, amount: 100 }],
        amount: { salesAmount: 100, taxAmount: 0, totalAmount: 100 },
        providerOptions: { invoiceDate: oinv.invoiceDate.toISOString().slice(0, 10) },
      },
      { notifyMail: "test@example.com", customerName: "測試" },
    );
    expect(res.allowanceNumber).toMatch(/^\d+$/);
    expect(res.expiresAt.getTime()).toBeGreaterThan(res.createdAt.getTime());
    // Cancel the pending online allowance (before buyer confirmation).
    const c = await p.cancelAllowanceOnline({ invoiceNumber: oinv.invoiceNumber, allowanceNumber: res.allowanceNumber, reason: "測試取消" });
    expect(c.raw.RtnCode).toBe(1);
  });

  it("issues an allowance then voids it (full 折讓 lifecycle, no buyer confirm)", async () => {
    const al = await p.allowance({
      invoiceNumber,
      allowanceId: orderId,
      items: [{ description: "整合測試商品", quantity: 2, unitPrice: 50, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 0, totalAmount: 100 },
      providerOptions: { invoiceDate },
    });
    expect(al.allowanceNumber).toMatch(/^\d+$/);
    // The invoice now reports ALLOWANCE (remaining < sales).
    expect((await p.query({ invoiceNumber, providerOptions: { invoiceDate } })).status).toBe("ALLOWANCE");
    // The allowance is queryable by its number (GetAllowanceList).
    const details = await p.getAllowanceList({ allowanceNumber: al.allowanceNumber });
    expect(details[0]?.invoiceNumber).toBe(invoiceNumber);
    expect(details[0]?.totalAmount).toBe(100);
    const va = await p.voidAllowance({ invoiceNumber, allowanceNumber: al.allowanceNumber, reason: "測試作廢" });
    expect(va.raw.RtnCode).toBe(1);
    // The voided allowance is queryable (GetAllowanceInvalid).
    const inval = await p.getAllowanceInvalid({ invoiceNumber, allowanceNumber: al.allowanceNumber });
    expect(inval.reason).toBe("測試作廢");
    // Voiding it again → 2000063 該折讓單已作廢過 → CONFLICT.
    await expect(
      p.voidAllowance({ invoiceNumber, allowanceNumber: al.allowanceNumber }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("voids it (Invalid), then reads the void detail (GetInvalid)", async () => {
    const res = await p.void({ invoiceNumber, reason: "整合測試作廢", providerOptions: { invoiceDate } });
    expect(res.status).toBe("VOIDED");
    const detail = await p.getInvalid({ orderId, invoiceNumber, invoiceDate });
    expect(detail.invoiceNumber).toBe(invoiceNumber);
    expect(detail.reason).toBe("整合測試作廢");
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

describe.skipIf(!live)("ECPay live (stage) — 註銷重開", LIVE_OPTS, () => {
  const p = provider();

  it("voids and reissues an invoice, keeping its number/date with a new random code", async () => {
    const orderId = `RI${Date.now()}`;
    const orig = await p.issue(carrierIssue(orderId));
    const fmt = (d: Date) =>
      new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
        .format(orig.invoiceDate)
        .replace("T", " ");
    const res = await p.voidWithReissue({
      invoiceNumber: orig.invoiceNumber,
      voidReason: "測試註銷重開",
      invoiceDate: fmt(orig.invoiceDate),
      reissue: { ...carrierIssue(orderId), orderId },
    });
    // ECPay keeps the original number + open time; only the random code changes.
    expect(res.invoiceNumber).toBe(orig.invoiceNumber);
    expect(res.randomCode).toMatch(/^\d{4}$/);

    // The just-reissued invoice isn't uploaded to the MOF yet → can't re-void.
    await expect(
      p.voidWithReissue({
        invoiceNumber: orig.invoiceNumber,
        voidReason: "再次",
        invoiceDate: fmt(orig.invoiceDate),
        reissue: { ...carrierIssue(orderId), orderId },
      }),
    ).rejects.toMatchObject({ provider: "ecpay" });
  });
});

describe.skipIf(!live)("ECPay live (stage) — 發票列印", LIVE_OPTS, () => {
  const p = provider();

  it("returns a print URL for a paper invoice; a carrier invoice → NOT_FOUND", async () => {
    // Paper (Print=1) invoice — needs an address + email/phone.
    const paper = await p.issue({
      orderId: `PR${Date.now()}`,
      buyer: { name: "紙本", address: "台北市信義區", email: "test@example.com" },
      items: [{ description: "商品", quantity: 1, unitPrice: 100, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 0, totalAmount: 100 },
      taxType: "TAXABLE",
      priceMode: "TAX_INCLUSIVE",
    });
    const date = paper.invoiceDate.toISOString().slice(0, 10);
    const u = await p.getPrintUrl({ invoiceNumber: paper.invoiceNumber, invoiceDate: date, style: "DOUBLE", reprint: true });
    expect(u).toMatch(/^https:\/\//);

    // A carrier invoice has Print=0 and cannot be printed → 查無資料 (NOT_FOUND).
    const carrier = await p.issue(carrierIssue(`PRC${Date.now()}`));
    await expect(
      p.getPrintUrl({ invoiceNumber: carrier.invoiceNumber, invoiceDate: carrier.invoiceDate.toISOString().slice(0, 10) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe.skipIf(!live)("ECPay live (stage) — 延遲/觸發開立", LIVE_OPTS, () => {
  const p = provider();
  const orderId = `TP${Date.now()}`;

  it("issuePending (TRIGGER, DelayDay=0) → triggerIssue issues now with a real number", async () => {
    const pend = await p.issuePending(carrierIssue(orderId));
    expect(pend.relateNumber).toBe(orderId);
    const issued = await p.triggerIssue({ relateNumber: orderId });
    expect(issued.issued).toBe(true);
    expect(issued.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
  });

  it("triggerIssue on a delayed (DelayDay>0) staged invoice reports issued=false (4000003)", async () => {
    const did = `${orderId}D`;
    await p.issuePending(carrierIssue(did), { delayDay: 2 });
    const res = await p.triggerIssue({ relateNumber: did });
    expect(res.issued).toBe(false);
    expect(res.raw.RtnCode).toBe(4000003);
  });

  it("issuePending SCHEDULE (DelayFlag=1) stages an auto-issuing invoice", async () => {
    const res = await p.issuePending(carrierIssue(`${orderId}S`), { mode: "SCHEDULE", delayDay: 3 });
    expect(res.raw.RtnCode).toBe(1);
  });

  it("cancelDelayIssue cancels a still-pending invoice; cancelling again → NOT_FOUND", async () => {
    const cid = `${orderId}C`;
    await p.issuePending(carrierIssue(cid)); // TRIGGER mode → stays pending
    await p.cancelDelayIssue(cid); // resolves on success (取消成功)
    await expect(p.cancelDelayIssue(cid)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("editDelayIssue updates a still-pending invoice; unknown Tsr → NOT_FOUND", async () => {
    const eid = `${orderId}E`;
    await p.issuePending(carrierIssue(eid)); // TRIGGER mode → stays pending
    const edited = await p.editDelayIssue({ ...carrierIssue(eid), items: [{ description: "改後商品", quantity: 1, unitPrice: 200, amount: 200 }], amount: { salesAmount: 200, taxAmount: 0, totalAmount: 200 } });
    expect(edited.raw.RtnCode).toBe(1);
    await expect(p.editDelayIssue(carrierIssue(eid), { tsr: "NONEXISTENT999" })).rejects.toMatchObject({ code: "NOT_FOUND" });
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
  const thisYearDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());

  it("lists the allocated 字軌 ranges for the current 民國年", async () => {
    const ranges = await p.getGovInvoiceWordSetting(thisYear);
    expect(ranges.length).toBeGreaterThan(0);
    const r = ranges[0]!;
    expect(r.header).toMatch(/^[A-Z]{2}$/);
    expect(r.invType).toMatch(/^0[78]$/);
    expect(r.term).toBeGreaterThanOrEqual(1);
    expect(r.term).toBeLessThanOrEqual(6);
    expect(r.start).toMatch(/^\d{8}$/);
    expect(r.end).toMatch(/^\d{8}$/);
    // Verified live: 1 本 = 50 numbers, so the range spans count × 50 numbers.
    expect(Number(r.end) - Number(r.start) + 1).toBe(r.count * 50);
  });

  it("rejects an out-of-range 民國年 (only last/current/next)", async () => {
    // 110 is too old → ECPay returns 字軌年份錯誤.
    await expect(p.getGovInvoiceWordSetting("110")).rejects.toMatchObject({ provider: "ecpay" });
  });

  it("lists multiple invoices in a date range (GetIssueList, paginated, plain JSON)", async () => {
    const page = await p.listInvoices({ beginDate: thisYearDate, endDate: thisYearDate, numPerPage: 3, page: 1 });
    expect(page.totalCount).toBeGreaterThan(0);
    expect(page.invoices.length).toBeGreaterThan(0);
    expect(page.invoices[0]?.invoiceNumber).toMatch(/^[A-Z]{2}\d{8}$/);
    expect(page.invoices[0]?.createdAt.getFullYear()).toBeGreaterThan(2024);
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

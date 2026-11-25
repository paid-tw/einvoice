import { afterAll, describe, expect, it } from "vitest";
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

// Retry live tests a couple of times: the shared sandbox occasionally throttles
// under load, which is transient. Offline suites never use this.
const LIVE_OPTS = { retry: 2 } as const;

/** The `InvoiceStatus` ezPay actually sent, read from the untouched response. */
function wireInvoiceStatus(raw: unknown): string {
  const result = (raw as { Result?: unknown }).Result;
  const fields = (typeof result === "string" ? JSON.parse(result) : result) as
    | Record<string, unknown>
    | undefined;
  return String(fields?.InvoiceStatus);
}

describe.skipIf(!live)("ezPay live (test env)", LIVE_OPTS, () => {
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
    expect(res.status).toBe("ISSUED");
    expect(wireInvoiceStatus(res.raw)).toBe("1");
  });

  it("voids the issued invoice (full lifecycle)", async () => {
    const res = await provider.void({ invoiceNumber, reason: "整合測試作廢" });
    expect(res.status).toBe("VOIDED");
  });

  // Issue #13: after a void, invoice_search answers InvoiceStatus "2". Asserting
  // the wire value too means a change on ezPay's side fails here, by name.
  it("queries the voided invoice → VOIDED (wire InvoiceStatus 2)", async () => {
    const res = await provider.query({ invoiceNumber, providerOptions: { randomNum: randomCode } });
    expect(wireInvoiceStatus(res.raw)).toBe("2");
    expect(res.status).toBe("VOIDED");
  });
});

describe.skipIf(!live)("ezPay live — allowance lifecycle", LIVE_OPTS, () => {
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
    const res = await provider.voidAllowance({
      invoiceNumber,
      allowanceNumber,
      reason: "測試作廢折讓",
    });
    expect(res.allowanceNumber).toBe(allowanceNumber);
  });
});

describe.skipIf(!live)("ezPay live — 觸發開立 lifecycle", LIVE_OPTS, () => {
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

describe.skipIf(!live)("ezPay live — 手機條碼/愛心碼驗證", LIVE_OPTS, () => {
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

describe.skipIf(!live)("ezPay live — 觸發折讓 (held → cancel)", LIVE_OPTS, () => {
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

// --- 字軌管理 (provider.track) ---------------------------------------------
// Needs the member id (CompanyID_) and, when they differ from the store's, the
// member keys. The read-only suite runs with EZPAY_LIVE; the lifecycle suite
// registers a throwaway range and disables it, so it also needs
// EZPAY_TRACK_MUTATE=1 — every run leaves one 停用 range behind on cinv.
const liveTrack = live && Boolean(process.env.EZPAY_COMPANY_ID);
const liveTrackMutate = liveTrack && process.env.EZPAY_TRACK_MUTATE === "1";

function trackProvider() {
  return createEzpayProvider({
    merchantId: process.env.EZPAY_MERCHANT_ID!,
    hashKey: process.env.EZPAY_HASH_KEY!,
    hashIV: process.env.EZPAY_HASH_IV!,
    companyId: process.env.EZPAY_COMPANY_ID,
    companyHashKey: process.env.EZPAY_COMPANY_HASH_KEY || undefined,
    companyHashIV: process.env.EZPAY_COMPANY_HASH_IV || undefined,
    mode: "TEST",
  });
}

/** The current 民國年 and 期別 on the Asia/Taipei calendar. */
function currentPeriod() {
  const taipei = new Date(Date.now() + 8 * 3600_000);
  return {
    year: taipei.getUTCFullYear() - 1911,
    term: Math.floor(taipei.getUTCMonth() / 2) + 1,
  };
}

describe.skipIf(!liveTrack)("ezPay live — 字軌查詢 (read-only)", LIVE_OPTS, () => {
  const provider = trackProvider();

  it("lists this period's 字軌, verifying every range's CheckCode (HashIv=…)", async () => {
    // verifyCheckCode defaults to true, so any mismatch rejects here.
    const tracks = await provider.track.search(currentPeriod());
    for (const t of tracks) {
      expect(t.letters).toMatch(/^[A-Z]{2}$/);
      expect(t.startNumber).toMatch(/^\d{8}$/);
      expect(t.managementNo).not.toBe("");
      expect(["PAUSED", "ACTIVE", "DISABLED", "EXHAUSTED"]).toContain(t.status);
      if (t.status === "EXHAUSTED") expect(t.remaining).toBe(0);
    }
  });

  // cinv answers an empty period with INM10002 + 查無資料 (verified 2026-11-24).
  it("resolves [] for a period with no ranges", async () => {
    const { year } = currentPeriod();
    expect(await provider.track.search({ year: year + 1, term: 6 })).toEqual([]);
  });

  it("maps an out-of-window year to VALIDATION (INM10004)", async () => {
    const { year } = currentPeriod();
    await expect(provider.track.search({ year: year - 5, term: 1 })).rejects.toMatchObject({
      code: "VALIDATION",
      rawCode: "INM10004",
    });
  });

  it("rejects the store keys: the 字軌 API needs the member keys (KEY10002)", async () => {
    const store = createEzpayProvider({
      merchantId: process.env.EZPAY_MERCHANT_ID!,
      hashKey: process.env.EZPAY_HASH_KEY!,
      hashIV: process.env.EZPAY_HASH_IV!,
      companyId: process.env.EZPAY_COMPANY_ID,
      mode: "TEST",
    });
    const sameKeys =
      !process.env.EZPAY_COMPANY_HASH_KEY ||
      process.env.EZPAY_COMPANY_HASH_KEY === process.env.EZPAY_HASH_KEY;
    if (sameKeys) return; // nothing to tell apart on this account
    await expect(store.track.search(currentPeriod())).rejects.toMatchObject({
      code: "AUTH",
      rawCode: "KEY10002",
      reason: "credentials_invalid",
    });
  });
});

describe.skipIf(!liveTrackMutate)("ezPay live — 字軌 lifecycle (mutating)", LIVE_OPTS, () => {
  const provider = trackProvider();
  const { year, term } = currentPeriod();
  // A throwaway range in the current period: "Z?" letters, a random 50-number
  // booklet. It is registered PAUSED (another range is already active) and
  // disabled at the end, so it never issues a number.
  const letters = `Z${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
  const startNumber = (10_000 + Math.floor(Math.random() * 1_000_000)) * 50;
  const input = { year, term, letters, startNumber, endNumber: startNumber + 49 };
  let managementNo = "";

  afterAll(async () => {
    // Leave nothing usable behind even when a step failed midway.
    if (!managementNo) return;
    await provider.track.setStatus({ managementNo, year, status: "DISABLED" }).catch(() => {});
  });

  it("registers a range (createNumber)", async () => {
    const t = await provider.track.create(input);
    managementNo = t.managementNo;
    expect(t).toMatchObject({
      year,
      term,
      letters,
      startNumber: String(startNumber).padStart(8, "0"),
      endNumber: String(startNumber + 49).padStart(8, "0"),
      type: "07",
      remaining: 50,
      usedNumber: undefined,
    });
    expect(["PAUSED", "ACTIVE"]).toContain(t.status);
  });

  it("finds it by managementNo (searchNumber)", async () => {
    const found = await provider.track.search({ year, term, managementNo });
    expect(found.map((t) => t.managementNo)).toEqual([managementNo]);
  });

  it("rejects the same range again with CONFLICT (LIB10016)", async () => {
    await expect(provider.track.create(input)).rejects.toMatchObject({
      code: "CONFLICT",
      rawCode: "LIB10016",
    });
  });

  it("rejects an overlapping range with CONFLICT (LIB10004)", async () => {
    await expect(
      provider.track.create({
        ...input,
        startNumber: startNumber + 10,
        endNumber: startNumber + 99,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", rawCode: "LIB10004" });
  });

  it("rejects a period before the current one with VALIDATION (INM10004)", async () => {
    if (term === 1) return; // no earlier period in this year to try
    await expect(provider.track.create({ ...input, term: term - 1 })).rejects.toMatchObject({
      code: "VALIDATION",
      rawCode: "INM10004",
    });
  });

  it("rejects a no-op status change with CONFLICT (SET10006)", async () => {
    const [current] = await provider.track.search({ year, term, managementNo });
    await expect(
      provider.track.setStatus({ managementNo, year, status: current!.status as "PAUSED" }),
    ).rejects.toMatchObject({ code: "CONFLICT", rawCode: "SET10006" });
  });

  it("disables it (manageNumber Flag=2)", async () => {
    const t = await provider.track.setStatus({ managementNo, year, status: "DISABLED" });
    expect(t.status).toBe("DISABLED");
    expect(t.managementNo).toBe(managementNo);
  });

  it("refuses to re-enable a disabled range (SET10006)", async () => {
    await expect(
      provider.track.setStatus({ managementNo, year, status: "ACTIVE" }),
    ).rejects.toMatchObject({ code: "CONFLICT", rawCode: "SET10006" });
  });

  it("maps an unknown managementNo to NOT_FOUND (MOD10003)", async () => {
    await expect(
      provider.track.setStatus({ managementNo: "0zzzzzzzzz", year, status: "PAUSED" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", rawCode: "MOD10003" });
  });
});

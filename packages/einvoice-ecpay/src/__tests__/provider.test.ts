import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { IssueInvoiceInput } from "@paid-tw/einvoice";
import { ECPAY_ENDPOINTS } from "../index.js";
import {
  BASE,
  ecError,
  ecSuccess,
  ecTransError,
  MERCHANT,
  parseRequest,
  server,
  testProvider,
} from "./server.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const url = (path: string) => `${BASE}${path}`;

function issueInput(overrides: Partial<IssueInvoiceInput> = {}): IssueInvoiceInput {
  return {
    orderId: "ORDER_1",
    buyer: { email: "b@x.com" },
    items: [{ description: "商品一", quantity: 1, unitPrice: 100, amount: 100 }],
    amount: { salesAmount: 100, taxAmount: 0, totalAmount: 100 },
    taxType: "TAXABLE",
    priceMode: "TAX_INCLUSIVE",
    carrier: { type: "MEMBER" },
    ...overrides,
  };
}

const ISSUE_OK = {
  InvoiceNo: "JU11082062",
  InvoiceDate: "2026-06-17 12:24:53",
  RandomNumber: "3136",
};

describe("issue (Issue)", () => {
  it("encrypts the Data envelope, maps the unified input, and parses the result", async () => {
    let captured: Awaited<ReturnType<typeof parseRequest>> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.issue), async ({ request }) => {
        captured = parseRequest(await request.text());
        return HttpResponse.json(ecSuccess(ISSUE_OK));
      }),
    );
    const res = await testProvider().issue(issueInput());
    // The request wire payload (RelateNumber, CarrierType, TaxType, Items, the
    // B2B/tax-type/item-remark mappings, …) is asserted in fixtures.test.ts
    // against fixtures/ecpay/issue.json — the single source of truth for the
    // wire contract. This test covers the response half: result parsing.
    expect(res.invoiceNumber).toBe("JU11082062");
    expect(res.randomCode).toBe("3136");
    expect(res.invoiceDate.getFullYear()).toBe(2026);
    expect(res.status).toBe("ISSUED");
    expect(captured?.merchantId).toBe(MERCHANT); // envelope MerchantID, not part of Data
  });

  it("maps a business error (RtnCode ≠ 1) to the normalized code", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.issue), () =>
        HttpResponse.json(ecError(5000022, "驗證發票金額發現錯誤，與商品合計金額不符")),
      ),
    );
    const err = await testProvider()
      .issue(issueInput())
      .catch((e) => e);
    expect(err.code).toBe("VALIDATION");
    expect(err.rawCode).toBe("5000022");
    expect(err.provider).toBe("ecpay");
  });

  it("maps a duplicate RelateNumber on issue (5070357) to CONFLICT / duplicate_order", async () => {
    // Live RtnMsg (stage, 2026-08-01): 自訂編號重覆 uses 重覆 (覆), not 重複 — an
    // ambiguous-timeout resend. It must be a retryable CONFLICT (claim the existing
    // invoice via RelateNumber), not a terminal VALIDATION that orphans the invoice.
    server.use(
      http.post(url(ECPAY_ENDPOINTS.issue), () =>
        HttpResponse.json(ecError(5070357, "B2C開立發票 自訂編號重覆，請重新設定")),
      ),
    );
    const err = await testProvider()
      .issue(issueInput())
      .catch((e) => e);
    expect(err.code).toBe("CONFLICT");
    expect(err.reason).toBe("duplicate_order");
    expect(err.rawCode).toBe("5070357");
  });

  it("rejects an over-amount payload locally before any network call", async () => {
    await expect(
      testProvider().issue(
        issueInput({ amount: { salesAmount: 999, taxAmount: 0, totalAmount: 999 } }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION", provider: "ecpay" });
  });

  it("validatePayload:false bypasses local validation (reaches the network)", async () => {
    let hit = false;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.issue), () => {
        hit = true;
        return HttpResponse.json(ecSuccess(ISSUE_OK));
      }),
    );
    await testProvider({ validatePayload: false }).issue(
      issueInput({ amount: { salesAmount: 999, taxAmount: 0, totalAmount: 999 } }),
    );
    expect(hit).toBe(true);
  });
});

describe("void / allowance / voidAllowance", () => {
  it("rejects an allowance with an inconsistent amount as a normalized InvoiceError", async () => {
    // amountSummarySchema enforces salesAmount + taxAmount === totalAmount for
    // allowances too. parseInput normalizes the Zod failure into an
    // InvoiceError(VALIDATION) (not a raw ZodError) — before any HTTP call.
    await expect(
      testProvider().allowance({
        invoiceNumber: "JU11082062",
        allowanceId: "A1",
        items: [{ description: "退貨", quantity: 1, unitPrice: 100, amount: 100 }],
        amount: { salesAmount: 100, taxAmount: 50, totalAmount: 999 },
        providerOptions: { invoiceDate: "2026-06-17" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION", provider: "ecpay" });
  });

  it("void parses the result (wire payload covered by fixtures)", async () => {
    server.use(http.post(url(ECPAY_ENDPOINTS.invalid), () => HttpResponse.json(ecSuccess({}))));
    const res = await testProvider().void({
      invoiceNumber: "JU11082062",
      reason: "客戶取消",
      providerOptions: { invoiceDate: "2026-06-17" },
    });
    expect(res.status).toBe("VOIDED");
    expect((res.raw as { RtnCode: number }).RtnCode).toBe(1); // response captured, not discarded
  });

  it("maps a void blocked by an active allowance (5070450) to CONFLICT / void_blocked_by_allowance", async () => {
    // The EXACT live RtnMsg (stage, 2026-08-01): it contains BOTH 折讓 and 作廢
    // ("…折讓單是否全部已作廢"). A naive keyword match reads the trailing 作廢 and
    // misclassifies the reason as already_voided — the data-integrity bug in issue #3.
    server.use(
      http.post(url(ECPAY_ENDPOINTS.invalid), () =>
        HttpResponse.json(
          ecError(
            5070450,
            "B2C作廢發票 該發票已被折讓過，無法直接作廢發票並請確認該發票所開立的折讓單是否全部已作廢",
          ),
        ),
      ),
    );
    const err = await testProvider()
      .void({ invoiceNumber: "JU1", reason: "x" })
      .catch((e) => e);
    expect(err.code).toBe("CONFLICT");
    expect(err.reason).toBe("void_blocked_by_allowance");
    expect(err.rawCode).toBe("5070450");
  });

  it("maps a re-void of an already-voided invoice (5070453) to CONFLICT / already_voided", async () => {
    // Live RtnMsg (stage, 2026-08-01): 該發票已被作廢過 — not matched by a bare 已作廢.
    server.use(
      http.post(url(ECPAY_ENDPOINTS.invalid), () =>
        HttpResponse.json(ecError(5070453, "B2C作廢發票 該發票已被作廢過")),
      ),
    );
    const err = await testProvider()
      .void({ invoiceNumber: "JU1", reason: "x" })
      .catch((e) => e);
    expect(err.code).toBe("CONFLICT");
    expect(err.reason).toBe("already_voided");
    expect(err.rawCode).toBe("5070453");
  });

  it("rejects an over-long Reason (>20 chars) locally", async () => {
    await expect(
      testProvider().void({ invoiceNumber: "JU1", reason: "x".repeat(21) }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("void defaults InvoiceDate to today (Asia/Taipei) when not provided", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.invalid), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({}));
      }),
    );
    await testProvider().void({ invoiceNumber: "JU1", reason: "x" });
    expect(data?.InvoiceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("allowance parses IA_Allow_No + IA_Date (wire payload covered by fixtures)", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.allowance), () =>
        HttpResponse.json(
          ecSuccess({
            IA_Allow_No: "2026061721545183",
            IA_Date: "2026-06-17 21:54:51",
            IA_Remain_Allowance_Amt: 0,
          }),
        ),
      ),
    );
    const res = await testProvider().allowance({
      invoiceNumber: "JU11082062",
      allowanceId: "ORDER_1",
      items: [{ description: "商品一", quantity: 1, unitPrice: 100, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 0, totalAmount: 100 },
      providerOptions: { invoiceDate: "2026-06-17" },
    });
    expect(res.allowanceNumber).toBe("2026061721545183");
    expect(res.allowanceDate.getFullYear()).toBe(2026);
  });

  it("voidAllowance parses the result (wire payload covered by fixtures)", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.allowanceInvalid), () => HttpResponse.json(ecSuccess({}))),
    );
    const res = await testProvider().voidAllowance({
      invoiceNumber: "JU11082062",
      allowanceNumber: "A1",
    });
    expect(res.allowanceNumber).toBe("A1");
  });

  it("voidAllowance rejects an over-long Reason locally; maps re-void (2000063) to CONFLICT", async () => {
    await expect(
      testProvider().voidAllowance({
        invoiceNumber: "JU1",
        allowanceNumber: "A1",
        reason: "x".repeat(21),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    server.use(
      http.post(url(ECPAY_ENDPOINTS.allowanceInvalid), () =>
        HttpResponse.json(ecError(2000063, "該折讓單已作廢過，請確認")),
      ),
    );
    await expect(
      testProvider().voidAllowance({ invoiceNumber: "JU1", allowanceNumber: "A1" }),
    ).rejects.toMatchObject({ code: "CONFLICT", rawCode: "2000063" });
  });
});

describe("query (GetIssue)", () => {
  const GET_OK = {
    IIS_Number: "JU11082062",
    IIS_Relate_Number: "ORDER_1",
    IIS_Create_Date: "2026-06-17 12:24:53",
    IIS_Random_Number: "3136",
    IIS_Identifier: "0000000000",
    IIS_Customer_Email: "b@x.com",
    IIS_Customer_Addr: "台北市測試路1號",
    IIS_Customer_Phone: "0900000000",
    IIS_Sales_Amount: 105,
    IIS_Tax_Amount: 5,
    IIS_Remain_Allowance_Amt: 105,
    IIS_Invalid_Status: "0",
    Items: [{ ItemName: "商品一", ItemCount: 1, ItemPrice: 100, ItemAmount: 100, ItemWord: "式" }],
  };

  it("parses IIS_ fields + Items + amount + buyer addr/phone (wire payload covered by fixtures)", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getIssue), () => HttpResponse.json(ecSuccess(GET_OK))),
    );
    const res = await testProvider().query({ orderId: "ORDER_1" });
    expect(res.invoiceNumber).toBe("JU11082062");
    expect(res.amount).toEqual({ salesAmount: 100, taxAmount: 5, totalAmount: 105 });
    expect(res.buyer).toMatchObject({
      email: "b@x.com",
      address: "台北市測試路1號",
      phone: "0900000000",
    });
    expect(res.buyer.ubn).toBeUndefined(); // 0000000000 placeholder
    expect(res.items[0]?.description).toBe("商品一");
  });

  it("derives ALLOWANCE when the remaining allowance is below the sales total", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getIssue), () =>
        HttpResponse.json(ecSuccess({ ...GET_OK, IIS_Remain_Allowance_Amt: 55 })),
      ),
    );
    const res = await testProvider().query({ orderId: "ORDER_1" });
    expect(res.status).toBe("ALLOWANCE");
  });

  it("derives VOIDED when IIS_Invalid_Status=1", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getIssue), () =>
        HttpResponse.json(ecSuccess({ ...GET_OK, IIS_Invalid_Status: "1" })),
      ),
    );
    const res = await testProvider().query({ orderId: "ORDER_1" });
    expect(res.status).toBe("VOIDED");
  });

  it("maps a 查無 query error to NOT_FOUND", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getIssue), () =>
        HttpResponse.json(ecError(2, "查無發票資料，請重新確認")),
      ),
    );
    const err = await testProvider()
      .query({ orderId: "NOPE" })
      .catch((e) => e);
    expect(err.code).toBe("NOT_FOUND");
  });
});

describe("transport errors", () => {
  it("throws PROVIDER when TransCode ≠ 1", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.issue), () =>
        HttpResponse.json(ecTransError(0, "資料解密錯誤")),
      ),
    );
    const err = await testProvider()
      .issue(issueInput())
      .catch((e) => e);
    expect(err.code).toBe("PROVIDER");
    expect(err.rawCode).toBe("0");
  });

  // A wrong HashKey/HashIV fails at the TRANSPORT layer (TransCode 110, HTTP 500,
  // live-verified 2026-08-15) — it must surface as AUTH, not a PROVIDER outage.
  it.each([
    [110, "The parameter [Data] decrypt fail.", "credentials_invalid"],
    [104, "Timestamp is over 10 minutes than it just produced.", "stale_timestamp"],
    [115, "B2C/B2B功能尚未開通，請聯繫所屬業務", "not_enrolled"],
  ])("throws AUTH for TransCode %s (%s)", async (transCode, transMsg, reason) => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.issue), () =>
        HttpResponse.json(ecTransError(transCode, transMsg), { status: 500 }),
      ),
    );
    const err = await testProvider()
      .issue(issueInput())
      .catch((e) => e);
    expect(err.code).toBe("AUTH");
    expect(err.reason).toBe(reason);
    expect(err.rawCode).toBe(String(transCode));
    expect(err.rawMessage).toBe(transMsg);
  });

  it("wraps a network failure as NETWORK and a non-JSON response as PROVIDER", async () => {
    server.use(http.post(url(ECPAY_ENDPOINTS.issue), () => HttpResponse.error()));
    await expect(testProvider().issue(issueInput())).rejects.toMatchObject({ code: "NETWORK" });
    server.use(
      http.post(url(ECPAY_ENDPOINTS.issue), () => new HttpResponse("<html/>", { status: 500 })),
    );
    await expect(testProvider().issue(issueInput())).rejects.toMatchObject({
      code: "PROVIDER",
      rawCode: "500",
    });
  });
});

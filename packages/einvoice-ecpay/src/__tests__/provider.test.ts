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

const ISSUE_OK = { InvoiceNo: "JU11082062", InvoiceDate: "2026-06-17 12:24:53", RandomNumber: "3136" };

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
    expect(res.invoiceNumber).toBe("JU11082062");
    expect(res.randomCode).toBe("3136");
    expect(res.invoiceDate.getFullYear()).toBe(2026);
    expect(res.status).toBe("ISSUED");

    expect(captured?.merchantId).toBe(MERCHANT);
    expect(captured?.data).toMatchObject({
      RelateNumber: "ORDER_1",
      CarrierType: "1", // MEMBER → ECPay carrier
      Print: "0",
      Donation: "0",
      TaxType: "1",
      SalesAmount: 100,
      InvType: "07",
    });
    expect(captured?.data.Items).toHaveLength(1);
  });

  it("sends B2B fields (CustomerIdentifier, Print=1) for a 統編 buyer", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.issue), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess(ISSUE_OK));
      }),
    );
    await testProvider().issue(
      issueInput({
        buyer: { ubn: "53538851", name: "測試公司", address: "台北市測試路1號", email: "b@x.com" },
        carrier: undefined,
      }),
    );
    expect(data?.CustomerIdentifier).toBe("53538851");
    expect(data?.Print).toBe("1");
    expect(data?.CarrierType).toBe("");
  });

  it("maps a business error (RtnCode ≠ 1) to the normalized code", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.issue), () =>
        HttpResponse.json(ecError(5000022, "驗證發票金額發現錯誤，與商品合計金額不符")),
      ),
    );
    const err = await testProvider().issue(issueInput()).catch((e) => e);
    expect(err.code).toBe("VALIDATION");
    expect(err.rawCode).toBe("5000022");
    expect(err.provider).toBe("ecpay");
  });

  it("rejects an over-amount payload locally before any network call", async () => {
    await expect(
      testProvider().issue(issueInput({ amount: { salesAmount: 999, taxAmount: 0, totalAmount: 999 } })),
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
  it("void posts InvoiceNo + InvoiceDate + Reason", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.invalid), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({}));
      }),
    );
    const res = await testProvider().void({
      invoiceNumber: "JU11082062",
      reason: "客戶取消",
      providerOptions: { invoiceDate: "2026-06-17" },
    });
    expect(data).toMatchObject({ InvoiceNo: "JU11082062", InvoiceDate: "2026-06-17", Reason: "客戶取消" });
    expect(res.status).toBe("VOIDED");
    expect((res.raw as { RtnCode: number }).RtnCode).toBe(1); // response captured, not discarded
  });

  it("maps a void blocked by an active allowance (5070450) to CONFLICT", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.invalid), () =>
        HttpResponse.json(ecError(5070450, "B2C作廢發票 該發票已被折讓過，無法直接作廢發票")),
      ),
    );
    const err = await testProvider().void({ invoiceNumber: "JU1", reason: "x" }).catch((e) => e);
    expect(err.code).toBe("CONFLICT");
    expect(err.rawCode).toBe("5070450");
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

  it("allowance posts /Allowance (default AllowanceNotify=N) and returns IA_Allow_No + IA_Date", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.allowance), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({ IA_Allow_No: "2026061721545183", IA_Date: "2026-06-17 21:54:51", IA_Remain_Allowance_Amt: 0 }));
      }),
    );
    const res = await testProvider().allowance({
      invoiceNumber: "JU11082062",
      allowanceId: "ORDER_1",
      items: [{ description: "商品一", quantity: 1, unitPrice: 100, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 0, totalAmount: 100 },
      providerOptions: { invoiceDate: "2026-06-17" },
    });
    expect(data).toMatchObject({ InvoiceNo: "JU11082062", AllowanceAmount: 100, AllowanceNotify: "N" });
    expect(res.allowanceNumber).toBe("2026061721545183");
    expect(res.allowanceDate.getFullYear()).toBe(2026);
  });

  it("allowance can notify by email (AllowanceNotify=E + NotifyMail)", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.allowance), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({ IA_Allow_No: "A1", IA_Date: "2026-06-17 21:54:51" }));
      }),
    );
    await testProvider().allowance({
      invoiceNumber: "JU1",
      allowanceId: "O1",
      items: [{ description: "x", quantity: 1, unitPrice: 100, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 0, totalAmount: 100 },
      providerOptions: { invoiceDate: "2026-06-17", allowanceNotify: "E", notifyMail: "b@x.com", reason: "退款" },
    });
    expect(data).toMatchObject({ AllowanceNotify: "E", NotifyMail: "b@x.com", Reason: "退款" });
  });

  it("voidAllowance posts InvoiceNo + AllowanceNo + Reason", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.allowanceInvalid), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({}));
      }),
    );
    const res = await testProvider().voidAllowance({ invoiceNumber: "JU11082062", allowanceNumber: "A1" });
    expect(data).toMatchObject({ InvoiceNo: "JU11082062", AllowanceNo: "A1", Reason: "作廢折讓" });
    expect(res.allowanceNumber).toBe("A1");
  });

  it("voidAllowance rejects an over-long Reason locally; maps re-void (2000063) to CONFLICT", async () => {
    await expect(
      testProvider().voidAllowance({ invoiceNumber: "JU1", allowanceNumber: "A1", reason: "x".repeat(21) }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    server.use(
      http.post(url(ECPAY_ENDPOINTS.allowanceInvalid), () => HttpResponse.json(ecError(2000063, "該折讓單已作廢過，請確認"))),
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
    IIS_Sales_Amount: 105,
    IIS_Tax_Amount: 5,
    IIS_Invalid_Status: "0",
    Items: [{ ItemName: "商品一", ItemCount: 1, ItemPrice: 100, ItemAmount: 100, ItemWord: "式" }],
  };

  it("queries by orderId (RelateNumber), parses IIS_ fields + Items + amount split", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getIssue), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess(GET_OK));
      }),
    );
    const res = await testProvider().query({ orderId: "ORDER_1" });
    expect(data).toMatchObject({ RelateNumber: "ORDER_1" });
    expect(res.invoiceNumber).toBe("JU11082062");
    expect(res.amount).toEqual({ salesAmount: 100, taxAmount: 5, totalAmount: 105 });
    expect(res.buyer.ubn).toBeUndefined(); // 0000000000 placeholder
    expect(res.buyer.email).toBe("b@x.com");
    expect(res.items[0]?.description).toBe("商品一");
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
      http.post(url(ECPAY_ENDPOINTS.getIssue), () => HttpResponse.json(ecError(2, "查無發票資料，請重新確認"))),
    );
    const err = await testProvider().query({ orderId: "NOPE" }).catch((e) => e);
    expect(err.code).toBe("NOT_FOUND");
  });
});

describe("transport errors", () => {
  it("throws PROVIDER when TransCode ≠ 1", async () => {
    server.use(http.post(url(ECPAY_ENDPOINTS.issue), () => HttpResponse.json(ecTransError(0, "資料解密錯誤"))));
    const err = await testProvider().issue(issueInput()).catch((e) => e);
    expect(err.code).toBe("PROVIDER");
    expect(err.rawCode).toBe("0");
  });

  it("wraps a network failure as NETWORK and a non-JSON response as PROVIDER", async () => {
    server.use(http.post(url(ECPAY_ENDPOINTS.issue), () => HttpResponse.error()));
    await expect(testProvider().issue(issueInput())).rejects.toMatchObject({ code: "NETWORK" });
    server.use(http.post(url(ECPAY_ENDPOINTS.issue), () => new HttpResponse("<html/>", { status: 500 })));
    await expect(testProvider().issue(issueInput())).rejects.toMatchObject({ code: "PROVIDER", rawCode: "500" });
  });
});

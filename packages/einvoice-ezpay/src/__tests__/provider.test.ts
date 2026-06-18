import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { IssueInvoiceInput } from "@paid-tw/einvoice";
import { EZPAY_ENDPOINTS } from "../index.js";
import { decryptPostData } from "../crypto.js";
import { BASE, ezError, ezSuccess, IV, KEY, MERCHANT, parsePostData, server, testProvider, withCheckCode } from "./server.js";

/** Decrypt the PostData_ field of a built form into a params object. */
function decodeForm(form: { MerchantID_: string; PostData_: string }) {
  return Object.fromEntries(new URLSearchParams(decryptPostData(form.PostData_, KEY, IV)));
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const url = (p: { path: string }) => `${BASE}${p.path}`;

function issueInput(overrides: Partial<IssueInvoiceInput> = {}): IssueInvoiceInput {
  return {
    orderId: "ORDER_1",
    buyer: {},
    items: [{ description: "商品一", quantity: 1, unitPrice: 105, amount: 105 }],
    amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
    taxType: "TAXABLE",
    priceMode: "TAX_INCLUSIVE",
    ...overrides,
  };
}

const ISSUE_OK = {
  MerchantID: MERCHANT,
  InvoiceTransNo: "15110317583641325",
  MerchantOrderNo: "ORDER_1",
  TotalAmt: 105,
  InvoiceNumber: "DS12223139",
  RandomNum: "4253",
  CreateTime: "2026-06-17 17:58:36",
  CheckCode: "ABC",
};

describe("issue (invoice_issue)", () => {
  it("encrypts PostData_, maps the unified input, and parses the JSON Result", async () => {
    let captured: ReturnType<typeof parsePostData> | undefined;
    server.use(
      http.post(url(EZPAY_ENDPOINTS.issue), async ({ request }) => {
        captured = parsePostData(await request.text());
        return HttpResponse.json(ezSuccess(withCheckCode(ISSUE_OK)));
      }),
    );

    const res = await testProvider().issue(issueInput({ buyer: { email: "b@x.com" } }));

    // response mapping
    expect(res.invoiceNumber).toBe("DS12223139");
    expect(res.randomCode).toBe("4253");
    expect(res.invoiceDate.getFullYear()).toBe(2026);
    expect(res.status).toBe("ISSUED");

    // request: MerchantID_ + decrypted params
    expect(captured?.merchantId).toBe(MERCHANT);
    expect(captured?.params).toMatchObject({
      RespondType: "JSON",
      Version: "1.5",
      MerchantOrderNo: "ORDER_1",
      Status: "1",
      Category: "B2C",
      TaxType: "1",
      TaxRate: "5",
      Amt: "100",
      TaxAmt: "5",
      TotalAmt: "105",
      ItemName: "商品一",
      PrintFlag: "Y",
    });
  });

  it("maps the tax type onto the wire TaxType (TAXABLE→1 / ZERO_RATED→2 / TAX_FREE→3)", async () => {
    let captured: ReturnType<typeof parsePostData> | undefined;
    server.use(
      http.post(url(EZPAY_ENDPOINTS.issue), async ({ request }) => {
        captured = parsePostData(await request.text());
        return HttpResponse.json(ezSuccess(withCheckCode(ISSUE_OK)));
      }),
    );
    const cases: Array<[IssueInvoiceInput["taxType"], string]> = [
      ["TAXABLE", "1"],
      ["ZERO_RATED", "2"],
      ["TAX_FREE", "3"],
    ];
    for (const [taxType, code] of cases) {
      const taxAmount = taxType === "TAXABLE" ? 5 : 0;
      await testProvider().issue(
        issueInput({
          taxType,
          items: [{ description: "品", quantity: 1, unitPrice: 100 + taxAmount, amount: 100 + taxAmount }],
          amount: { salesAmount: 100, taxAmount, totalAmount: 100 + taxAmount },
          // ezPay requires a customs-clearance mark for zero-rated invoices.
          ...(taxType === "ZERO_RATED" ? { providerOptions: { CustomsClearance: "1" } } : {}),
        }),
      );
      expect(captured?.params.TaxType).toBe(code);
    }
  });

  it("sends B2B fields (Category, BuyerUBN) for a 統編 buyer", async () => {
    let p: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_ENDPOINTS.issue), async ({ request }) => {
        p = parsePostData(await request.text()).params;
        return HttpResponse.json(ezSuccess(withCheckCode(ISSUE_OK)));
      }),
    );
    await testProvider().issue(
      issueInput({ buyer: { ubn: "28080623", name: "光貿科技股份有限公司" } }),
    );
    expect(p?.Category).toBe("B2B");
    expect(p?.BuyerUBN).toBe("28080623");
    expect(p?.PrintFlag).toBe("Y");
  });

  it("joins multiple items with | and maps a mobile-barcode carrier", async () => {
    let p: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_ENDPOINTS.issue), async ({ request }) => {
        p = parsePostData(await request.text()).params;
        return HttpResponse.json(ezSuccess(withCheckCode(ISSUE_OK)));
      }),
    );
    await testProvider().issue(
      issueInput({
        items: [
          { description: "商品一", quantity: 1, unitPrice: 100, amount: 100 },
          { description: "商品二", quantity: 2, unitPrice: 50, amount: 100 },
        ],
        amount: { salesAmount: 190, taxAmount: 10, totalAmount: 200 },
        carrier: { type: "MOBILE_BARCODE", code: "/ABC1234" },
      }),
    );
    expect(p?.ItemName).toBe("商品一|商品二");
    expect(p?.ItemCount).toBe("1|2");
    expect(p?.ItemAmt).toBe("100|100");
    expect(p?.CarrierType).toBe("0");
    expect(p?.CarrierNum).toBe("/ABC1234");
    expect(p?.PrintFlag).toBe("N"); // carrier present → no paper
  });

  it("rejects an ezPay error response (Status != SUCCESS) with the mapped code", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.issue), () =>
        HttpResponse.json(ezError("INV10013", "發票欄位資料不齊全或格式錯誤")),
      ),
    );
    const err = await testProvider().issue(issueInput()).catch((e) => e);
    expect(err.code).toBe("VALIDATION");
    expect(err.rawCode).toBe("INV10013");
    expect(err.rawMessage).toBe("發票欄位資料不齊全或格式錯誤");
    expect(err.provider).toBe("ezpay");
  });

  it("rejects an ezPay-invalid built payload locally (MerchantOrderNo format)", async () => {
    // core accepts this orderId, but ezPay's MerchantOrderNo allows only [A-Za-z0-9_].
    await expect(
      testProvider().issue(issueInput({ orderId: "bad order!" })),
    ).rejects.toMatchObject({ code: "VALIDATION", provider: "ezpay" });
  });
});

describe("issue response CheckCode verification", () => {
  it("accepts a response whose CheckCode matches the 5 result fields", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.issue), () => HttpResponse.json(ezSuccess(withCheckCode(ISSUE_OK)))),
    );
    const res = await testProvider().issue(issueInput());
    expect(res.invoiceNumber).toBe("DS12223139");
  });

  it("rejects a tampered CheckCode as a PROVIDER error", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.issue), () =>
        HttpResponse.json(ezSuccess({ ...ISSUE_OK, CheckCode: "DEADBEEF" })),
      ),
    );
    const err = await testProvider().issue(issueInput()).catch((e) => e);
    expect(err.code).toBe("PROVIDER");
    expect(err.rawCode).toBe("CHECKCODE_MISMATCH");
  });

  it("detects payload tampering (mutated TotalAmt invalidates the CheckCode)", async () => {
    // valid CheckCode for the original, but a swapped TotalAmt → mismatch.
    server.use(
      http.post(url(EZPAY_ENDPOINTS.issue), () =>
        HttpResponse.json(ezSuccess({ ...withCheckCode(ISSUE_OK), TotalAmt: 999 })),
      ),
    );
    await expect(testProvider().issue(issueInput())).rejects.toMatchObject({
      rawCode: "CHECKCODE_MISMATCH",
    });
  });

  it("verifyCheckCode:false skips verification", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.issue), () =>
        HttpResponse.json(ezSuccess({ ...ISSUE_OK, CheckCode: "WRONG" })),
      ),
    );
    const res = await testProvider({ verifyCheckCode: false }).issue(issueInput());
    expect(res.invoiceNumber).toBe("DS12223139");
  });
});

describe("void (invoice_invalid)", () => {
  it("sends InvoiceNumber + InvalidReason and maps the result", async () => {
    let p: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_ENDPOINTS.void), async ({ request }) => {
        p = parsePostData(await request.text()).params;
        return HttpResponse.json(
          ezSuccess({ MerchantID: MERCHANT, InvoiceNumber: "DS12223139", CreateTime: "2026-06-17 18:00:00", CheckCode: "X" }),
        );
      }),
    );
    const res = await testProvider().void({ invoiceNumber: "DS12223139", reason: "客戶取消" });
    expect(p).toMatchObject({ Version: "1.0", InvoiceNumber: "DS12223139", InvalidReason: "客戶取消" });
    expect(res.status).toBe("VOIDED");
  });

  it("maps a void state-conflict error (LIB10005 已作廢過) to CONFLICT", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.void), () => HttpResponse.json(ezError("LIB10005", "發票已作廢過"))),
    );
    const err = await testProvider().void({ invoiceNumber: "DS1", reason: "x" }).catch((e) => e);
    expect(err.code).toBe("CONFLICT");
    expect(err.rawCode).toBe("LIB10005");
  });
});

describe("觸發開立 (issuePending → triggerIssue)", () => {
  it("issuePending posts Status=0 and returns the InvoiceTransNo", async () => {
    let p: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_ENDPOINTS.issue), async ({ request }) => {
        p = parsePostData(await request.text()).params;
        return HttpResponse.json(
          ezSuccess(
            withCheckCode({
              MerchantID: MERCHANT,
              InvoiceTransNo: "26061710261482406",
              MerchantOrderNo: "ORDER_1",
              InvoiceNumber: "", // held: not issued yet
              TotalAmt: 105,
              RandomNum: "8117",
              CreateTime: "",
            }),
          ),
        );
      }),
    );
    const res = await testProvider().issuePending(issueInput());
    expect(p).toMatchObject({ Version: "1.5", Status: "0", MerchantOrderNo: "ORDER_1" });
    expect(res.invoiceTransNo).toBe("26061710261482406");
    expect(res.orderId).toBe("ORDER_1");
    expect(res.totalAmount).toBe(105);
  });

  it("triggerIssue posts InvoiceTransNo to invoice_touch_issue and returns the InvoiceNumber", async () => {
    let p: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_ENDPOINTS.touchIssue), async ({ request }) => {
        p = parsePostData(await request.text()).params;
        return HttpResponse.json(
          ezSuccess(
            withCheckCode({
              MerchantID: MERCHANT,
              InvoiceTransNo: "26061710261482406",
              MerchantOrderNo: "ORDER_1",
              TotalAmt: 105,
              InvoiceNumber: "BB00000057",
              RandomNum: "8117",
              CreateTime: "2026-06-17 10:26:14",
            }),
          ),
        );
      }),
    );
    const res = await testProvider().triggerIssue({
      invoiceTransNo: "26061710261482406",
      orderId: "ORDER_1",
      totalAmount: 105,
    });
    expect(p).toMatchObject({
      Version: "1.0",
      InvoiceTransNo: "26061710261482406",
      MerchantOrderNo: "ORDER_1",
      TotalAmt: "105",
    });
    expect(res.invoiceNumber).toBe("BB00000057");
    expect(res.randomCode).toBe("8117");
    expect(res.status).toBe("ISSUED");
  });

  it("maps a touch-issue error to the normalized code", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.touchIssue), () =>
        HttpResponse.json(ezError("INV20006", "查無發票資料")),
      ),
    );
    const err = await testProvider()
      .triggerIssue({ invoiceTransNo: "X", orderId: "ORDER_1", totalAmount: 105 })
      .catch((e) => e);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.rawCode).toBe("INV20006");
  });
});

describe("觸發折讓 (triggerAllowance)", () => {
  it("CONFIRM posts AllowanceStatus=C to allowance_touch_issue", async () => {
    let p: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_ENDPOINTS.allowanceTouch), async ({ request }) => {
        p = parsePostData(await request.text()).params;
        return HttpResponse.json(ezSuccess({ MerchantID: MERCHANT, AllowanceNo: "A26061710261630" }));
      }),
    );
    const res = await testProvider().triggerAllowance({
      allowanceNumber: "A26061710261630",
      orderId: "ORDER_1",
      totalAmount: 105,
      action: "CONFIRM",
      invoiceNumber: "BB00000058",
    });
    expect(p).toMatchObject({
      Version: "1.0",
      AllowanceStatus: "C",
      AllowanceNo: "A26061710261630",
      MerchantOrderNo: "ORDER_1",
      TotalAmt: "105",
    });
    expect(res.allowanceNumber).toBe("A26061710261630");
    expect(res.invoiceNumber).toBe("BB00000058");
  });

  it("CANCEL posts AllowanceStatus=D", async () => {
    let p: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_ENDPOINTS.allowanceTouch), async ({ request }) => {
        p = parsePostData(await request.text()).params;
        return HttpResponse.json(ezSuccess({ MerchantID: MERCHANT, AllowanceNo: "A1" }));
      }),
    );
    await testProvider().triggerAllowance({
      allowanceNumber: "A1",
      orderId: "ORDER_1",
      totalAmount: 105,
      action: "CANCEL",
    });
    expect(p?.AllowanceStatus).toBe("D");
  });
});

describe("local payload validation (wired per endpoint)", () => {
  it("void rejects an over-long InvalidReason before any network call", async () => {
    // core accepts the reason (min 1); ezPay caps it at 20 bytes.
    await expect(
      testProvider().void({ invoiceNumber: "BB00000001", reason: "x".repeat(21) }),
    ).rejects.toMatchObject({ code: "VALIDATION", provider: "ezpay" });
  });

  it("query rejects a SearchType-0 lookup with no RandomNum", async () => {
    await expect(testProvider().query({ invoiceNumber: "BB00000001" })).rejects.toMatchObject({
      code: "VALIDATION",
      provider: "ezpay",
    });
  });

  it("validatePayload:false bypasses local validation (reaches the network)", async () => {
    let hit = false;
    server.use(
      http.post(url(EZPAY_ENDPOINTS.void), () => {
        hit = true;
        return HttpResponse.json(ezSuccess({ MerchantID: MERCHANT, InvoiceNumber: "BB00000001" }));
      }),
    );
    await testProvider({ validatePayload: false }).void({
      invoiceNumber: "BB00000001",
      reason: "x".repeat(21), // would fail validation if it were on
    });
    expect(hit).toBe(true);
  });
});

describe("allowance / voidAllowance / query", () => {
  it("allowance posts InvoiceNo + per-line tax and returns the AllowanceNo", async () => {
    let p: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_ENDPOINTS.allowance), async ({ request }) => {
        p = parsePostData(await request.text()).params;
        return HttpResponse.json(
          ezSuccess({ MerchantID: MERCHANT, AllowanceNo: "A151015111705007", InvoiceNumber: "DS12223139", AllowanceAmt: 105, RemainAmt: 0, CheckCode: "X" }),
        );
      }),
    );
    const res = await testProvider().allowance({
      invoiceNumber: "DS12223139",
      allowanceId: "ORDER_1",
      items: [{ description: "退款", quantity: 1, unitPrice: 100, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
    });
    expect(p).toMatchObject({ Version: "1.3", InvoiceNo: "DS12223139", ItemTaxAmt: "5", TotalAmt: "105", Status: "1" });
    expect(res.allowanceNumber).toBe("A151015111705007");
  });

  it("voidAllowance posts AllowanceNo + InvalidReason", async () => {
    let p: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_ENDPOINTS.voidAllowance), async ({ request }) => {
        p = parsePostData(await request.text()).params;
        return HttpResponse.json(ezSuccess({ MerchantID: MERCHANT, AllowanceNo: "A1", CreateTime: "2026-06-17 18:00:00", CheckCode: "X" }));
      }),
    );
    const res = await testProvider().voidAllowance({ invoiceNumber: "DS1", allowanceNumber: "A180528095517632" });
    expect(p).toMatchObject({ AllowanceNo: "A180528095517632" });
    expect(res.allowanceNumber).toBe("A180528095517632");
  });

  it("query by invoiceNumber uses SearchType 0 and parses buyer/amount", async () => {
    let p: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_ENDPOINTS.search), async ({ request }) => {
        p = parsePostData(await request.text()).params;
        return HttpResponse.json(
          ezSuccess({
            MerchantID: MERCHANT,
            InvoiceNumber: "DS12223139",
            MerchantOrderNo: "ORDER_1",
            RandomNum: "4253",
            CreateTime: "2026-06-17 17:58:36",
            BuyerName: "光貿科技股份有限公司",
            BuyerUBN: "28080623",
            Amt: 100,
            TaxAmt: 5,
            TotalAmt: 105,
          }),
        );
      }),
    );
    const res = await testProvider().query({ invoiceNumber: "DS12223139", providerOptions: { randomNum: "4253" } });
    expect(p).toMatchObject({ SearchType: "0", InvoiceNumber: "DS12223139", RandomNum: "4253" });
    expect(res.amount).toEqual({ salesAmount: 100, taxAmount: 5, totalAmount: 105 });
    expect(res.buyer.ubn).toBe("28080623");
  });

  it("query by orderId uses SearchType 1; INV20006 → NOT_FOUND", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.search), () => HttpResponse.json(ezError("INV20006", "查無發票資料"))),
    );
    const err = await testProvider().query({ orderId: "NOPE", providerOptions: { totalAmt: 105 } }).catch((e) => e);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.rawCode).toBe("INV20006");
  });

  it("query treats a B2C placeholder BuyerUBN (0000000000) as no 統編", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.search), () =>
        HttpResponse.json(
          ezSuccess({
            InvoiceNumber: "BB00000001",
            RandomNum: "1234",
            BuyerUBN: "0000000000",
            Amt: 100,
            TaxAmt: 5,
            TotalAmt: 105,
          }),
        ),
      ),
    );
    const res = await testProvider().query({ invoiceNumber: "BB00000001", providerOptions: { randomNum: "1234" } });
    expect(res.buyer.ubn).toBeUndefined();
  });
});

describe("buildPostData / buildQueryPostData (encrypt without sending)", () => {
  it("buildPostData pairs MerchantID_ with an encrypted PostData_", () => {
    const form = testProvider().buildPostData({ Foo: "bar", N: 1 });
    expect(form.MerchantID_).toBe(MERCHANT);
    expect(form.PostData_).toMatch(/^[0-9a-f]+$/); // lowercase hex
    expect(decodeForm(form)).toMatchObject({ Foo: "bar", N: "1" });
  });

  it("buildQueryPostData builds a SearchType-0 search form with DisplayFlag", () => {
    const form = testProvider().buildQueryPostData({
      invoiceNumber: "BB00000001",
      providerOptions: { randomNum: "4253", displayFlag: "1" },
    });
    const params = decodeForm(form);
    expect(params).toMatchObject({
      RespondType: "JSON",
      Version: "1.3",
      SearchType: "0",
      InvoiceNumber: "BB00000001",
      RandomNum: "4253",
      DisplayFlag: "1",
    });
  });

  it("buildQueryPostData still validates the lookup (SearchType-0 needs RandomNum)", () => {
    expect(() => testProvider().buildQueryPostData({ invoiceNumber: "BB00000001" })).toThrow();
  });
});

describe("raw() escape hatch", () => {
  it("posts arbitrary PostData_ to any endpoint and returns the parsed result", async () => {
    let captured: ReturnType<typeof parsePostData> | undefined;
    server.use(
      http.post(url(EZPAY_ENDPOINTS.issue), async ({ request }) => {
        captured = parsePostData(await request.text());
        return HttpResponse.json(ezSuccess({ InvoiceNumber: "BB00000099" }));
      }),
    );
    const res = await testProvider().raw(EZPAY_ENDPOINTS.issue.path, { Foo: "bar", N: 1 });
    expect(captured?.params).toMatchObject({ Foo: "bar", N: "1" });
    expect(res.result.InvoiceNumber).toBe("BB00000099");
  });
});

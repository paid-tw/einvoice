import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ECPAY_ENDPOINTS } from "../index.js";
import { BASE, ecError, ecPlainSuccess, ecSuccess, parseRequest, server, testProvider } from "./server.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const url = (path: string) => `${BASE}${path}`;

const issueInput = {
  orderId: "ORDER_1",
  buyer: { email: "b@x.com" },
  items: [{ description: "商品", quantity: 1, unitPrice: 100, amount: 100 }],
  amount: { salesAmount: 100, taxAmount: 0, totalAmount: 100 },
  taxType: "TAXABLE" as const,
  priceMode: "TAX_INCLUSIVE" as const,
  carrier: { type: "MEMBER" as const },
};

describe("延遲/觸發開立 two-phase", () => {
  it("issuePending (default TRIGGER) posts DelayFlag=2 + DelayDay 0 + Tsr", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.delayIssue), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({ OrderNumber: "ORDER_1" }));
      }),
    );
    const res = await testProvider().issuePending(issueInput);
    expect(data).toMatchObject({ DelayFlag: "2", DelayDay: 0, Tsr: "ORDER_1", PayType: "2", PayAct: "ECPAY" });
    expect(res.relateNumber).toBe("ORDER_1");
  });

  it("issuePending SCHEDULE mode posts DelayFlag=1 + the delay days + NotifyURL", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.delayIssue), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({ OrderNumber: "ORDER_1" }));
      }),
    );
    await testProvider().issuePending(issueInput, { mode: "SCHEDULE", delayDay: 3, notifyUrl: "https://x.test/n" });
    expect(data).toMatchObject({ DelayFlag: "1", DelayDay: 3, NotifyURL: "https://x.test/n" });
  });

  it("rejects an out-of-range delayDay locally (SCHEDULE 1–15, TRIGGER 0–15)", async () => {
    await expect(testProvider().issuePending(issueInput, { mode: "SCHEDULE", delayDay: 0 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(testProvider().issuePending(issueInput, { mode: "SCHEDULE", delayDay: 16 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(testProvider().issuePending(issueInput, { delayDay: 16 })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("cancelDelayIssue posts the Tsr; unknown/cancelled → NOT_FOUND; empty → local VALIDATION", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.cancelDelayIssue), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({}));
      }),
    );
    await testProvider().cancelDelayIssue("ORDER_1");
    expect(data).toEqual({ MerchantID: "2000132", Tsr: "ORDER_1" });

    server.use(
      http.post(url(ECPAY_ENDPOINTS.cancelDelayIssue), () =>
        HttpResponse.json(ecError(5070305, "B2C取消延遲(或觸發)發票 查無可更新交易單號")),
      ),
    );
    await expect(testProvider().cancelDelayIssue("NOPE")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(testProvider().cancelDelayIssue("")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("editDelayIssue posts the full data + Tsr to EditDelayIssue", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.editDelayIssue), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({ OrderNumber: "ORDER_1" }));
      }),
    );
    const res = await testProvider().editDelayIssue(issueInput);
    expect(data).toMatchObject({ Tsr: "ORDER_1", RelateNumber: "ORDER_1", SalesAmount: 100 });
    expect(res.relateNumber).toBe("ORDER_1");
  });

  it("editDelayIssue maps an unknown Tsr (4000001) to NOT_FOUND", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.editDelayIssue), () => HttpResponse.json(ecError(4000001, "不存在此交易單號"))),
    );
    await expect(testProvider().editDelayIssue(issueInput, { tsr: "NOPE" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("triggerIssue (4000004, DelayDay=0) issues now, sends only Tsr+PayType, queries the number", async () => {
    let triggered: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.triggerIssue), async ({ request }) => {
        triggered = parseRequest(await request.text()).data;
        return HttpResponse.json(ecError(4000004, "開立發票成功")); // non-1 success code
      }),
      http.post(url(ECPAY_ENDPOINTS.getIssue), () =>
        HttpResponse.json(
          ecSuccess({
            IIS_Number: "JU11082064",
            IIS_Create_Date: "2026-06-17 12:25:00",
            IIS_Random_Number: "1234",
            IIS_Sales_Amount: 100,
            IIS_Tax_Amount: 0,
            IIS_Invalid_Status: "0",
          }),
        ),
      ),
    );
    const res = await testProvider().triggerIssue({ relateNumber: "ORDER_1" });
    expect(triggered).toEqual({ MerchantID: "2000132", Tsr: "ORDER_1", PayType: "2" }); // no PayAct
    expect(res.issued).toBe(true);
    expect(res.invoiceNumber).toBe("JU11082064");
  });

  it("triggerIssue (4000003, DelayDay>0) reports issued=false with no number (no query)", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.triggerIssue), () => HttpResponse.json(ecError(4000003, "延後開立成功"))),
      // GetIssue is NOT registered — if triggerIssue queried, the test would error.
    );
    const res = await testProvider().triggerIssue({ relateNumber: "ORDER_1" });
    expect(res.issued).toBe(false);
    expect(res.invoiceNumber).toBeUndefined();
    expect(res.raw.RtnCode).toBe(4000003);
  });
});

describe("carrier validation", () => {
  it("validateMobileBarcode posts BarCode and returns IsExist === 'Y'", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.checkBarcode), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({ IsExist: "Y" }));
      }),
    );
    expect(await testProvider().validateMobileBarcode("/ABC1234")).toBe(true);
    expect(data).toMatchObject({ BarCode: "/ABC1234" });
  });

  it("validateLoveCode returns false for IsExist === 'N'", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.checkLoveCode), () => HttpResponse.json(ecSuccess({ IsExist: "N" }))),
    );
    expect(await testProvider().validateLoveCode("123")).toBe(false);
  });

  it("lookupLoveCodeOrganName returns the OrganName when it exists, else undefined", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.checkLoveCode), () =>
        HttpResponse.json(ecSuccess({ IsExist: "Y", OrganName: "財團法人ＯＭＧ關懷社會愛心基金會" })),
      ),
    );
    expect(await testProvider().lookupLoveCodeOrganName("168001")).toBe("財團法人ＯＭＧ關懷社會愛心基金會");

    server.use(
      http.post(url(ECPAY_ENDPOINTS.checkLoveCode), () => HttpResponse.json(ecSuccess({ IsExist: "N" }))),
    );
    expect(await testProvider().lookupLoveCodeOrganName("000")).toBeUndefined();
  });

  it("lookupLoveCodeOrganName rejects a malformed code locally", async () => {
    await expect(testProvider().lookupLoveCodeOrganName("12")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects malformed input locally before any request", async () => {
    await expect(testProvider().validateMobileBarcode("BAD")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(testProvider().validateLoveCode("12")).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("查詢財政部配號結果 (GetGovInvoiceWordSetting)", () => {
  it("posts InvoiceYear and maps InvoiceInfo to a clean shape", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getGovInvoiceWordSetting), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(
          ecSuccess({
            InvoiceInfo: [
              { InvoiceTerm: 1, InvType: "07", InvoiceHeader: "GI", InvoiceStart: "10000000", InvoiceEnd: "10000299", Number: 6 },
            ],
          }),
        );
      }),
    );
    const res = await testProvider().getGovInvoiceWordSetting("115");
    expect(data).toMatchObject({ InvoiceYear: "115" });
    expect(res).toEqual([
      { term: 1, invType: "07", header: "GI", start: "10000000", end: "10000299", count: 6 },
    ]);
  });

  it("returns an empty list when the response carries no InvoiceInfo", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getGovInvoiceWordSetting), () => HttpResponse.json(ecSuccess({}))),
    );
    expect(await testProvider().getGovInvoiceWordSetting("115")).toEqual([]);
  });

  it("throws NOT_FOUND when there's no allocation (查無資料)", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getGovInvoiceWordSetting), () => HttpResponse.json(ecError(7, "查無資料"))),
    );
    await expect(testProvider().getGovInvoiceWordSetting("116")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a malformed InvoiceYear locally", async () => {
    await expect(testProvider().getGovInvoiceWordSetting("2026")).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("查詢字軌 (GetInvoiceWordSetting)", () => {
  const TRACK = {
    TrackID: "11902",
    InvoiceYear: "115",
    InvoiceTerm: 3,
    InvType: "07",
    InvoiceHeader: "JU",
    InvoiceStart: "90000000",
    InvoiceEnd: "90000049",
    InvoiceNo: "90000012",
    UseStatus: 2,
    ProductServiceId: "A001",
  };

  it("defaults the filter (term/status all, category B2C) and maps the tracks", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getInvoiceWordSetting), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({ InvoiceInfo: [TRACK] }));
      }),
    );
    const res = await testProvider().getInvoiceWordSetting({ invoiceYear: "115" });
    expect(data).toMatchObject({ InvoiceYear: "115", InvoiceTerm: 0, UseStatus: 0, InvoiceCategory: 1 });
    expect(res).toEqual([
      {
        trackId: "11902",
        year: "115",
        term: 3,
        invType: "07",
        header: "JU",
        start: "90000000",
        end: "90000049",
        currentNumber: "90000012",
        status: "IN_USE",
        productServiceId: "A001",
      },
    ]);
  });

  it("maps the useStatus enum + term to the request codes", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getInvoiceWordSetting), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({ InvoiceInfo: [] }));
      }),
    );
    await testProvider().getInvoiceWordSetting({ invoiceYear: "115", term: 3, useStatus: "PAUSED" });
    expect(data).toMatchObject({ InvoiceTerm: 3, UseStatus: 4 });
  });

  it("returns an empty list when the response carries no InvoiceInfo", async () => {
    server.use(http.post(url(ECPAY_ENDPOINTS.getInvoiceWordSetting), () => HttpResponse.json(ecSuccess({}))));
    expect(await testProvider().getInvoiceWordSetting({ invoiceYear: "115" })).toEqual([]);
  });

  it("rejects a malformed InvoiceYear locally", async () => {
    await expect(testProvider().getInvoiceWordSetting({ invoiceYear: "2026" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("設定字軌號碼狀態 (UpdateInvoiceWordStatus)", () => {
  it("posts TrackID + the mapped InvoiceStatus code", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.updateInvoiceWordStatus), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({}));
      }),
    );
    await testProvider().setInvoiceWordStatus("1123456", "ENABLE");
    expect(data).toMatchObject({ TrackID: "1123456", InvoiceStatus: 2 });

    await testProvider().setInvoiceWordStatus("1123456", "DISABLE");
    expect(data).toMatchObject({ InvoiceStatus: 0 });
  });

  it("maps an unknown TrackID (查無資料) to NOT_FOUND", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.updateInvoiceWordStatus), () => HttpResponse.json(ecError(7, "查無資料"))),
    );
    await expect(testProvider().setInvoiceWordStatus("9999999", "ENABLE")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects an empty TrackID locally", async () => {
    await expect(testProvider().setInvoiceWordStatus("", "ENABLE")).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("統一編號驗證 (GetCompanyNameByTaxID)", () => {
  it("returns the company name and validateBan=true on RtnCode 1", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getCompanyNameByTaxID), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({ CompanyName: "綠界科技股份有限公司" }));
      }),
    );
    expect(await testProvider().lookupCompanyName("97025978")).toBe("綠界科技股份有限公司");
    expect(data).toMatchObject({ UnifiedBusinessNo: "97025978" });
    expect(await testProvider().validateBan("97025978")).toBe(true);
  });

  it("treats 查無資料 (RtnCode 7) as proceed: undefined / false, not an error", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getCompanyNameByTaxID), () => HttpResponse.json(ecError(7, "查無資料"))),
    );
    expect(await testProvider().lookupCompanyName("00000000")).toBeUndefined();
    expect(await testProvider().validateBan("00000000")).toBe(false);
  });

  it("treats a 財政部API failure (9000001) as proceed", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getCompanyNameByTaxID), () =>
        HttpResponse.json(ecError(9000001, "呼叫財政部API失敗")),
      ),
    );
    expect(await testProvider().validateBan("97025978")).toBe(false);
  });

  it("throws VALIDATION on a checksum failure (1200125)", async () => {
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getCompanyNameByTaxID), () =>
        HttpResponse.json(ecError(1200125, "統一編號檢查碼驗證失敗，請再確認")),
      ),
    );
    await expect(testProvider().validateBan("12345678")).rejects.toMatchObject({ code: "VALIDATION", rawCode: "1200125" });
  });

  it("rejects a non 8-digit 統編 locally", async () => {
    await expect(testProvider().lookupCompanyName("123")).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("線上開立折讓 (allowanceOnline)", () => {
  const input = {
    invoiceNumber: "JU11083085",
    allowanceId: "ORDER_1",
    items: [{ description: "商品", quantity: 1, unitPrice: 100, amount: 100 }],
    amount: { salesAmount: 100, taxAmount: 0, totalAmount: 100 },
    providerOptions: { invoiceDate: "2026-06-17" },
  };

  it("posts AllowanceByCollegiate with AllowanceNotify=E + ReturnURL, returns the pending number + expiry", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.allowanceByCollegiate), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(
          ecSuccess({
            IA_Allow_No: "2606172158112842",
            IA_Invoice_No: "JU11083085",
            IA_TempDate: "2026-06-17 21:58:02",
            IA_TempExpireDate: "2026-06-20 21:58:02",
            IA_Remain_Allowance_Amt: 0,
          }),
        );
      }),
    );
    const res = await testProvider().allowanceOnline(input, {
      notifyMail: "b@x.com",
      returnUrl: "https://x.test/r",
      customerName: "測試",
    });
    expect(data).toMatchObject({ AllowanceNotify: "E", NotifyMail: "b@x.com", ReturnURL: "https://x.test/r" });
    expect(res.allowanceNumber).toBe("2606172158112842");
    expect(res.expiresAt.getTime()).toBeGreaterThan(res.createdAt.getTime());
  });

  it("requires a notifyMail locally", async () => {
    await expect(testProvider().allowanceOnline(input, { notifyMail: "" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("cancelAllowanceOnline posts InvoiceNo+AllowanceNo+Reason; an agreed one (5070250) → CONFLICT", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.allowanceInvalidByCollegiate), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({ IA_Invoice_No: "JU11083085" }));
      }),
    );
    await testProvider().cancelAllowanceOnline({ invoiceNumber: "JU11083085", allowanceNumber: "A1", reason: "取消" });
    expect(data).toMatchObject({ InvoiceNo: "JU11083085", AllowanceNo: "A1", Reason: "取消" });

    server.use(
      http.post(url(ECPAY_ENDPOINTS.allowanceInvalidByCollegiate), () =>
        HttpResponse.json(ecError(5070250, "無法取消已經同意的線上折讓單")),
      ),
    );
    await expect(
      testProvider().cancelAllowanceOnline({ invoiceNumber: "JU1", allowanceNumber: "A1" }),
    ).rejects.toMatchObject({ code: "CONFLICT", rawCode: "5070250" });

    await expect(
      testProvider().cancelAllowanceOnline({ invoiceNumber: "JU1", allowanceNumber: "A1", reason: "x".repeat(21) }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("查詢作廢折讓明細 (getAllowanceInvalid / GetAllowanceInvalid)", () => {
  it("posts InvoiceNo+AllowanceNo, parses the voided-allowance detail", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getAllowanceInvalid), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(
          ecSuccess({
            AI_Allow_No: "2026061722338885",
            AI_Invoice_No: "JU11084023",
            AI_Allow_Date: "2026-06-17 22:33:00",
            AI_Date: "2026-06-17 22:34:00",
            Reason: "測試作廢折讓原因",
            AI_Upload_Status: "0",
            AI_Upload_Date: "",
            AI_Seller_Identifier: "53538851",
            AI_Buyer_Identifier: "0000000000",
          }),
        );
      }),
    );
    const res = await testProvider().getAllowanceInvalid({ invoiceNumber: "JU11084023", allowanceNumber: "2026061722338885" });
    expect(data).toMatchObject({ InvoiceNo: "JU11084023", AllowanceNo: "2026061722338885" });
    expect(res).toMatchObject({ allowanceNumber: "2026061722338885", invoiceNumber: "JU11084023", reason: "測試作廢折讓原因", uploaded: false, sellerUbn: "53538851" });
    expect(res.buyerUbn).toBeUndefined();
    expect(res.allowanceDate.getFullYear()).toBe(2026);
    expect(res.voidedAt.getFullYear()).toBe(2026);
  });

  it("rejects a missing key locally", async () => {
    await expect(
      testProvider().getAllowanceInvalid({ invoiceNumber: "JU1", allowanceNumber: "" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("查詢作廢發票明細 (getInvalid / GetInvalid)", () => {
  it("posts RelateNumber+InvoiceNo+InvoiceDate, parses the void detail", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getInvalid), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(
          ecSuccess({
            II_Invoice_No: "JU11083872",
            II_Date: "2026-06-17 22:30:12",
            II_Upload_Status: "0",
            II_Upload_Date: "",
            Reason: "測試作廢原因",
            II_Seller_Identifier: "53538851",
            II_Buyer_Identifier: "0000000000",
          }),
        );
      }),
    );
    const res = await testProvider().getInvalid({ orderId: "ORDER_1", invoiceNumber: "JU11083872", invoiceDate: "2026-06-17" });
    expect(data).toMatchObject({ RelateNumber: "ORDER_1", InvoiceNo: "JU11083872", InvoiceDate: "2026-06-17" });
    expect(res).toMatchObject({ invoiceNumber: "JU11083872", reason: "測試作廢原因", uploaded: false, sellerUbn: "53538851" });
    expect(res.buyerUbn).toBeUndefined(); // 0000000000
    expect(res.uploadedAt).toBeUndefined();
    expect(res.voidedAt.getFullYear()).toBe(2026);
  });

  it("rejects a missing field locally", async () => {
    await expect(
      testProvider().getInvalid({ orderId: "O1", invoiceNumber: "JU1", invoiceDate: "" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("查詢折讓明細 (getAllowanceList / GetAllowanceList)", () => {
  const ALLOW = {
    IA_Allow_No: "2026061722267537",
    IA_Invoice_No: "JU11083866",
    IA_Date: "2026-06-17 22:25:37",
    IA_Invoice_Issue_Date: "2026-06-17 22:25:36",
    IA_Identifier: "0000000000",
    IA_Invalid_Status: "0",
    IA_Upload_Status: "0",
    IA_Tax_Type: "1",
    IA_Tax_Amount: 5,
    IA_Total_Amount: 100,
    IA_Total_Tax_Amount: 105,
    IA_Send_Mail: "",
    IIS_Customer_Name: "",
    Items: [{ ItemSeq: 1, ItemName: "商品", ItemCount: 1, ItemWord: "式", ItemPrice: 105, ItemTaxType: "1", ItemRateAmt: 5, ItemAmount: 105 }],
  };

  it("SearchType 0: by AllowanceNo, parses the detail + amount split", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getAllowanceList), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({ AllowanceInfo: [ALLOW] }));
      }),
    );
    const res = await testProvider().getAllowanceList({ allowanceNumber: "2026061722267537" });
    expect(data).toMatchObject({ SearchType: "0", AllowanceNo: "2026061722267537" });
    expect(res[0]).toMatchObject({
      allowanceNumber: "2026061722267537",
      invoiceNumber: "JU11083866",
      amount: 100,
      taxAmount: 5,
      totalAmount: 105,
      voided: false,
      uploaded: false,
    });
    expect(res[0]?.items[0]?.description).toBe("商品");
  });

  it("SearchType 1/2: by InvoiceNo + date (ISSUE→1, ALLOWANCE→2)", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getAllowanceList), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({ AllowanceInfo: [] }));
      }),
    );
    await testProvider().getAllowanceList({ invoiceNumber: "JU1", date: "2026-06-17" });
    expect(data).toMatchObject({ SearchType: "1", InvoiceNo: "JU1", Date: "2026-06-17" });
    await testProvider().getAllowanceList({ invoiceNumber: "JU1", date: "2026-06-17", dateType: "ALLOWANCE" });
    expect(data).toMatchObject({ SearchType: "2" });
  });

  it("rejects when neither an allowance number nor invoice+date is given", async () => {
    await expect(testProvider().getAllowanceList({})).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("returns an empty list when there's no AllowanceInfo", async () => {
    server.use(http.post(url(ECPAY_ENDPOINTS.getAllowanceList), () => HttpResponse.json(ecSuccess({}))));
    expect(await testProvider().getAllowanceList({ allowanceNumber: "X" })).toEqual([]);
  });

  it("with validatePayload:false, an empty input falls through to a bare SearchType 0", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getAllowanceList), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({ AllowanceInfo: [] }));
      }),
    );
    await testProvider({ validatePayload: false }).getAllowanceList({});
    expect(data).toMatchObject({ SearchType: "0", AllowanceNo: "" });
  });
});

describe("查詢多筆發票 (listInvoices / GetIssueList)", () => {
  const ROW = {
    IIS_Number: "JU11083134",
    IIS_Relate_Number: "ORDER_1",
    IIS_Identifier: "0000000000",
    IIS_Category: "B2C",
    IIS_Tax_Type: "1",
    IIS_Tax_Amount: 0,
    IIS_Sales_Amount: 100,
    IIS_Create_Date: "2026-06-17 22:17:00",
    IIS_Invalid_Status: "0",
    IIS_Upload_Status: "1",
    IIS_Remain_Allowance_Amt: 100,
  };

  it("posts the date range + pagination + filters, parses the plain-JSON page", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.getIssueList), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecPlainSuccess({ TotalCount: 3718, ShowingPage: 2, InvoiceData: [ROW] }));
      }),
    );
    const res = await testProvider().listInvoices({
      beginDate: "2026-06-17",
      endDate: "2026-06-17",
      numPerPage: 30,
      page: 2,
      filters: { Query_Invalid: "2" },
    });
    expect(data).toMatchObject({ BeginDate: "2026-06-17", EndDate: "2026-06-17", NumPerPage: 30, ShowingPage: 2, DataType: "1", Query_Invalid: "2" });
    expect(res.totalCount).toBe(3718);
    expect(res.page).toBe(2);
    expect(res.invoices[0]).toMatchObject({
      invoiceNumber: "JU11083134",
      orderId: "ORDER_1",
      category: "B2C",
      salesAmount: 100,
      voided: false,
      uploaded: true,
    });
    expect(res.invoices[0]?.ubn).toBeUndefined();
    expect(res.invoices[0]?.createdAt.getFullYear()).toBe(2026);
  });

  it("rejects an out-of-range numPerPage locally", async () => {
    await expect(
      testProvider().listInvoices({ beginDate: "2026-06-17", endDate: "2026-06-17", numPerPage: 201 }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("returns an empty page when there's no InvoiceData", async () => {
    server.use(http.post(url(ECPAY_ENDPOINTS.getIssueList), () => HttpResponse.json(ecPlainSuccess({ TotalCount: 0 }))));
    const res = await testProvider().listInvoices({ beginDate: "2026-06-17", endDate: "2026-06-17" });
    expect(res.invoices).toEqual([]);
  });
});

describe("raw() escape hatch", () => {
  it("posts an arbitrary Data payload and returns the decrypted result", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.invoicePrint), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({ InvoiceNo: "JU1" }));
      }),
    );
    const res = await testProvider().raw(ECPAY_ENDPOINTS.invoicePrint, { Foo: "bar" });
    expect(data).toMatchObject({ Foo: "bar" });
    expect(res.InvoiceNo).toBe("JU1");
  });
});

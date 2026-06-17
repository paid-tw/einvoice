import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ECPAY_ENDPOINTS } from "../index.js";
import { BASE, ecError, ecSuccess, parseRequest, server, testProvider } from "./server.js";

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
  it("issuePending posts DelayIssue with DelayFlag=2 + Tsr", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(url(ECPAY_ENDPOINTS.delayIssue), async ({ request }) => {
        data = parseRequest(await request.text()).data;
        return HttpResponse.json(ecSuccess({ OrderNumber: "ORDER_1" }));
      }),
    );
    const res = await testProvider().issuePending(issueInput);
    expect(data).toMatchObject({ DelayFlag: "2", Tsr: "ORDER_1", PayType: "2" });
    expect(res.relateNumber).toBe("ORDER_1");
  });

  it("triggerIssue accepts the 4000004 success code, then queries for the number", async () => {
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
    expect(triggered).toMatchObject({ Tsr: "ORDER_1" });
    expect(res.invoiceNumber).toBe("JU11082064");
    expect(res.status).toBe("ISSUED");
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

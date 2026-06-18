import { Capability, supports } from "@paid-tw/einvoice";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EZPAY_CB_ENDPOINTS } from "../index.js";
import {
  BASE,
  ceError,
  ceIssueSuccess,
  ceSuccess,
  parseRequest,
  server,
  testProvider,
} from "./server.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const url = (path: string) => `${BASE}${path}`;
const buyer = { name: "跨境測試", email: "b@x.com" };
const twdInput = {
  orderId: "ORDER_1",
  buyer,
  items: [{ description: "商品", quantity: 1, unitPrice: 105, amount: 105 }],
  amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
  taxType: "TAXABLE" as const,
  priceMode: "TAX_INCLUSIVE" as const,
};

describe("capabilities", () => {
  it("declares cross-border B2C + foreign currency, not B2B/mixed/carrier", () => {
    const p = testProvider();
    for (const c of [
      Capability.ISSUE,
      Capability.VOID,
      Capability.ALLOWANCE,
      Capability.VOID_ALLOWANCE,
      Capability.QUERY,
      Capability.QUERY_BY_ORDER_ID,
      Capability.SCHEDULED_ISSUE,
      Capability.FOREIGN_CURRENCY,
    ]) {
      expect(supports(p, c)).toBe(true);
    }
    for (const c of [Capability.B2B, Capability.MIXED_TAX, Capability.CARRIER_VALIDATION]) {
      expect(supports(p, c)).toBe(false);
    }
  });
});

describe("issue", () => {
  it("issues a TWD invoice (integer amounts, Currency=TWD, ExchangeRate=1)", async () => {
    let data: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.issue.path), async ({ request }) => {
        data = parseRequest(await request.text());
        return HttpResponse.json(
          ceIssueSuccess({
            MerchantID: "3500001",
            MerchantOrderNo: "ORDER_1",
            InvoiceNumber: "CC00000014",
            RandomNum: "0446",
            TotalAmt: "105",
            CreateTime: "2026-06-17 23:35:17",
            InvoiceTransNo: "26061700000001",
          }),
        );
      }),
    );
    const res = await testProvider().issue(twdInput);
    expect(res.invoiceNumber).toBe("CC00000014");
    expect(res.randomCode).toBe("0446");
    expect(res.invoiceDate.getFullYear()).toBe(2026);
    expect(res.status).toBe("ISSUED");
    expect(data).toMatchObject({
      Status: "1",
      Currency: "TWD",
      Amt: "100",
      TaxAmt: "5",
      TotalAmt: "105",
      ExchangeRate: "1",
      BuyerEmail: "b@x.com",
      ItemPrice: "105",
      ItemUnit: "式",
    });
  });

  it("issues a foreign-currency invoice with 2-decimal amounts", async () => {
    let data: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.issue.path), async ({ request }) => {
        data = parseRequest(await request.text());
        return HttpResponse.json(
          ceIssueSuccess({
            MerchantID: "3500001",
            MerchantOrderNo: "ORDER_1",
            InvoiceNumber: "CC00000015",
            RandomNum: "8704",
            TotalAmt: "21.3000000",
            CreateTime: "2026-06-17 23:35:18",
          }),
        );
      }),
    );
    const res = await testProvider().issue({
      ...twdInput,
      items: [{ description: "Service", quantity: 1, unitPrice: 21.3, amount: 21.3, unit: " pc" }],
      amount: { salesAmount: 20.3, taxAmount: 1, totalAmount: 21.3 },
      currency: "USD",
      exchangeRate: 31.5,
    });
    expect(res.totalAmount).toBe(21.3);
    expect(data).toMatchObject({
      Currency: "USD",
      Amt: "20.30",
      TaxAmt: "1.00",
      TotalAmt: "21.30",
      ExchangeRate: "31.5",
      ItemPrice: "21.30",
      ItemAmt: "21.30",
      ItemUnit: " pc",
    });
  });
});

describe("response CheckCode verification (附件二)", () => {
  it("passes when the CheckCode matches the 5 issue fields", async () => {
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.issue.path), () =>
        HttpResponse.json(
          ceIssueSuccess({
            MerchantID: "3500001",
            MerchantOrderNo: "ORDER_1",
            InvoiceNumber: "CC1",
            RandomNum: "0446",
            TotalAmt: "105",
            CreateTime: "2026-06-17 12:00:00",
          }),
        ),
      ),
    );
    await expect(testProvider().issue(twdInput)).resolves.toMatchObject({ invoiceNumber: "CC1" });
  });

  it("throws PROVIDER when the CheckCode is tampered", async () => {
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.issue.path), () =>
        HttpResponse.json(
          ceSuccess({
            MerchantID: "3500001",
            MerchantOrderNo: "ORDER_1",
            InvoiceNumber: "CC1",
            RandomNum: "0446",
            TotalAmt: "105",
            CreateTime: "2026-06-17 12:00:00",
            CheckCode: "DEADBEEF",
          }),
        ),
      ),
    );
    await expect(testProvider().issue(twdInput)).rejects.toMatchObject({
      code: "PROVIDER",
      rawMessage: "CheckCode mismatch",
    });
  });

  it("skips verification when verifyCheckCode is false", async () => {
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.issue.path), () =>
        HttpResponse.json(
          ceSuccess({
            InvoiceNumber: "CC1",
            RandomNum: "0446",
            TotalAmt: "105",
            CreateTime: "2026-06-17 12:00:00",
          }),
        ),
      ),
    );
    await expect(testProvider({ verifyCheckCode: false }).issue(twdInput)).resolves.toMatchObject({
      invoiceNumber: "CC1",
    });
  });
});

describe("issuePending + triggerIssue (two-phase)", () => {
  it("stages a TRIGGER invoice (Status=0) and triggers it", async () => {
    let issueData: Record<string, string> | undefined;
    let trigData: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.issue.path), async ({ request }) => {
        issueData = parseRequest(await request.text());
        return HttpResponse.json(
          ceSuccess({ InvoiceTransNo: "26061700000002" }, "等待觸發開立成功"),
        );
      }),
      http.post(url(EZPAY_CB_ENDPOINTS.triggerIssue.path), async ({ request }) => {
        trigData = parseRequest(await request.text());
        return HttpResponse.json(
          ceIssueSuccess({
            MerchantID: "3500001",
            MerchantOrderNo: "ORDER_1",
            InvoiceTransNo: "26061700000002",
            InvoiceNumber: "CC00000017",
            RandomNum: "1111",
            TotalAmt: "105",
            CreateTime: "2026-06-17 23:45:00",
          }),
        );
      }),
    );
    const pend = await testProvider().issuePending(twdInput);
    expect(pend.invoiceTransNo).toBe("26061700000002");
    expect(issueData).toMatchObject({ Status: "0" });
    const trig = await testProvider().triggerIssue({
      invoiceTransNo: pend.invoiceTransNo,
      orderId: pend.orderId,
      totalAmount: 105,
    });
    expect(trig.invoiceNumber).toBe("CC00000017");
    expect(trigData).toMatchObject({
      InvoiceTransNo: "26061700000002",
      MerchantOrderNo: "ORDER_1",
      TotalAmt: "105",
    });
  });

  it("stages a SCHEDULE invoice (Status=3) with CreateStatusTime", async () => {
    let data: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.issue.path), async ({ request }) => {
        data = parseRequest(await request.text());
        return HttpResponse.json(ceSuccess({ InvoiceTransNo: "26061700000003" }));
      }),
    );
    await testProvider().issuePending(twdInput, {
      mode: "SCHEDULE",
      createStatusTime: "2026-12-25",
    });
    expect(data).toMatchObject({ Status: "3", CreateStatusTime: "2026-12-25" });
  });

  it("rejects SCHEDULE without a valid createStatusTime", async () => {
    await expect(testProvider().issuePending(twdInput, { mode: "SCHEDULE" })).rejects.toMatchObject(
      { code: "VALIDATION" },
    );
  });

  it("triggers a foreign-currency staged invoice with 2-decimal TotalAmt", async () => {
    let data: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.triggerIssue.path), async ({ request }) => {
        data = parseRequest(await request.text());
        return HttpResponse.json(
          ceIssueSuccess({
            InvoiceTransNo: "t",
            MerchantOrderNo: "o",
            InvoiceNumber: "CC1",
            RandomNum: "2222",
            TotalAmt: "21.30",
            CreateTime: "2026-06-17 23:45:00",
          }),
        );
      }),
    );
    await testProvider().triggerIssue({
      invoiceTransNo: "t",
      orderId: "o",
      totalAmount: 21.3,
      currency: "USD",
    });
    expect(data?.TotalAmt).toBe("21.30");
  });
});

describe("void", () => {
  it("voids an invoice", async () => {
    let data: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.void.path), async ({ request }) => {
        data = parseRequest(await request.text());
        return HttpResponse.json(
          ceSuccess(
            { InvoiceNumber: "CC00000014", CreateTime: "2026-06-17 23:50:00" },
            "作廢發票成功",
          ),
        );
      }),
    );
    const res = await testProvider().void({ invoiceNumber: "CC00000014", reason: "測試作廢" });
    expect(res.status).toBe("VOIDED");
    expect(data).toMatchObject({ InvoiceNumber: "CC00000014", InvalidReason: "測試作廢" });
  });

  it("rejects a reason longer than 20 chars", async () => {
    await expect(
      testProvider().void({ invoiceNumber: "CC1", reason: "x".repeat(21) }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("allowance lifecycle", () => {
  it("issues an allowance (immediate confirm) with ItemTaxAmt=0", async () => {
    let data: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.allowance.path), async ({ request }) => {
        data = parseRequest(await request.text());
        return HttpResponse.json(
          ceSuccess(
            { AllowanceNo: "A2606", InvoiceNumber: "CC1", AllowanceAmt: "105", RemainAmt: "0" },
            "開立折讓成功",
          ),
        );
      }),
    );
    const res = await testProvider().allowance({
      invoiceNumber: "CC1",
      allowanceId: "ORDER_1",
      items: [{ description: "商品", quantity: 1, unitPrice: 105, amount: 105 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
      providerOptions: {
        currency: "TWD",
        buyerEmail: "b@x.com",
        merchantOrderNo: "ORDER_1",
        confirm: true,
      },
    });
    expect(res.allowanceNumber).toBe("A2606");
    expect(res.totalAmount).toBe(105);
    expect(data).toMatchObject({
      InvoiceNo: "CC1",
      Status: "1",
      ItemTaxAmt: "0",
      TotalAmt: "105",
      BuyerEmail: "b@x.com",
      MerchantOrderNo: "ORDER_1",
    });
  });

  it("defaults to pending (Status=0) and falls back merchantOrderNo to allowanceId", async () => {
    let data: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.allowance.path), async ({ request }) => {
        data = parseRequest(await request.text());
        return HttpResponse.json(ceSuccess({ AllowanceNo: "A1", AllowanceAmt: "105" }));
      }),
    );
    await testProvider().allowance({
      invoiceNumber: "CC1",
      allowanceId: "ALLOW_9",
      items: twdInput.items,
      amount: twdInput.amount,
    });
    expect(data).toMatchObject({ Status: "0", MerchantOrderNo: "ALLOW_9" });
  });

  it("confirms and cancels a pending allowance (allowance_touch)", async () => {
    const seen: Record<string, string>[] = [];
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.allowanceTouch.path), async ({ request }) => {
        seen.push(parseRequest(await request.text()));
        return HttpResponse.json(
          ceSuccess({ AllowanceNo: "A1", AllowanceAmt: "105", RemainAmt: "0" }),
        );
      }),
    );
    await testProvider().confirmAllowance({
      allowanceNumber: "A1",
      orderId: "ORDER_1",
      totalAmount: 105,
    });
    await testProvider().cancelAllowance({
      allowanceNumber: "A1",
      orderId: "ORDER_1",
      totalAmount: 21.3,
      currency: "USD",
    });
    expect(seen[0]).toMatchObject({ AllowanceStatus: "C", AllowanceNo: "A1", TotalAmt: "105" });
    expect(seen[1]).toMatchObject({ AllowanceStatus: "D", TotalAmt: "21.30" });
  });

  it("voids a confirmed allowance", async () => {
    let data: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.voidAllowance.path), async ({ request }) => {
        data = parseRequest(await request.text());
        return HttpResponse.json(
          ceSuccess({ AllowanceNo: "A1", CreateTime: "2026-06-17 23:55:00" }, "作廢折讓成功"),
        );
      }),
    );
    const res = await testProvider().voidAllowance({ invoiceNumber: "CC1", allowanceNumber: "A1" });
    expect(res.allowanceNumber).toBe("A1");
    expect(data).toMatchObject({ AllowanceNo: "A1", InvalidReason: "作廢折讓" });
  });

  it("rejects a voidAllowance reason longer than 20 chars", async () => {
    await expect(
      testProvider().voidAllowance({
        invoiceNumber: "CC1",
        allowanceNumber: "A1",
        reason: "x".repeat(21),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("query", () => {
  const queryResult = {
    MerchantID: "3500001",
    InvoiceNumber: "CC00000014",
    InvoiceTransNo: "26061700000001",
    MerchantOrderNo: "ORDER_1",
    RandomNum: "0446",
    BuyerName: "跨境測試",
    BuyerAddress: "台北市",
    BuyerEmail: "b@x.com",
    InvoiceType: "07",
    Amt: "100",
    TaxAmt: "5",
    TotalAmt: "105",
    CreateTime: "2026-06-17 23:35:17",
    InvoiceStatus: "1",
    UploadStatus: "1",
    Currency: "TWD",
    ItemDetail: JSON.stringify([
      {
        ItemNum: 1,
        ItemName: "商品",
        ItemCount: 1,
        ItemWord: "式",
        ItemPrice: 105,
        ItemAmount: 105,
        ItemTaxType: 1,
      },
    ]),
  };

  it("queries by orderId (SearchType=1, needs totalAmount)", async () => {
    let data: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.search.path), async ({ request }) => {
        data = parseRequest(await request.text());
        return HttpResponse.json(ceSuccess(queryResult, "查詢成功"));
      }),
    );
    const res = await testProvider().query({
      orderId: "ORDER_1",
      providerOptions: { totalAmount: 105 },
    });
    expect(data).toMatchObject({ SearchType: "1", MerchantOrderNo: "ORDER_1", TotalAmt: "105" });
    expect(res.invoiceNumber).toBe("CC00000014");
    expect(res.status).toBe("ISSUED");
    expect(res.amount).toEqual({ salesAmount: 100, taxAmount: 5, totalAmount: 105 });
    expect(res.buyer.email).toBe("b@x.com");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      description: "商品",
      quantity: 1,
      unitPrice: 105,
      amount: 105,
      unit: "式",
    });
  });

  it("queries by invoiceNumber (SearchType=0, needs randomCode) and maps a voided status", async () => {
    let data: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.search.path), async ({ request }) => {
        data = parseRequest(await request.text());
        return HttpResponse.json(
          ceSuccess({
            ...queryResult,
            InvoiceStatus: "2",
            BuyerName: undefined,
            BuyerAddress: undefined,
            BuyerEmail: undefined,
            MerchantOrderNo: undefined,
            ItemDetail: undefined,
          }),
        );
      }),
    );
    const res = await testProvider().query({
      invoiceNumber: "CC00000014",
      providerOptions: { randomCode: "0446" },
    });
    expect(data).toMatchObject({ SearchType: "0", InvoiceNumber: "CC00000014", RandomNum: "0446" });
    expect(res.status).toBe("VOIDED");
    expect(res.orderId).toBeUndefined();
    expect(res.buyer.email).toBeUndefined();
    expect(res.items).toEqual([]);
  });

  it("queries a foreign-currency invoice by orderId with a 2-decimal TotalAmt", async () => {
    let data: Record<string, string> | undefined;
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.search.path), async ({ request }) => {
        data = parseRequest(await request.text());
        return HttpResponse.json(
          ceSuccess({
            ...queryResult,
            Amt: "20.30",
            TaxAmt: "1.00",
            TotalAmt: "21.30",
            Currency: "USD",
            CreateTime: "bad-date",
          }),
        );
      }),
    );
    const res = await testProvider().query({
      orderId: "ORDER_1",
      providerOptions: { totalAmount: 21.3, currency: "USD" },
    });
    expect(data?.TotalAmt).toBe("21.30");
    expect(res.amount.totalAmount).toBe(21.3);
    expect(res.invoiceDate).toBeInstanceOf(Date); // bad date → fallback to now
  });

  it("accepts an already-parsed array ItemDetail and tolerates malformed JSON", async () => {
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.search.path), () =>
        HttpResponse.json(ceSuccess({ ...queryResult, ItemDetail: "not-json" })),
      ),
    );
    const res = await testProvider().query({
      orderId: "ORDER_1",
      providerOptions: { totalAmount: 105 },
    });
    expect(res.items).toEqual([]);
  });

  it("rejects a query with neither invoiceNumber nor orderId", async () => {
    await expect(testProvider().query({})).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("maps INV20006 (查無發票資料) to NOT_FOUND", async () => {
    server.use(
      http.post(url(EZPAY_CB_ENDPOINTS.search.path), () =>
        HttpResponse.json(ceError("INV20006", "查無發票資料")),
      ),
    );
    await expect(
      testProvider().query({ invoiceNumber: "CC0", providerOptions: { randomCode: "0000" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EZPAY_CB_CURRENCIES, EZPAY_CB_ENDPOINTS } from "../index.js";
import { BASE, ceError, ceIssueSuccess, parseRequest, server, testProvider } from "./server.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const url = (path: string) => `${BASE}${path}`;
const buyer = { name: "幣別測試", email: "b@x.com" };

/** Minimal issue input for a given currency (TWD integer / foreign 2-decimal). */
const inputFor = (currency: string) => {
  const foreign = currency !== "TWD";
  return {
    orderId: "CCY",
    buyer,
    items: [{ description: `${currency}商品`, quantity: 1, unitPrice: 21, amount: 21 }],
    amount: { salesAmount: 20, taxAmount: 1, totalAmount: 21 },
    taxType: "TAXABLE" as const,
    priceMode: "TAX_INCLUSIVE" as const,
    currency,
    ...(foreign ? { exchangeRate: 1 } : {}),
  };
};

describe("EZPAY_CB_CURRENCIES (附件三)", () => {
  it("lists the 20 currencies the cross-border API accepts, including TWD", () => {
    expect(EZPAY_CB_CURRENCIES).toHaveLength(20);
    expect(new Set(EZPAY_CB_CURRENCIES).size).toBe(20); // no dupes
    expect(EZPAY_CB_CURRENCIES).toContain("TWD");
    for (const c of EZPAY_CB_CURRENCIES) expect(c).toMatch(/^[A-Z]{3}$/);
  });
});

describe("issue — every supported currency (附件三)", () => {
  it.each(EZPAY_CB_CURRENCIES)(
    "issues a %s invoice with the right amount formatting",
    async (currency) => {
      let data: Record<string, string> | undefined;
      server.use(
        http.post(url(EZPAY_CB_ENDPOINTS.issue.path), async ({ request }) => {
          data = parseRequest(await request.text());
          return HttpResponse.json(
            ceIssueSuccess({
              MerchantID: "3500001",
              MerchantOrderNo: "CCY",
              InvoiceNumber: "CC00000099",
              RandomNum: "0001",
              TotalAmt: "21",
              CreateTime: "2026-06-17 12:00:00",
            }),
          );
        }),
      );
      const res = await testProvider().issue(inputFor(currency));
      expect(res.invoiceNumber).toBe("CC00000099");
      expect(data?.Currency).toBe(currency);
      if (currency === "TWD") {
        // integer amounts, no exchange annotation needed
        expect(data).toMatchObject({ Amt: "20", TaxAmt: "1", TotalAmt: "21", ExchangeRate: "1" });
      } else {
        // foreign → 2-decimal amounts
        expect(data).toMatchObject({
          Amt: "20.00",
          TaxAmt: "1.00",
          TotalAmt: "21.00",
          ItemPrice: "21.00",
          ItemAmt: "21.00",
        });
      }
    },
  );
});

describe("issue — a currency outside 附件三", () => {
  it.each(["INR", "BRL", "RUB", "MXN", "ZZZ"])(
    "maps ezPay's INV10002 rejection of %s to VALIDATION",
    async (currency) => {
      server.use(
        http.post(url(EZPAY_CB_ENDPOINTS.issue.path), () =>
          HttpResponse.json(ceError("INV10002", "欄位資料格式錯誤-Currency")),
        ),
      );
      await expect(testProvider().issue(inputFor(currency))).rejects.toMatchObject({
        code: "VALIDATION",
        rawCode: "INV10002",
      });
    },
  );
});

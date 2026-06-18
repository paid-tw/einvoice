import type { IssueInvoiceInput } from "@paid-tw/einvoice";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { assertValidCrossBorderIssue, EZPAY_CB_ENDPOINTS, resolveCurrency } from "../index.js";
import { BASE, ceIssueSuccess, server, testProvider } from "./server.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const valid = (): IssueInvoiceInput => ({
  orderId: "ORDER_1",
  buyer: { name: "跨境測試", email: "b@x.com" },
  items: [{ description: "商品", quantity: 1, unitPrice: 105, amount: 105 }],
  amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
  taxType: "TAXABLE" as const,
  priceMode: "TAX_INCLUSIVE" as const,
});

const expectCode = (input: IssueInvoiceInput, code: string) => {
  expect(() => assertValidCrossBorderIssue(input)).toThrowError(expect.objectContaining({ code }));
};

describe("resolveCurrency", () => {
  it("defaults to TWD and upper-cases", () => {
    expect(resolveCurrency({})).toBe("TWD");
    expect(resolveCurrency({ currency: "usd" })).toBe("USD");
  });
});

describe("assertValidCrossBorderIssue — capability rejections (UNSUPPORTED)", () => {
  it("rejects a 統一編號 (B2B)", () => expectCode({ ...valid(), buyer: { email: "b@x.com", ubn: "12345678" } }, "UNSUPPORTED"));
  it("rejects a carrier", () => expectCode({ ...valid(), carrier: { type: "MEMBER" } }, "UNSUPPORTED"));
  it("rejects a donation", () => expectCode({ ...valid(), donation: { npoban: "168001" } }, "UNSUPPORTED"));
  it("rejects mixed per-item tax types", () =>
    expectCode(
      {
        ...valid(),
        items: [
          { description: "a", quantity: 1, unitPrice: 50, amount: 50, taxType: "TAXABLE" },
          { description: "b", quantity: 1, unitPrice: 55, amount: 55, taxType: "TAX_FREE" },
        ],
      },
      "UNSUPPORTED",
    ));
});

describe("assertValidCrossBorderIssue — format/amount (VALIDATION)", () => {
  it("passes a valid TWD payload", () => expect(() => assertValidCrossBorderIssue(valid())).not.toThrow());
  it("passes a valid foreign payload", () =>
    expect(() =>
      assertValidCrossBorderIssue({ ...valid(), items: [{ description: "s", quantity: 1, unitPrice: 21.3, amount: 21.3 }], amount: { salesAmount: 20.3, taxAmount: 1, totalAmount: 21.3 }, currency: "USD", exchangeRate: 31.5 }),
    ).not.toThrow());

  it("rejects a bad orderId", () => expectCode({ ...valid(), orderId: "has space!" }, "VALIDATION"));
  it("rejects an orderId over 20 chars", () => expectCode({ ...valid(), orderId: "x".repeat(21) }, "VALIDATION"));
  it("requires buyer.email", () => expectCode({ ...valid(), buyer: { name: "n" } }, "VALIDATION"));
  it("rejects a malformed currency", () => expectCode({ ...valid(), currency: "US" }, "VALIDATION"));
  it("requires exchangeRate for a foreign currency", () => expectCode({ ...valid(), currency: "USD" }, "VALIDATION"));
  it("requires at least one item", () => expectCode({ ...valid(), items: [] }, "VALIDATION"));
  it("rejects a non-integer TWD amount", () => expectCode({ ...valid(), amount: { salesAmount: 100.5, taxAmount: 5, totalAmount: 105.5 }, items: [{ description: "商品", quantity: 1, unitPrice: 105.5, amount: 105.5 }] }, "VALIDATION"));
  it("rejects a foreign amount with >2 decimals", () => expectCode({ ...valid(), currency: "USD", exchangeRate: 31, amount: { salesAmount: 20.123, taxAmount: 1, totalAmount: 21.123 }, items: [{ description: "s", quantity: 1, unitPrice: 21.123, amount: 21.123 }] }, "VALIDATION"));
  it("rejects when sales + tax != total", () => expectCode({ ...valid(), amount: { salesAmount: 100, taxAmount: 5, totalAmount: 999 } }, "VALIDATION"));
  it("rejects a non-numeric item amount", () => expectCode({ ...valid(), items: [{ description: "商品", quantity: 1, unitPrice: -5, amount: -5 }], amount: { salesAmount: -10, taxAmount: 0, totalAmount: -10 } }, "VALIDATION"));
  it("rejects an item price with >2 decimals while the invoice totals are valid (foreign)", () =>
    expectCode({ ...valid(), currency: "USD", exchangeRate: 31, amount: { salesAmount: 20.3, taxAmount: 1, totalAmount: 21.3 }, items: [{ description: "s", quantity: 1, unitPrice: 21.123, amount: 21.3 }] }, "VALIDATION"));
  it("rejects an item whose amount != quantity × unitPrice", () => expectCode({ ...valid(), items: [{ description: "商品", quantity: 2, unitPrice: 105, amount: 105 }] }, "VALIDATION"));
  it("rejects items not summing to total", () => expectCode({ ...valid(), items: [{ description: "商品", quantity: 1, unitPrice: 50, amount: 50 }] }, "VALIDATION"));
});

describe("shared schema adoption (void / voidAllowance / query)", () => {
  it("rejects invalid query input as a normalized InvoiceError (parseInput)", async () => {
    // query/void/voidAllowance use the shared schemas; issue/allowance stay
    // custom (foreign-currency decimal amounts conflict with the integer schema).
    await expect(testProvider().query({})).rejects.toMatchObject({
      code: "VALIDATION",
      provider: "ezpay-crossborder",
    });
  });
});

describe("validatePayload: false", () => {
  it("skips local validation and lets the request reach ezPay", async () => {
    server.use(http.post(`${BASE}${EZPAY_CB_ENDPOINTS.issue.path}`, () => HttpResponse.json(ceIssueSuccess({ MerchantID: "3500001", InvoiceNumber: "CC1", RandomNum: "0001", TotalAmt: "105", CreateTime: "2026-06-17 00:00:00" }))));
    // buyer.email missing would normally throw VALIDATION — bypassed here.
    const res = await testProvider({ validatePayload: false }).issue({ ...valid(), buyer: { name: "n" } });
    expect(res.invoiceNumber).toBe("CC1");
  });
});

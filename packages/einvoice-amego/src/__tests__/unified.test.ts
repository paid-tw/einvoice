import { createHash } from "node:crypto";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { IssueInvoiceInput } from "@paid-tw/einvoice";
import { APP_KEY, BASE, parseBody, SELLER, server, testProvider } from "./server.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ISSUE_OK = {
  code: 0,
  msg: "",
  invoice_number: "AA26513022",
  invoice_time: 1781648659,
  random_number: "9207",
  barcode: "11506AA265130229207",
};

function issueInput(overrides: Partial<IssueInvoiceInput> = {}): IssueInvoiceInput {
  return {
    orderId: "order-1",
    buyer: {},
    items: [{ description: "商品", quantity: 1, unitPrice: 105, amount: 105 }],
    amount: { salesAmount: 105, taxAmount: 0, totalAmount: 105 },
    taxType: "TAXABLE",
    priceMode: "TAX_INCLUSIVE",
    ...overrides,
  };
}

describe("issue (f0401)", () => {
  it("signs the request and maps invoice_time → Date, random_number → randomCode", async () => {
    let captured: ReturnType<typeof parseBody> | undefined;
    server.use(
      http.post(`${BASE}/json/f0401`, async ({ request }) => {
        captured = parseBody(await request.text());
        return HttpResponse.json(ISSUE_OK);
      }),
    );

    const res = await testProvider().issue(issueInput());

    expect(res.invoiceNumber).toBe("AA26513022");
    expect(res.randomCode).toBe("9207");
    expect(res.invoiceDate.getTime()).toBe(1781648659 * 1000);
    expect(res.status).toBe("ISSUED");

    // signing: invoice = seller, sign = md5(data + time + appKey)
    expect(captured?.invoice).toBe(SELLER);
    const expectedSign = createHash("md5")
      .update(captured!.raw.get("data")! + captured!.time! + APP_KEY)
      .digest("hex");
    expect(captured?.sign).toBe(expectedSign);
  });

  it("uses B2C convention (SalesAmount = total, TaxAmount = 0) for anonymous buyers", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(`${BASE}/json/f0401`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json(ISSUE_OK);
      }),
    );

    await testProvider().issue(issueInput({ amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 } }));

    expect(data?.BuyerIdentifier).toBe("0000000000");
    expect(data?.SalesAmount).toBe(105);
    expect(data?.TaxAmount).toBe(0);
    expect(data?.TotalAmount).toBe(105);
  });

  it("uses B2B convention (SalesAmount untaxed, TaxAmount = total − sales) when buyer has 統編", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(`${BASE}/json/f0401`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json(ISSUE_OK);
      }),
    );

    await testProvider().issue(
      issueInput({
        buyer: { taxId: "28080623", name: "光貿科技有限公司" },
        items: [{ description: "商品", quantity: 1, unitPrice: 168, amount: 168 }],
        amount: { salesAmount: 160, taxAmount: 8, totalAmount: 168 },
      }),
    );

    expect(data?.BuyerIdentifier).toBe("28080623");
    expect(data?.SalesAmount).toBe(160);
    expect(data?.TaxAmount).toBe(8);
    expect(data?.TotalAmount).toBe(168);
  });

  it("maps a mobile-barcode carrier to CarrierType 3J0002", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(`${BASE}/json/f0401`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json(ISSUE_OK);
      }),
    );
    await testProvider().issue(issueInput({ carrier: { type: "MOBILE_BARCODE", code: "/ABC1234" } }));
    expect(data?.CarrierType).toBe("3J0002");
    expect(data?.CarrierId1).toBe("/ABC1234");
  });
});

describe("void / allowance / query", () => {
  it("void (f0501) posts InvoiceNumber + CancelReason", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(`${BASE}/json/f0501`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json({ code: 0, msg: "" });
      }),
    );
    const res = await testProvider().void({ invoiceNumber: "AA26513022", reason: "客戶取消" });
    expect(data?.InvoiceNumber).toBe("AA26513022");
    expect(data?.CancelReason).toBe("客戶取消");
    expect(res.status).toBe("VOIDED");
  });

  it("allowance (g0401) maps items and returns the allowance number", async () => {
    server.use(
      http.post(`${BASE}/json/g0401`, () =>
        HttpResponse.json({ code: 0, allowance_number: "AL00000001", allowance_time: 1781648900 }),
      ),
    );
    const res = await testProvider().allowance({
      invoiceNumber: "AA26513022",
      allowanceId: "ALW-1",
      items: [{ description: "退款", quantity: 1, unitPrice: 105, amount: 105 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
    });
    expect(res.allowanceNumber).toBe("AL00000001");
    expect(res.invoiceNumber).toBe("AA26513022");
    expect(res.allowanceDate.getTime()).toBe(1781648900 * 1000);
  });

  it("voidAllowance (g0501) posts both numbers", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(`${BASE}/json/g0501`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json({ code: 0 });
      }),
    );
    await testProvider().voidAllowance({ invoiceNumber: "AA26513022", allowanceNumber: "AL00000001" });
    expect(data?.InvoiceNumber).toBe("AA26513022");
    expect(data?.AllowanceNumber).toBe("AL00000001");
  });

  it("query (invoice_query) maps the amount block and buyer", async () => {
    server.use(
      http.post(`${BASE}/json/invoice_query`, () =>
        HttpResponse.json({
          code: 0,
          invoice_number: "AA26513022",
          invoice_time: 1781648659,
          random_number: "9207",
          SalesAmount: 100,
          TaxAmount: 5,
          TotalAmount: 105,
          BuyerIdentifier: "28080623",
          BuyerName: "光貿科技有限公司",
        }),
      ),
    );
    const res = await testProvider().query({ invoiceNumber: "AA26513022" });
    expect(res.amount).toEqual({ salesAmount: 100, taxAmount: 5, totalAmount: 105 });
    expect(res.buyer.taxId).toBe("28080623");
  });
});

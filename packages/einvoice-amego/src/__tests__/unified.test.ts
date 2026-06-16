import { createHash } from "node:crypto";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { IssueInvoiceInput } from "@paid-tw/einvoice";
import { APP_KEY, BASE, parseBody, SELLER, server, testProvider } from "./server.js";
import {
  ALLOWANCE_OK,
  INVOICE_QUERY_OK,
  ISSUE_OK,
  VOID_OK,
} from "./fixtures.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

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

    expect(res.invoiceNumber).toBe("AA26513024");
    expect(res.randomCode).toBe("7081");
    expect(res.invoiceDate.getTime()).toBe(1781650039 * 1000);
    expect(res.status).toBe("ISSUED");

    expect(captured?.invoice).toBe(SELLER);
    const expectedSign = createHash("md5")
      .update(captured!.raw.get("data")! + captured!.time! + APP_KEY)
      .digest("hex");
    expect(captured?.sign).toBe(expectedSign);
  });

  it("sends B2C amounts (SalesAmount = total, TaxAmount = 0) + DetailVat=1 for anonymous buyers", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(`${BASE}/json/f0401`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json(ISSUE_OK);
      }),
    );
    await testProvider().issue(issueInput());
    expect(data?.BuyerIdentifier).toBe("0000000000");
    expect(data?.SalesAmount).toBe(105);
    expect(data?.TaxAmount).toBe(0);
    expect(data?.DetailVat).toBe(1);
  });

  it("sends B2B split (SalesAmount untaxed, TaxAmount = total − sales) for 統編 buyers", async () => {
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
        amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
      }),
    );
    expect(data?.BuyerIdentifier).toBe("28080623");
    expect(data?.SalesAmount).toBe(100);
    expect(data?.TaxAmount).toBe(5);
  });

  it("maps member carrier to the literal 'amego' code", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(`${BASE}/json/f0401`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json(ISSUE_OK);
      }),
    );
    await testProvider().issue(issueInput({ carrier: { type: "MEMBER", code: "member@x.com" } }));
    expect(data?.CarrierType).toBe("amego");
  });
});

describe("void (f0501) — array payload", () => {
  it("posts an array of { CancelInvoiceNumber }, not an object", async () => {
    let body: ReturnType<typeof parseBody> | undefined;
    server.use(
      http.post(`${BASE}/json/f0501`, async ({ request }) => {
        body = parseBody(await request.text());
        return HttpResponse.json(VOID_OK);
      }),
    );
    const res = await testProvider().void({ invoiceNumber: "AA26513024", reason: "x" });
    // The raw `data` field must be a JSON ARRAY string.
    expect(Array.isArray(body?.data)).toBe(true);
    expect(body?.data).toEqual([{ CancelInvoiceNumber: "AA26513024" }]);
    expect(res.status).toBe("VOIDED");
  });
});

describe("allowance (g0401) — array, tax-exclusive, per-line Tax", () => {
  it("wraps in an array with OriginalInvoiceNumber + per-line Tax; returns the supplied id", async () => {
    let body: ReturnType<typeof parseBody> | undefined;
    server.use(
      http.post(`${BASE}/json/g0401`, async ({ request }) => {
        body = parseBody(await request.text());
        return HttpResponse.json(ALLOWANCE_OK);
      }),
    );
    const res = await testProvider().allowance({
      invoiceNumber: "AA26513024",
      allowanceId: "ALW-1",
      items: [{ description: "退款", quantity: 1, unitPrice: 100, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
      providerOptions: { originalInvoiceDate: 20260617, buyer: { taxId: "28080623" } },
    });
    const arr = body?.data as unknown as Array<Record<string, unknown>>;
    expect(Array.isArray(arr)).toBe(true);
    expect(arr[0]?.AllowanceNumber).toBe("ALW-1");
    expect(arr[0]?.TotalAmount).toBe(100); // 未稅 合計
    expect(arr[0]?.TaxAmount).toBe(5);
    const item = (arr[0]?.ProductItem as Array<Record<string, unknown>>)[0];
    expect(item?.OriginalInvoiceNumber).toBe("AA26513024");
    expect(item?.Tax).toBe(5);
    // g0401 returns no number — adapter echoes the supplied id.
    expect(res.allowanceNumber).toBe("ALW-1");
  });

  it("auto-resolves the original invoice date via invoice_query when not provided", async () => {
    let queried = false;
    server.use(
      http.post(`${BASE}/json/invoice_query`, () => {
        queried = true;
        return HttpResponse.json(INVOICE_QUERY_OK);
      }),
      http.post(`${BASE}/json/g0401`, () => HttpResponse.json(ALLOWANCE_OK)),
    );
    await testProvider().allowance({
      invoiceNumber: "AA26513024",
      allowanceId: "ALW-2",
      items: [{ description: "退款", quantity: 1, unitPrice: 100, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
    });
    expect(queried).toBe(true);
  });
});

describe("voidAllowance (g0501) — array payload", () => {
  it("posts an array of { CancelAllowanceNumber }", async () => {
    let body: ReturnType<typeof parseBody> | undefined;
    server.use(
      http.post(`${BASE}/json/g0501`, async ({ request }) => {
        body = parseBody(await request.text());
        return HttpResponse.json(VOID_OK);
      }),
    );
    await testProvider().voidAllowance({ invoiceNumber: "AA26513024", allowanceNumber: "ALW-1" });
    expect(body?.data).toEqual([{ CancelAllowanceNumber: "ALW-1" }]);
  });
});

describe("query (invoice_query) — type discriminator + nested data", () => {
  it("sends { type:'invoice', invoice_number } and parses the nested snake_case data", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(`${BASE}/json/invoice_query`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json(INVOICE_QUERY_OK);
      }),
    );
    const res = await testProvider().query({ invoiceNumber: "AA26513024" });
    expect(data).toMatchObject({ type: "invoice", invoice_number: "AA26513024" });
    expect(res.amount).toEqual({ salesAmount: 100, taxAmount: 5, totalAmount: 105 });
    expect(res.buyer.taxId).toBe("28080623");
    expect(res.orderId).toBe("LC1781650039");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.unitPrice).toBe(105);
    // invoice_date 20260617 → Date
    expect(res.invoiceDate.getFullYear()).toBe(2026);
    expect(res.status).toBe("ISSUED");
  });

  it("derives VOIDED when cancel_date > 0", async () => {
    server.use(
      http.post(`${BASE}/json/invoice_query`, () =>
        HttpResponse.json({ code: 0, data: { ...INVOICE_QUERY_OK.data, cancel_date: 1781650099 } }),
      ),
    );
    const res = await testProvider().query({ invoiceNumber: "AA26513024" });
    expect(res.status).toBe("VOIDED");
  });

  it("derives ALLOWANCE when the invoice has allowances", async () => {
    server.use(
      http.post(`${BASE}/json/invoice_query`, () =>
        HttpResponse.json({
          code: 0,
          data: { ...INVOICE_QUERY_OK.data, allowance: [{ allowance_number: "ALW1" }] },
        }),
      ),
    );
    const res = await testProvider().query({ invoiceNumber: "AA26513024" });
    expect(res.status).toBe("ALLOWANCE");
  });
});

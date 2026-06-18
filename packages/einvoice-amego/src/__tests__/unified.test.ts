import { createHash } from "node:crypto";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { IssueInvoiceInput } from "@paid-tw/einvoice";
import { createAmegoProvider } from "../provider.js";
import { APP_KEY, BASE, parseBody, SELLER, server, testProvider } from "./server.js";
import { ALLOWANCE_OK, CUSTOM_ISSUE_OK, INVOICE_QUERY_OK, ISSUE_OK, VOID_OK } from "./fixtures.js";

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
  it("rejects invalid input as a normalized InvoiceError (parseInput, not a raw ZodError)", async () => {
    await expect(
      testProvider().issue(
        issueInput({ amount: { salesAmount: 100, taxAmount: 5, totalAmount: 999 } }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION", provider: "amego" });
  });

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

  it("obeys Amego's wire rules: form-urlencoded Content-Type, url-encoded data, sign over the raw JSON", async () => {
    let rawBody = "";
    let contentType = "";
    server.use(
      http.post(`${BASE}/json/f0401`, async ({ request }) => {
        contentType = request.headers.get("content-type") ?? "";
        rawBody = await request.text();
        return HttpResponse.json(ISSUE_OK);
      }),
    );
    // A buyer name with chars that MUST be url-encoded on the wire (中文 + &).
    await testProvider().issue(issueInput({ buyer: { ubn: "28080623", name: "測試 & 公司" } }));

    // (3) Content-Type is form-urlencoded, never application/json.
    expect(contentType).toContain("application/x-www-form-urlencoded");
    expect(contentType).not.toContain("application/json");

    // (2) The `data` segment on the wire is url-encoded (%XX), not literal — so
    //     Amego's single url-decode recovers the JSON. The `&` inside the JSON
    //     must be %26, else it would split the form fields.
    const rawData = /(?:^|&)data=([^&]*)/.exec(rawBody)![1]!;
    expect(rawData).toMatch(/%[0-9A-Fa-f]{2}/);
    expect(rawData).not.toContain("測"); // Chinese is encoded, not literal
    expect(rawData).toContain("%26"); // the JSON's & is encoded
    const decoded = decodeURIComponent(rawData.replace(/\+/g, " "));
    expect(JSON.parse(decoded).BuyerName).toBe("測試 & 公司");

    // (1) sign = md5(rawJSON + time + appKey) — over the DECODED json (what Amego
    //     sees after its url-decode), NOT the encoded wire form.
    const time = /(?:^|&)time=([^&]*)/.exec(rawBody)![1]!;
    const wireSign = /(?:^|&)sign=([^&]*)/.exec(rawBody)![1]!;
    expect(wireSign).toBe(
      createHash("md5")
        .update(decoded + time + APP_KEY)
        .digest("hex"),
    );
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
        buyer: { ubn: "28080623", name: "光貿科技有限公司" },
        amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
      }),
    );
    expect(data?.BuyerIdentifier).toBe("28080623");
    expect(data?.SalesAmount).toBe(100);
    expect(data?.TaxAmount).toBe(5);
  });

  it("annotates a foreign-currency sale with Currency + ExchangeRate (amounts stay TWD)", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(`${BASE}/json/f0401`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json(ISSUE_OK);
      }),
    );
    await testProvider().issue(issueInput({ currency: "USD", exchangeRate: 31.5 }));
    expect(data?.Currency).toBe("USD");
    expect(data?.ExchangeRate).toBe(31.5);
    expect(data?.TotalAmount).toBe(105); // statutory amount remains TWD
  });

  it("omits Currency for the default TWD", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(`${BASE}/json/f0401`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json(ISSUE_OK);
      }),
    );
    await testProvider().issue(issueInput({ currency: "TWD" }));
    expect(data?.Currency).toBeUndefined();
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

describe("issue — local payload validation", () => {
  it("rejects an invalid built payload before any network call (VALIDATION)", async () => {
    // onUnhandledRequest:'error' would throw if a request escaped — so this also
    // proves no request is made.
    await expect(
      testProvider().issue(
        issueInput({
          items: [{ description: "字".repeat(257), quantity: 1, unitPrice: 105, amount: 105 }],
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION", provider: "amego" });
  });

  it("can bypass local validation with validatePayload:false", async () => {
    let hit = false;
    server.use(
      http.post(`${BASE}/json/f0401`, () => {
        hit = true;
        return HttpResponse.json(ISSUE_OK);
      }),
    );
    const provider = createAmegoProvider({
      sellerUbn: "12345678",
      appKey: "k",
      baseUrl: BASE,
      validatePayload: false,
    });
    await provider.issue(
      issueInput({
        items: [{ description: "字".repeat(257), quantity: 1, unitPrice: 105, amount: 105 }],
      }),
    );
    expect(hit).toBe(true);
  });
});

describe("issueCustom (f0401_custom) — array + validation", () => {
  const validRecord = {
    OrderId: "o1",
    InvoiceDate: "20260617",
    InvoiceTime: "16:40:42",
    RandomNumber: "4321",
    PrintMark: "Y",
    BuyerIdentifier: "0000000000",
    BuyerName: "消費者",
    ProductItem: [{ Description: "x", Quantity: 1, UnitPrice: 105, Amount: 105, TaxType: 1 }],
    SalesAmount: 105,
    FreeTaxSalesAmount: 0,
    ZeroTaxSalesAmount: 0,
    TaxType: 1,
    TaxRate: "0.05",
    TaxAmount: 0,
    TotalAmount: 105,
  };

  it("posts an ARRAY with the merchant InvoiceNumber and returns the data[] response", async () => {
    let body: ReturnType<typeof parseBody> | undefined;
    server.use(
      http.post(`${BASE}/json/f0401_custom`, async ({ request }) => {
        body = parseBody(await request.text());
        return HttpResponse.json(CUSTOM_ISSUE_OK);
      }),
    );
    const res = await testProvider().invoice.issueCustom("EE00006850", validRecord);
    // request: array carrying the InvoiceNumber
    const arr = body?.data as unknown as Array<Record<string, unknown>>;
    expect(Array.isArray(arr)).toBe(true);
    expect(arr[0]?.InvoiceNumber).toBe("EE00006850");
    // response: data[] array (no invoice_time/random_number), incl. base64_data slot
    const out = (res.data as Array<Record<string, unknown>>)[0]!;
    expect(out.invoice_number).toBe("EE00006850");
    expect(out.qrcode_right).toContain("自訂配號");
    expect("base64_data" in out).toBe(true);
    expect("invoice_time" in out).toBe(false);
  });

  it("rejects a malformed InvoiceDate locally", async () => {
    await expect(
      testProvider().invoice.issueCustom("AA00000010", {
        ...validRecord,
        InvoiceDate: "2026-06-17",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
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
      providerOptions: { originalInvoiceDate: 20260617, buyer: { ubn: "28080623" } },
    });
    const arr = body?.data as unknown as Array<Record<string, unknown>>;
    expect(Array.isArray(arr)).toBe(true);
    expect(arr[0]?.AllowanceNumber).toBe("ALW-1");
    expect(arr[0]?.TotalAmount).toBe(100); // 未稅 合計
    expect(arr[0]?.TaxAmount).toBe(5);
    const item = (arr[0]!.ProductItem as Array<Record<string, unknown>>)[0];
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
    expect(res.buyer.ubn).toBe("28080623");
    expect(res.orderId).toBe("LC1781650039");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.unitPrice).toBe(105);
    expect(res.items[0]?.taxType).toBe("TAXABLE"); // mapped from tax_type 1
    // invoice_date 20260617 → Date
    expect(res.invoiceDate.getFullYear()).toBe(2026);
    expect(res.status).toBe("ISSUED");
  });

  it("queries by orderId via { type:'order', order_id }", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(`${BASE}/json/invoice_query`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json(INVOICE_QUERY_OK);
      }),
    );
    const res = await testProvider().query({ orderId: "LC1781650039" });
    expect(data).toEqual({ type: "order", order_id: "LC1781650039" });
    expect(res.invoiceNumber).toBe("AA26513024");
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

  it("treats a B2C placeholder 統編 as none and maps every per-item tax type", async () => {
    server.use(
      http.post(`${BASE}/json/invoice_query`, () =>
        HttpResponse.json({
          code: 0,
          data: {
            ...INVOICE_QUERY_OK.data,
            buyer_identifier: "0000000000", // B2C placeholder → ubn undefined
            product_item: [
              {
                description: "應稅",
                quantity: 1,
                unit_price: 100,
                amount: 100,
                tax_type: 1,
                unit: "個",
                remark: "r",
              },
              { description: "零稅率", quantity: 1, unit_price: 100, amount: 100, tax_type: 2 },
              { description: "免稅", quantity: 1, unit_price: 100, amount: 100, tax_type: 3 },
              { description: "未知", quantity: 1, unit_price: 100, amount: 100, tax_type: 9 },
            ],
          },
        }),
      ),
    );
    const res = await testProvider().query({ invoiceNumber: "AA26513024" });
    expect(res.buyer.ubn).toBeUndefined();
    expect(res.items.map((i) => i.taxType)).toEqual([
      "TAXABLE",
      "ZERO_RATED",
      "TAX_FREE",
      undefined,
    ]);
    expect(res.items[0]?.unit).toBe("個");
    expect(res.items[0]?.remark).toBe("r");
  });

  it("returns empty items when the response carries no product_item", async () => {
    server.use(
      http.post(`${BASE}/json/invoice_query`, () =>
        HttpResponse.json({
          code: 0,
          data: { invoice_number: "AA26513024", invoice_date: 20260617, total_amount: 105 },
        }),
      ),
    );
    const res = await testProvider().query({ invoiceNumber: "AA26513024" });
    expect(res.items).toEqual([]);
  });
});

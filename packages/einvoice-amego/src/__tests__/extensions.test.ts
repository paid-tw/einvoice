import { createHash } from "node:crypto";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AmegoProvider } from "../provider.js";
import {
  ENDPOINTS,
  TRACK_CATEGORY,
  TRACK_LAYER,
  TRACK_SOURCE,
  TRACK_STATUS,
} from "../endpoints.js";
import { APP_KEY, BASE, parseBody, server, testProvider } from "./server.js";
import {
  ALLOWANCE_LIST_OK,
  ALLOWANCE_QUERY_OK,
  FILE_URL_OK,
  LOTTERY_STATUS_OK,
  LOTTERY_TYPE_OK,
  TIME_OK,
  TRACK_ALL_OK,
  TRACK_GET_OK,
  TRACK_STATUS_OK,
} from "./fixtures.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * Per-endpoint contract. For every Amego-specific endpoint we assert the exact
 * path AND the exact request `data` shape — because Amego is inconsistent:
 * some endpoints want PascalCase, some snake_case, some an array, some a
 * `type` discriminator. These shapes are all verified against the live sandbox.
 */
const CASES: Array<{
  name: string;
  path: string;
  invoke: (p: AmegoProvider) => Promise<unknown>;
  expectData: unknown;
}> = [
  {
    name: "invoice.query (snake_case + type)",
    path: ENDPOINTS.invoiceQuery,
    invoke: (p) => p.invoice.query("AA1"),
    expectData: { type: "invoice", invoice_number: "AA1" },
  },
  {
    name: "invoice.list (date_select/date_start/date_end/limit, numeric YYYYMMDD)",
    path: ENDPOINTS.invoiceList,
    invoke: (p) => p.invoice.list({ startDate: "2026-06-01", endDate: "2026-06-30", page: 2 }),
    expectData: { date_select: 1, date_start: 20260601, date_end: 20260630, limit: 20, page: 2 },
  },
  {
    name: "invoice.print (type + snake_case)",
    path: ENDPOINTS.invoicePrint,
    invoke: (p) => p.invoice.print("AA1", 7),
    expectData: { type: "invoice", invoice_number: "AA1", printer_type: 7 },
  },
  {
    name: "invoice.print with printer_lang",
    path: ENDPOINTS.invoicePrint,
    invoke: (p) => p.invoice.print("AA1", 7, 3),
    expectData: { type: "invoice", invoice_number: "AA1", printer_type: 7, printer_lang: 3 },
  },
  {
    name: "invoice.file (snake_case + type)",
    path: ENDPOINTS.invoiceFile,
    invoke: (p) => p.invoice.file("AA1"),
    expectData: { type: "invoice", invoice_number: "AA1", download_style: 0 },
  },
  {
    name: "invoice.status (ARRAY)",
    path: ENDPOINTS.invoiceStatus,
    invoke: (p) => p.invoice.status(["AA1", "AA2"]),
    expectData: [{ InvoiceNumber: "AA1" }, { InvoiceNumber: "AA2" }],
  },
  {
    name: "allowances.query (snake_case)",
    path: ENDPOINTS.allowanceQuery,
    invoke: (p) => p.allowances.query("ALW1"),
    expectData: { allowance_number: "ALW1" },
  },
  {
    name: "allowances.status (ARRAY, PascalCase)",
    path: ENDPOINTS.allowanceStatus,
    invoke: (p) => p.allowances.status(["ALW1"]),
    expectData: [{ AllowanceNumber: "ALW1" }],
  },
  {
    name: "allowances.file (snake_case)",
    path: ENDPOINTS.allowanceFile,
    invoke: (p) => p.allowances.file("ALW1"),
    expectData: { allowance_number: "ALW1", download_style: 0 },
  },
  {
    name: "allowances.print (snake_case)",
    path: ENDPOINTS.allowancePrint,
    invoke: (p) => p.allowances.print("ALW1", 7),
    expectData: { allowance_number: "ALW1", printer_type: 7 },
  },
  {
    name: "banQuery (ARRAY of {ban})",
    path: ENDPOINTS.banQuery,
    invoke: (p) => p.banQuery("28080623", "85101991"),
    expectData: [{ ban: "28080623" }, { ban: "85101991" }],
  },
  {
    name: "barcodeQuery (camelCase barCode)",
    path: ENDPOINTS.barcode,
    invoke: (p) => p.barcodeQuery("/TRM+O+P"),
    expectData: { barCode: "/TRM+O+P" },
  },
  {
    name: "allowances.list (date_select/date_start/date_end/limit)",
    path: ENDPOINTS.allowanceList,
    invoke: (p) => p.allowances.list({ startDate: "2026-06-01", endDate: 20260630, limit: 50 }),
    expectData: { date_select: 1, date_start: 20260601, date_end: 20260630, limit: 50, page: 1 },
  },
  {
    name: "track.all (Year/Period PascalCase)",
    path: ENDPOINTS.trackAll,
    invoke: (p) => p.track.all({ year: 2026, period: 2 }),
    expectData: { Year: 2026, Period: 2 },
  },
  {
    name: "track.get (Year/Period/Book PascalCase)",
    path: ENDPOINTS.trackGet,
    invoke: (p) => p.track.get({ year: 2026, period: 2, book: 1 }),
    expectData: { Year: 2026, Period: 2, Book: 1 },
  },
  {
    name: "track.status (Year/Period PascalCase)",
    path: ENDPOINTS.trackStatus,
    invoke: (p) => p.track.status({ year: 2026, period: 2, trackApiCode: "API01" }),
    expectData: { Year: 2026, Period: 2, TrackApiCode: "API01" },
  },
];

describe("Amego endpoint contracts (verified live shapes)", () => {
  for (const c of CASES) {
    it(`${c.name} → POST ${c.path}`, async () => {
      let data: unknown;
      server.use(
        http.post(`${BASE}${c.path}`, async ({ request }) => {
          data = parseBody(await request.text()).data;
          return HttpResponse.json({ code: 0, msg: "" });
        }),
      );
      await c.invoke(testProvider());
      expect(data).toEqual(c.expectData);
    });
  }

  it("time() is a plain GET (no signing) and returns the time breakdown", async () => {
    let method: string | undefined;
    let hadBody = true;
    server.use(
      http.get(`${BASE}${ENDPOINTS.time}`, ({ request }) => {
        method = request.method;
        hadBody = request.body !== null;
        return HttpResponse.json(TIME_OK);
      }),
    );
    const res = await testProvider().time();
    expect(method).toBe("GET");
    expect(hadBody).toBe(false);
    expect(res.timestamp).toBe(TIME_OK.timestamp);
    expect(res.hour).toBe(8);
  });

  it("banQuery rejects an invalid 統編 checksum locally (no network call)", async () => {
    await expect(testProvider().banQuery("28080624")).rejects.toMatchObject({
      code: "VALIDATION",
      provider: "amego",
    });
  });

  it("barcodeQuery rejects a malformed 手機條碼 locally (no network call)", async () => {
    await expect(testProvider().barcodeQuery("ABC")).rejects.toMatchObject({
      code: "VALIDATION",
      provider: "amego",
    });
  });

  it("raw() can call any endpoint directly", async () => {
    server.use(http.post(`${BASE}/json/anything`, () => HttpResponse.json({ code: 0, ok: true })));
    expect(await testProvider().raw("/json/anything", { foo: "bar" })).toMatchObject({ ok: true });
  });

  it("allowances.query sends { allowance_number } and parses nested data + wait[]", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(`${BASE}${ENDPOINTS.allowanceQuery}`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json(ALLOWANCE_QUERY_OK);
      }),
    );
    const res = await testProvider().allowances.query("ALW1781650040");
    expect(data).toEqual({ allowance_number: "ALW1781650040" });
    const d = res.data as Record<string, unknown>;
    expect(d.invoice_type).toBe("D0401");
    expect(d.total_amount).toBe(100); // 未稅
    expect(d.detail_vat).toBe(0);
    const item = (d.product_item as Array<Record<string, unknown>>)[0]!;
    expect(item.original_invoice_number).toBe("AA26513024");
    expect(item.tax).toBe(5);
    // pending schedule (e.g. a queued void)
    expect((d.wait as Array<Record<string, unknown>>)[0]?.invoice_type).toBe("D0501");
  });

  it("allowances.list parses pagination + 未稅 rows with original-invoice items", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(`${BASE}${ENDPOINTS.allowanceList}`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json(ALLOWANCE_LIST_OK);
      }),
    );
    const res = await testProvider().allowances.list({ startDate: "2026-06-01", endDate: 20260630 });
    expect(data).toEqual({ date_select: 1, date_start: 20260601, date_end: 20260630, limit: 20, page: 1 });
    expect(res.data_total).toBe(302);
    expect(res.page_total).toBe(16);
    const row = (res.data as Array<Record<string, unknown>>)[0]!;
    expect(row.allowance_number).toBe("AA26507438_001");
    expect(row.invoice_type).toBe("D0401");
    expect(row.total_amount).toBe(819); // 未稅
    const item = (row.product_item as Array<Record<string, unknown>>)[0]!;
    expect(item.original_invoice_number).toBe("AA26507438");
    expect(item.tax).toBe(41);
  });

  it("invoice.file / allowances.file return data.file_url (PDF link)", async () => {
    let invData: Record<string, unknown> | undefined;
    let alwData: Record<string, unknown> | undefined;
    server.use(
      http.post(`${BASE}${ENDPOINTS.invoiceFile}`, async ({ request }) => {
        invData = parseBody(await request.text()).data;
        return HttpResponse.json(FILE_URL_OK);
      }),
      http.post(`${BASE}${ENDPOINTS.allowanceFile}`, async ({ request }) => {
        alwData = parseBody(await request.text()).data;
        return HttpResponse.json(FILE_URL_OK);
      }),
    );
    const inv = await testProvider().invoice.file("AA26513024", 1);
    expect(invData).toEqual({ type: "invoice", invoice_number: "AA26513024", download_style: 1 });
    expect((inv.data as { file_url: string }).file_url).toContain("https://");

    const alw = await testProvider().allowances.file("ALW1", 3);
    expect(alwData).toEqual({ allowance_number: "ALW1", download_style: 3 });
    expect((alw.data as { file_url: string }).file_url).toContain("https://");
  });

  it("lottery.status sends { Year, Period } and parses the winning-invoice rows", async () => {
    let data: Record<string, unknown> | undefined;
    server.use(
      http.post(`${BASE}${ENDPOINTS.lotteryStatus}`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json(LOTTERY_STATUS_OK);
      }),
    );
    const res = await testProvider().lottery.status(2022, 3);
    expect(data).toEqual({ Year: 2022, Period: 3 });
    const rows = res.data as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ invoice_number: "DF73530001", invoice_date: "20220819", type: "22" });
  });

  it("lottery.type sends an EMPTY data string (not '{}') and returns the prize types", async () => {
    let dataStr: string | undefined;
    let sign: string | null = null;
    let time: string | null = null;
    server.use(
      http.post(`${BASE}${ENDPOINTS.lotteryType}`, async ({ request }) => {
        const body = parseBody(await request.text());
        dataStr = body.dataStr;
        sign = body.sign;
        time = body.time;
        return HttpResponse.json(LOTTERY_TYPE_OK);
      }),
    );
    const res = await testProvider().lottery.type();
    // data must be empty, and the signature must be md5("" + time + appKey)
    expect(dataStr).toBe("");
    expect(sign).toBe(createHash("md5").update("" + time + APP_KEY).digest("hex"));
    const rows = res.data as Array<Record<string, unknown>>;
    expect(rows[0]).toEqual({ type: 11, name: "特別獎(1,000萬)" });
  });

  it("track.all returns the nested 3-layer tree (financial → amego → list leaf)", async () => {
    let data: unknown;
    server.use(
      http.post(`${BASE}${ENDPOINTS.trackAll}`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json(TRACK_ALL_OK);
      }),
    );
    const res = await testProvider().track.all({ year: 2026, period: 2 });
    expect(data).toEqual({ Year: 2026, Period: 2 });
    const l1 = (res.data as Array<Record<string, unknown>>)[0]!;
    expect(l1.layer).toBe(TRACK_LAYER.MOF);
    const l2 = (l1.data as Array<Record<string, unknown>>)[0]!;
    const leaf = (l2.data as Array<Record<string, unknown>>)[0]!;
    expect(leaf.layer).toBe(TRACK_LAYER.LIST);
    expect(leaf.category).toBe(TRACK_CATEGORY.AUTO);
    expect(leaf.source).toBe(TRACK_SOURCE.MANUAL);
    expect(leaf.TrackApiCode).toBe("FSM");
  });

  it("track.get allocates a booklet and returns the { code, start, end } range", async () => {
    let data: unknown;
    server.use(
      http.post(`${BASE}${ENDPOINTS.trackGet}`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json(TRACK_GET_OK);
      }),
    );
    const res = await testProvider().track.get({ year: 2026, period: 2, book: 1 });
    expect(data).toEqual({ Year: 2026, Period: 2, Book: 1 });
    // response data is an OBJECT (not an array)
    const d = res.data as Record<string, unknown>;
    expect(d.code).toBe("EE");
    expect(d.start).toBe("00006850");
    expect(d.end).toBe("00006899");
  });

  it("track.status omits Period/TrackApiCode when not given", async () => {
    let data: unknown;
    server.use(
      http.post(`${BASE}${ENDPOINTS.trackStatus}`, async ({ request }) => {
        data = parseBody(await request.text()).data;
        return HttpResponse.json(TRACK_STATUS_OK);
      }),
    );
    const res = await testProvider().track.status({ year: 2026 });
    expect(data).toEqual({ Year: 2026 });
    // response: data[] with status codes (1 使用 / 3 過期 …)
    const rows = res.data as Array<Record<string, unknown>>;
    expect(rows[0]?.code).toBe("EE");
    expect(rows[0]?.used_booklet).toBe(137);
    expect(rows.map((r) => r.status)).toContain(TRACK_STATUS.EXPIRED);
  });
});

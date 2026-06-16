import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AmegoProvider } from "../provider.js";
import { ENDPOINTS } from "../endpoints.js";
import { BASE, parseBody, server, testProvider } from "./server.js";

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
    name: "invoice.print (PascalCase)",
    path: ENDPOINTS.invoicePrint,
    invoke: (p) => p.invoice.print("AA1", 7),
    expectData: { InvoiceNumber: "AA1", PrinterType: 7, PrinterLang: 3 },
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
    name: "invoice.issueCustom (PascalCase InvoiceNumber)",
    path: ENDPOINTS.issueCustom,
    invoke: (p) => p.invoice.issueCustom("AA1", { OrderId: "o1" }),
    expectData: { OrderId: "o1", InvoiceNumber: "AA1" },
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
    name: "allowances.print (PascalCase)",
    path: ENDPOINTS.allowancePrint,
    invoke: (p) => p.allowances.print("ALW1", 7),
    expectData: { AllowanceNumber: "ALW1", PrinterType: 7, PrinterLang: 3 },
  },
  {
    name: "lottery.status (Year/Period)",
    path: ENDPOINTS.lotteryStatus,
    invoke: (p) => p.lottery.status(2026, 2),
    expectData: { Year: 2026, Period: 2 },
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
    name: "lottery.type (no data)",
    path: ENDPOINTS.lotteryType,
    invoke: (p) => p.lottery.type(),
    expectData: {},
  },
  {
    name: "time",
    path: ENDPOINTS.time,
    invoke: (p) => p.time(),
    expectData: {},
  },
  {
    name: "track.all (pass-through)",
    path: ENDPOINTS.trackAll,
    invoke: (p) => p.track.all({ level: 1 }),
    expectData: { level: 1 },
  },
  {
    name: "track.get (pass-through)",
    path: ENDPOINTS.trackGet,
    invoke: (p) => p.track.get({ count: 50 }),
    expectData: { count: 50 },
  },
  {
    name: "track.status (pass-through)",
    path: ENDPOINTS.trackStatus,
    invoke: (p) => p.track.status({ year: 2026 }),
    expectData: { year: 2026 },
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

  it("raw() can call any endpoint directly", async () => {
    server.use(http.post(`${BASE}/json/anything`, () => HttpResponse.json({ code: 0, ok: true })));
    expect(await testProvider().raw("/json/anything", { foo: "bar" })).toMatchObject({ ok: true });
  });
});

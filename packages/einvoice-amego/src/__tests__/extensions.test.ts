import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AmegoProvider } from "../provider.js";
import { ENDPOINTS } from "../endpoints.js";
import { BASE, parseBody, server, testProvider } from "./server.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * Every Amego-specific endpoint, each exercised individually so the full API
 * surface is covered. For each we assert the adapter hits the right path with a
 * correctly signed body.
 */
const CASES: Array<{
  name: string;
  path: string;
  invoke: (p: AmegoProvider) => Promise<unknown>;
  expectData?: Record<string, unknown>;
}> = [
  { name: "invoice.query", path: ENDPOINTS.invoiceQuery, invoke: (p) => p.invoice.query({ invoiceNumber: "AA1" }), expectData: { InvoiceNumber: "AA1" } },
  { name: "invoice.list", path: ENDPOINTS.invoiceList, invoke: (p) => p.invoice.list({ startTime: 1 }) },
  { name: "invoice.print", path: ENDPOINTS.invoicePrint, invoke: (p) => p.invoice.print({ invoiceNumber: "AA1" }), expectData: { InvoiceNumber: "AA1" } },
  { name: "invoice.file", path: ENDPOINTS.invoiceFile, invoke: (p) => p.invoice.file({ invoiceNumber: "AA1" }) },
  { name: "invoice.status", path: ENDPOINTS.invoiceStatus, invoke: (p) => p.invoice.status({ invoiceNumber: "AA1" }) },
  { name: "invoice.issueCustom", path: ENDPOINTS.issueCustom, invoke: (p) => p.invoice.issueCustom({ OrderId: "x" }) },
  { name: "allowances.query", path: ENDPOINTS.allowanceQuery, invoke: (p) => p.allowances.query({ AllowanceNumber: "AL1" }) },
  { name: "allowances.list", path: ENDPOINTS.allowanceList, invoke: (p) => p.allowances.list({ startTime: 1 }) },
  { name: "allowances.print", path: ENDPOINTS.allowancePrint, invoke: (p) => p.allowances.print({ AllowanceNumber: "AL1" }) },
  { name: "allowances.file", path: ENDPOINTS.allowanceFile, invoke: (p) => p.allowances.file({ AllowanceNumber: "AL1" }) },
  { name: "allowances.status", path: ENDPOINTS.allowanceStatus, invoke: (p) => p.allowances.status({ AllowanceNumber: "AL1" }) },
  { name: "lottery.status", path: ENDPOINTS.lotteryStatus, invoke: (p) => p.lottery.status({ period: "11506" }) },
  { name: "lottery.type", path: ENDPOINTS.lotteryType, invoke: (p) => p.lottery.type() },
  { name: "track.all", path: ENDPOINTS.trackAll, invoke: (p) => p.track.all() },
  { name: "track.get", path: ENDPOINTS.trackGet, invoke: (p) => p.track.get({ count: 50 }) },
  { name: "track.status", path: ENDPOINTS.trackStatus, invoke: (p) => p.track.status() },
  { name: "banQuery", path: ENDPOINTS.banQuery, invoke: (p) => p.banQuery("28080623"), expectData: { ban: "28080623" } },
  { name: "barcodeQuery", path: ENDPOINTS.barcode, invoke: (p) => p.barcodeQuery("/ABC1234"), expectData: { barcode: "/ABC1234" } },
  { name: "time", path: ENDPOINTS.time, invoke: (p) => p.time() },
];

describe("Amego-specific endpoints (full surface)", () => {
  for (const c of CASES) {
    it(`${c.name} → POST ${c.path}`, async () => {
      let data: Record<string, unknown> | undefined;
      let hit = false;
      server.use(
        http.post(`${BASE}${c.path}`, async ({ request }) => {
          hit = true;
          data = parseBody(await request.text()).data;
          return HttpResponse.json({ code: 0, msg: "" });
        }),
      );
      await c.invoke(testProvider());
      expect(hit).toBe(true);
      if (c.expectData) expect(data).toMatchObject(c.expectData);
    });
  }

  it("raw() can call any endpoint directly", async () => {
    server.use(
      http.post(`${BASE}/json/anything`, () => HttpResponse.json({ code: 0, ok: true })),
    );
    const res = await testProvider().raw("/json/anything", { foo: "bar" });
    expect(res).toMatchObject({ code: 0, ok: true });
  });
});

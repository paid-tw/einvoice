import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAmegoProvider } from "../provider.js";
import { clearTimeSyncCache } from "../client.js";
import { BASE, parseBody, server } from "./server.js";
import { ISSUE_OK, TIME_OK } from "./fixtures.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => clearTimeSyncCache());

const cfg = { sellerTaxId: "12345678", appKey: "k", baseUrl: BASE };

describe("retry (network only, opt-in)", () => {
  it("retries transient network failures then succeeds", async () => {
    let attempts = 0;
    server.use(
      http.post(`${BASE}/json/f0401`, () => {
        attempts++;
        if (attempts < 3) return HttpResponse.error();
        return HttpResponse.json(ISSUE_OK);
      }),
    );
    const provider = createAmegoProvider({
      ...cfg,
      retry: { maxRetries: 3, baseDelayMs: 1 },
    });
    const res = await provider.issue({
      orderId: "o1",
      buyer: {},
      items: [{ description: "x", quantity: 1, unitPrice: 105, amount: 105 }],
      amount: { salesAmount: 105, taxAmount: 0, totalAmount: 105 },
      taxType: "TAXABLE",
      priceMode: "TAX_INCLUSIVE",
    });
    expect(res.invoiceNumber).toBe("AA26513024");
    expect(attempts).toBe(3);
  });

  it("does NOT retry business errors (code !== 0)", async () => {
    let attempts = 0;
    server.use(
      http.post(`${BASE}/json/f0501`, () => {
        attempts++;
        return HttpResponse.json({ code: 3050141, msg: "已存在折讓單" });
      }),
    );
    const provider = createAmegoProvider({ ...cfg, retry: { maxRetries: 3, baseDelayMs: 1 } });
    await provider.void({ invoiceNumber: "AA1", reason: "x" }).catch(() => {});
    expect(attempts).toBe(1);
  });
});

describe("time sync (opt-in)", () => {
  it("applies the server clock offset to the signed timestamp", async () => {
    let sentTime: string | undefined;
    server.use(
      http.post(`${BASE}/json/time`, () => HttpResponse.json(TIME_OK)),
      http.post(`${BASE}/json/f0501`, async ({ request }) => {
        sentTime = parseBody(await request.text()).time ?? undefined;
        return HttpResponse.json({ code: 0 });
      }),
    );
    const provider = createAmegoProvider({ ...cfg, syncTime: true });
    await provider.void({ invoiceNumber: "AA1", reason: "x" });
    // Server time fixture is fixed; the request should use it (offset applied).
    expect(sentTime).toBe(String(TIME_OK.timestamp));
  });
});

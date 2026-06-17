import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ezpayRequest } from "../client.js";
import { EZPAY_ENDPOINTS } from "../index.js";
import { BASE, IV, KEY, MERCHANT, server } from "./server.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const config = { merchantId: MERCHANT, hashKey: KEY, hashIV: IV, baseUrl: BASE };
const url = `${BASE}${EZPAY_ENDPOINTS.issue.path}`;
const post = () => ezpayRequest(config, EZPAY_ENDPOINTS.issue.path, { RespondType: "JSON" });

describe("ezpayRequest transport errors", () => {
  it("wraps a non-JSON response as a PROVIDER error", async () => {
    server.use(
      http.post(url, () => new HttpResponse("<html>500</html>", { status: 500 })),
    );
    const err = await post().catch((e) => e);
    expect(err.code).toBe("PROVIDER");
    expect(err.rawCode).toBe("500");
    expect(err.message).toContain("non-JSON");
  });

  it("wraps a network failure as a NETWORK error", async () => {
    server.use(http.post(url, () => HttpResponse.error()));
    const err = await post().catch((e) => e);
    expect(err.code).toBe("NETWORK");
    expect(err.provider).toBe("ezpay");
  });

  it("accepts an already-parsed Result object (non-string)", async () => {
    server.use(
      http.post(url, () =>
        HttpResponse.json({ Status: "SUCCESS", Message: "ok", Result: { InvoiceNumber: "BB1" } }),
      ),
    );
    const res = await post();
    expect(res.result.InvoiceNumber).toBe("BB1");
  });
});

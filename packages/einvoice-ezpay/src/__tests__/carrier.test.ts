import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EZPAY_ENDPOINTS } from "../index.js";
import { BASE, ezCarrierSuccess, ezError, parsePostData, server, testProvider } from "./server.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const url = (p: { path: string }) => `${BASE}${p.path}`;

describe("validateMobileBarcode (checkBarCode)", () => {
  it("sends CellphoneBarcode + CheckValue and returns true when IsExist=Y", async () => {
    let captured: ReturnType<typeof parsePostData> | undefined;
    let hadCheckValue = false;
    server.use(
      http.post(url(EZPAY_ENDPOINTS.checkBarcode), async ({ request }) => {
        const text = await request.text();
        captured = parsePostData(text);
        hadCheckValue = new URLSearchParams(text).has("CheckValue");
        return HttpResponse.json(ezCarrierSuccess({ CellphoneBarcode: "/ABC1234", IsExist: "Y" }));
      }),
    );
    const exists = await testProvider().validateMobileBarcode("/ABC1234");
    expect(exists).toBe(true);
    expect(captured?.params.CellphoneBarcode).toBe("/ABC1234");
    expect(hadCheckValue).toBe(true);
  });

  it("returns false when IsExist=N", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.checkBarcode), () =>
        HttpResponse.json(ezCarrierSuccess({ CellphoneBarcode: "/ZZZ9999", IsExist: "N" })),
      ),
    );
    expect(await testProvider().validateMobileBarcode("/ZZZ9999")).toBe(false);
  });

  it("rejects a malformed barcode locally before any request", async () => {
    await expect(testProvider().validateMobileBarcode("BAD")).rejects.toMatchObject({
      code: "VALIDATION",
      provider: "ezpay",
    });
  });
});

describe("validateLoveCode (checkLoveCode)", () => {
  it("returns true when IsExist=Y, tolerating the 'Lovecode' response key casing", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.checkLoveCode), () =>
        // live API echoes the key as `Lovecode` (lowercase c), not `LoveCode`.
        HttpResponse.json(ezCarrierSuccess({ Lovecode: "8585", IsExist: "Y" })),
      ),
    );
    expect(await testProvider().validateLoveCode("8585")).toBe(true);
  });

  it("returns false when IsExist=N", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.checkLoveCode), () =>
        HttpResponse.json(ezCarrierSuccess({ Lovecode: "999", IsExist: "N" })),
      ),
    );
    expect(await testProvider().validateLoveCode("999")).toBe(false);
  });

  it("rejects a non 3–7 digit love code locally", async () => {
    await expect(testProvider().validateLoveCode("12")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(testProvider().validateLoveCode("abc")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("maps an API error (API10002 查詢失敗) to NOT_FOUND", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.checkLoveCode), () =>
        HttpResponse.json(ezError("API10002", "查詢失敗")),
      ),
    );
    const err = await testProvider().validateLoveCode("8585").catch((e) => e);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.rawCode).toBe("API10002");
  });

  it("wraps a network failure as a NETWORK error", async () => {
    server.use(http.post(url(EZPAY_ENDPOINTS.checkLoveCode), () => HttpResponse.error()));
    const err = await testProvider().validateLoveCode("8585").catch((e) => e);
    expect(err.code).toBe("NETWORK");
    expect(err.provider).toBe("ezpay");
  });

  it("wraps a non-JSON response as a PROVIDER error", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.checkLoveCode), () => new HttpResponse("<html/>", { status: 502 })),
    );
    const err = await testProvider().validateLoveCode("8585").catch((e) => e);
    expect(err.code).toBe("PROVIDER");
    expect(err.rawCode).toBe("502");
  });
});

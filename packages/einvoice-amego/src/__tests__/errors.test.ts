import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { InvoiceError, isInvoiceError } from "@paid-tw/einvoice";
import { mapAmegoErrorCode } from "../client.js";
import { BASE, server, testProvider } from "./server.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("mapAmegoErrorCode (from info_detail?mid=71)", () => {
  it.each([
    [16, "AUTH"], // 簽名驗證錯誤
    [15, "AUTH"], // Time 錯誤
    [12, "AUTH"], // 統編錯誤
    [20, "VALIDATION"], // data 非 JSON
    [23, "VALIDATION"], // data 應為陣列字串 (ban_query)
    [31, "VALIDATION"], // type 查詢類型不存在 (invoice_query)
    [33, "VALIDATION"], // allowance_number 不可為空
    [3050112, "VALIDATION"], // f0501 data 應為陣列字串
    [9000111, "VALIDATION"], // 手機條碼不可為空
    [3040174, "VALIDATION"], // SalesAmount 計算錯誤
    [3040123, "VALIDATION"], // BuyerName 不可為空
    [3040111, "NUMBER_EXHAUSTED"], // 字軌不足
    [3040171, "CONFLICT"], // OrderId 重複
    [3050122, "CONFLICT"], // 發票已作廢
    [3050141, "CONFLICT"], // 已存在折讓單
    [71, "NOT_FOUND"], // 查無資料
    [3050125, "NOT_FOUND"], // 發票不存在
    [999999, "PROVIDER"], // unknown
  ])("maps %i → %s", (code, expected) => {
    expect(mapAmegoErrorCode(code)).toBe(expected);
  });
});

describe("error propagation", () => {
  it("throws an InvoiceError carrying the raw Amego code and message", async () => {
    server.use(
      http.post(`${BASE}/json/f0501`, () =>
        HttpResponse.json({ code: 3050122, msg: "發票已作廢" }),
      ),
    );
    const err = await testProvider()
      .void({ invoiceNumber: "AA1", reason: "x" })
      .catch((e) => e);
    expect(isInvoiceError(err)).toBe(true);
    expect(err).toBeInstanceOf(InvoiceError);
    expect(err.code).toBe("CONFLICT");
    expect(err.rawCode).toBe("3050122");
    expect(err.rawMessage).toBe("發票已作廢");
    expect(err.provider).toBe("amego");
  });

  it("maps transport failures to NETWORK", async () => {
    server.use(http.post(`${BASE}/json/f0501`, () => HttpResponse.error()));
    const err = await testProvider()
      .void({ invoiceNumber: "AA1", reason: "x" })
      .catch((e) => e);
    expect(err.code).toBe("NETWORK");
  });
});

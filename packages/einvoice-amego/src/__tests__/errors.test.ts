import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { InvoiceError, isInvoiceError } from "@paid-tw/einvoice";
import { mapAmegoErrorCode } from "../client.js";
import { BASE, server, testProvider } from "./server.js";
import { ERR_CUSTOM_INVOICEDATE } from "./fixtures.js";

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
    [3050111, "VALIDATION"], // f0501 CancelInvoiceNumber 錯誤
    [3050124, "VALIDATION"], // 發票類型錯誤
    [3050122, "CONFLICT"], // 發票已作廢
    [3050126, "CONFLICT"], // 已超過修改期限
    [3050131, "CONFLICT"], // 等待 開立/作廢/註銷
    [3050141, "CONFLICT"], // 已存在折讓單
    [3040121, "VALIDATION"], // BuyerIdentifier 字數錯誤
    [3040122, "VALIDATION"], // BuyerIdentifier 格式錯誤
    [3040132, "VALIDATION"], // 載具號碼不存在
    [3040137, "VALIDATION"], // NPOBAN 不存在
    [3040162, "VALIDATION"], // DetailVat 0 無統編
    [3040179, "VALIDATION"], // 零稅率缺通關註記
    [99, "VALIDATION"], // f0401_custom per-record field error
    [9000112, "VALIDATION"], // 手機條碼格式錯誤
    [9000113, "NOT_FOUND"], // 手機條碼不存在
    [4050112, "VALIDATION"], // g0501 data 應為陣列
    [4050134, "NOT_FOUND"], // 折讓單不存在
    ["4050134", "NOT_FOUND"], // string code (g0501 returns strings) — coerced
    ["4050112", "VALIDATION"], // string code
    ["4040112", "VALIDATION"], // g0401 data 應為陣列 (string code)
    ["4040121", "VALIDATION"], // AllowanceNumber 錯誤
    ["4040139", "VALIDATION"], // Tax 必須為整數
    [4040152, "CONFLICT"], // 原發票開立中
    [4040156, "NOT_FOUND"], // 原發票不存在
    [4040161, "CONFLICT"], // 已存在折讓開立
    [4040171, "VALIDATION"], // 折讓金額大於原發票
    [32, "VALIDATION"], // invoice_print order_id 不可為空
    [34, "VALIDATION"], // type 查詢類型錯誤
    [35, "VALIDATION"], // printer_type 錯誤
    [36, "VALIDATION"], // 不支援單印明細
    [71, "NOT_FOUND"], // 查無資料
    [3050125, "NOT_FOUND"], // 發票不存在
    [999999, "PROVIDER"], // unknown
  ])("maps %i → %s", (code, expected) => {
    expect(mapAmegoErrorCode(code)).toBe(expected);
  });

  // Audit: the 通用/系統 error codes (10–23).
  it("categorizes the common/system error codes", () => {
    const expected: Record<number, string> = {
      10: "PROVIDER", // 系統停機維護中
      11: "AUTH", // 統編不可為空
      12: "AUTH", // 統編錯誤
      13: "AUTH", // status 未啟用
      14: "AUTH", // IP 錯誤
      15: "AUTH", // Time 錯誤
      16: "AUTH", // 簽名驗證錯誤
      17: "VALIDATION", // 資料不可為空
      18: "PROVIDER", // 無法建立資料庫連線
      19: "AUTH", // 公司停權
      20: "VALIDATION", // data 非 JSON
      21: "PROVIDER", // 人數過多
      22: "AUTH", // 尚未申請 API 串接
      23: "VALIDATION", // data 應為陣列字串
    };
    for (const [code, cat] of Object.entries(expected)) {
      expect(mapAmegoErrorCode(Number(code))).toBe(cat);
    }
  });

  // Audit: every documented g0401 (開立折讓) error code is categorized.
  it("categorizes the full g0401 error-code family", () => {
    const conflict = [4040152, 4040153, 4040154, 4040161, 4040162, 4040163];
    const notFound = [4040156];
    const all = [4040112, ...range(4040121, 4040142), ...range(4040151, 4040156), ...range(4040161, 4040163), 4040171, 4040173];
    for (const c of conflict) expect(mapAmegoErrorCode(c)).toBe("CONFLICT");
    for (const c of notFound) expect(mapAmegoErrorCode(c)).toBe("NOT_FOUND");
    const validation = all.filter((c) => !conflict.includes(c) && !notFound.includes(c));
    for (const c of validation) expect(mapAmegoErrorCode(c)).toBe("VALIDATION");
    // g0401/g0501/f0501 also return these as STRING codes — must coerce.
    expect(mapAmegoErrorCode("4040156")).toBe("NOT_FOUND");
    expect(mapAmegoErrorCode("4040123")).toBe("VALIDATION");
  });

  // Audit: print/file/query operation-state codes (51-56) and system codes.
  it("categorizes the print/file/query state + system codes", () => {
    for (const c of [51, 52, 53, 55, 56]) expect(mapAmegoErrorCode(c)).toBe("CONFLICT");
    for (const c of [10, 18, 21, 72]) expect(mapAmegoErrorCode(c)).toBe("PROVIDER"); // transient/system
    expect(mapAmegoErrorCode(71)).toBe("NOT_FOUND"); // 查無資料
  });

  // Audit: every documented g0501 (作廢折讓) error code is categorized (string codes).
  it("categorizes the full g0501 error-code family", () => {
    const expected: Record<number, string> = {
      4050112: "VALIDATION", // data 應為陣列
      4050121: "VALIDATION", // CancelAllowanceNumber 錯誤
      4050131: "CONFLICT", // 折讓開立中
      4050132: "CONFLICT", // 已存在作廢折讓
      4050133: "VALIDATION", // 折讓類型錯誤
      4050134: "NOT_FOUND", // 折讓單不存在
      4050135: "CONFLICT", // 已超過修改期限
      4050141: "CONFLICT", // 等待排程
    };
    for (const [code, cat] of Object.entries(expected)) {
      expect(mapAmegoErrorCode(Number(code))).toBe(cat);
      expect(mapAmegoErrorCode(code)).toBe(cat); // g0501 returns string codes
    }
  });

  // Audit: f0401_custom surfaces per-record field errors as code 99.
  it("maps the f0401_custom record error (99) to VALIDATION", () => {
    expect(mapAmegoErrorCode(99)).toBe("VALIDATION");
  });

  // Audit: every documented f0401 (開立發票) error code is categorized, never
  // left as a bare PROVIDER fallthrough except the system print-format error.
  it("categorizes the full f0401 error-code family", () => {
    const f0401 = [
      3040111, 3040112, ...range(3040121, 3040163), 3040171,
      ...range(3040172, 3040184), 3040191, 3040192, 3040193,
    ];
    expect(mapAmegoErrorCode(3040111)).toBe("NUMBER_EXHAUSTED");
    expect(mapAmegoErrorCode(3040191)).toBe("NUMBER_EXHAUSTED"); // 無法取得下一張發票
    expect(mapAmegoErrorCode(3040171)).toBe("CONFLICT"); // OrderId 重複
    expect(mapAmegoErrorCode(3040192)).toBe("PROVIDER"); // 列印格式錯誤 (system)
    // every other code is a caller-facing VALIDATION error
    const validation = f0401.filter((c) => ![3040111, 3040191, 3040171, 3040192].includes(c));
    for (const c of validation) expect(mapAmegoErrorCode(c)).toBe("VALIDATION");
  });
});

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

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

  it("propagates a real f0401_custom field error (code 99) as VALIDATION", async () => {
    server.use(http.post(`${BASE}/json/f0401_custom`, () => HttpResponse.json(ERR_CUSTOM_INVOICEDATE)));
    // A locally-valid record so it reaches the server, which then rejects it.
    const err = await testProvider()
      .invoice.issueCustom("AA00000010", {
        OrderId: "o1",
        InvoiceDate: "20260617",
        InvoiceTime: "16:40:42",
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
      })
      .catch((e) => e);
    expect(err.code).toBe("VALIDATION");
    expect(err.rawCode).toBe("99");
  });
});

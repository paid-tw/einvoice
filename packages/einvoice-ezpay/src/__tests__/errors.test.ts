import { describe, expect, it } from "vitest";
import { ezpayErrorReason, mapEzpayError } from "../client.js";

describe("mapEzpayError (ezPay §九 錯誤代碼)", () => {
  it.each([
    ["INV20006", "NOT_FOUND"], // 查無發票資料
    ["IAI10002", "NOT_FOUND"], // 折讓查詢失敗
    ["INV90006", "NUMBER_EXHAUSTED"], // 可開立張數已用罄
    ["NOR10001", "NETWORK"], // 網路連線異常
    ["KEY10014", "NETWORK"], // TimeOut
    ["KEY10002", "AUTH"], // 資料解密錯誤
    ["KEY10006", "AUTH"], // 未申請啟用電子發票
    ["INV90005", "AUTH"], // 未簽合約或已到期
    ["KEY10007", "AUTH"], // 頁面停留超過 30 分鐘
    ["LIB10003", "CONFLICT"], // 自訂編號重覆
    ["LIB10005", "CONFLICT"], // 發票已作廢過
    ["LIB10007", "CONFLICT"], // 無法作廢(已折讓)
    ["LIB10008", "CONFLICT"], // 超過可作廢期限
    ["LIB10009", "CONFLICT"], // 未上傳無法作廢
    ["INV70002", "CONFLICT"], // 上傳失敗之發票不得作廢
    ["INV10020", "PROVIDER"], // 暫停使用
    ["INV10021", "PROVIDER"], // 異常終止
    ["IAI10006", "PROVIDER"], // 折讓異常終止
    ["KEY10004", "VALIDATION"], // 資料不齊全
    ["KEY10015", "VALIDATION"], // 發票金額格式錯誤
    ["INV10003", "VALIDATION"], // 商品資訊格式錯誤
    ["INV10012", "VALIDATION"], // 發票金額、課稅別驗證錯誤
    ["INV10013", "VALIDATION"], // 發票欄位不齊全或格式錯誤
    ["INV70001", "VALIDATION"], // 欄位資料格式錯誤
    ["IAI10001", "VALIDATION"], // 缺少參數
    ["IAI10004", "VALIDATION"], // 參數錯誤
    ["SOMETHING", "PROVIDER"], // unknown
  ])("maps %s → %s", (code, expected) => {
    expect(mapEzpayError(code)).toBe(expected);
  });

  // 手機條碼/愛心碼驗證 API error family (API100xx / CBC100xx).
  it.each([
    ["API10001", "VALIDATION"], // 缺少參數
    ["API10002", "NOT_FOUND"], // 查詢失敗 (查無條碼/愛心碼)
    ["API10004", "VALIDATION"], // 參數錯誤
    ["CBC10001", "VALIDATION"], // 欄位資料空白
    ["CBC10002", "VALIDATION"], // 欄位資料格式錯誤
    ["CBC10003", "PROVIDER"], // 異常終止
    ["CBC10004", "NETWORK"], // 財政部大平台網路連線異常
  ])("maps carrier-validation %s → %s", (code, expected) => {
    expect(mapEzpayError(code)).toBe(expected);
  });

  // Audit: every code in the official §九 table is categorized intentionally.
  it("categorizes the full official error table (39 codes)", () => {
    const expected: Record<string, string> = {
      KEY10002: "AUTH",
      KEY10004: "VALIDATION",
      KEY10006: "AUTH",
      KEY10007: "AUTH",
      KEY10010: "VALIDATION",
      KEY10011: "VALIDATION",
      KEY10012: "VALIDATION",
      KEY10013: "VALIDATION",
      KEY10014: "NETWORK",
      KEY10015: "VALIDATION",
      INV10003: "VALIDATION",
      INV10004: "VALIDATION",
      INV10006: "VALIDATION",
      INV10012: "VALIDATION",
      INV10013: "VALIDATION",
      INV10014: "VALIDATION",
      INV10015: "VALIDATION",
      INV10016: "VALIDATION",
      INV10017: "VALIDATION",
      INV10019: "VALIDATION",
      INV10020: "PROVIDER",
      INV10021: "PROVIDER",
      INV20006: "NOT_FOUND",
      INV70001: "VALIDATION",
      INV70002: "CONFLICT",
      INV90005: "AUTH",
      INV90006: "NUMBER_EXHAUSTED",
      NOR10001: "NETWORK",
      LIB10003: "CONFLICT",
      LIB10005: "CONFLICT",
      LIB10007: "CONFLICT",
      LIB10008: "CONFLICT",
      LIB10009: "CONFLICT",
      IAI10001: "VALIDATION",
      IAI10002: "NOT_FOUND",
      IAI10003: "PROVIDER",
      IAI10004: "VALIDATION",
      IAI10005: "PROVIDER",
      IAI10006: "PROVIDER",
    };
    for (const [code, cat] of Object.entries(expected)) {
      expect(mapEzpayError(code)).toBe(cat);
    }
    expect(Object.keys(expected)).toHaveLength(39);
  });
});

describe("mapEzpayError — LIB10014 (24h re-void rate limit)", () => {
  // Previously swept into the VALIDATION fallthrough. It is a transient
  // frequency limit (verified live on cinv 2026-07) — the request is valid
  // and succeeds after the window, so it must not be classified as a
  // caller-input error.
  it("classifies LIB10014 as PROVIDER (transient), not VALIDATION", () => {
    expect(mapEzpayError("LIB10014")).toBe("PROVIDER");
  });
});

describe("ezpayErrorReason (action-oriented axis)", () => {
  it.each([
    // credential / account setup
    ["KEY10002", "credentials_invalid"], // 解密失敗 (常見:測試憑證打到正式主機)
    ["KEY10006", "not_enrolled"], // 未申請電子發票 API 串接
    ["INV90005", "contract_expired"], // 合約未生效或已到期
    ["KEY10007", "stale_timestamp"], // 時間驗證失敗
    ["INV10020", "account_suspended"], // 暫停使用
    ["INV10021", "account_suspended"], // 異常終止
    // idempotency / state (LIB10003/05/07/14 verified live on cinv 2026-07)
    ["LIB10003", "duplicate_order"], // MerchantOrderNo 重覆 → query-and-adopt
    ["LIB10005", "already_voided"], // 發票已作廢過
    ["LIB10007", "void_blocked_by_allowance"], // 已折讓無法作廢 → fall back to allowance
    ["LIB10008", "past_deadline"], // 超過可作廢期限
    ["LIB10014", "rate_limited"], // 24h 內重複作廢請求
    // carrier / donation registry lookups
    ["API10002", "carrier_not_registered"], // 查無條碼/愛心碼
  ])("maps %s → %s", (code, expected) => {
    expect(ezpayErrorReason(code)).toBe(expected);
  });

  it("returns undefined for plain validation/system codes", () => {
    expect(ezpayErrorReason("KEY10004")).toBeUndefined(); // 資料不齊全
    expect(ezpayErrorReason("INV90006")).toBeUndefined(); // 張數用罄 — code NUMBER_EXHAUSTED covers it
    expect(ezpayErrorReason("NOR10001")).toBeUndefined(); // 網路異常 — code NETWORK covers it
    expect(ezpayErrorReason("SOMETHING")).toBeUndefined();
  });
});

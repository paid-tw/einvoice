import { describe, expect, it } from "vitest";
import { mapEcpayError } from "../client.js";

describe("mapEcpayError (keyword-based, ECPay RtnMsg)", () => {
  it.each([
    [2, "查無發票資料，請重新確認", "NOT_FOUND"],
    [1600003, "無發票號碼資料", "NOT_FOUND"],
    [1100040, "發票字軌已用完", "NUMBER_EXHAUSTED"],
    [0, "發票已作廢過", "CONFLICT"],
    [0, "自訂編號不可重複", "CONFLICT"],
    [0, "特店編號不存在", "AUTH"],
    [0, "資料解密錯誤，請確認金鑰", "AUTH"],
    [5000022, "驗證發票金額發現錯誤，與商品合計金額不符", "VALIDATION"],
    [2020001, "捐贈碼為3~7碼純數字", "VALIDATION"],
    [9999999, "系統異常，請稍後再試", "PROVIDER"],
  ])("maps RtnCode %s (%s) → %s", (code, msg, expected) => {
    expect(mapEcpayError(code, msg)).toBe(expected);
  });

  it("defaults to VALIDATION for an unrecognised business error", () => {
    expect(mapEcpayError(123456, "某個未知的欄位錯誤")).toBe("VALIDATION");
  });
});

import { describe, expect, it } from "vitest";
import { ecpayErrorReason, mapEcpayError, mapEcpayTransportError } from "../client.js";

describe("mapEcpayError (keyword-based, ECPay RtnMsg)", () => {
  it.each([
    [2, "查無發票資料，請重新確認", "NOT_FOUND"],
    [1600003, "無發票號碼資料", "NOT_FOUND"],
    [4000001, "不存在此交易單號", "NOT_FOUND"], // unknown Tsr (edit/trigger/cancel)
    [1100040, "發票字軌已用完", "NUMBER_EXHAUSTED"],
    [0, "發票已作廢過", "CONFLICT"],
    [5070450, "該發票已被折讓過，無法直接作廢發票", "CONFLICT"], // void blocked by an allowance
    [2000063, "該折讓單已作廢過，請確認", "CONFLICT"], // re-void an allowance
    [2000039, "查無折讓單資料，請確認!", "NOT_FOUND"], // unknown allowance
    [5070250, "無法取消已經同意的線上折讓單", "CONFLICT"], // cancel an agreed online allowance
    [0, "自訂編號不可重複", "CONFLICT"],
    // Live-verified 2026-08-01 (stage, MerchantID 2000132) — the exact RtnMsg wording
    // these codes return in the wild. All three are pinned in ECPAY_ERROR_TABLE.
    [5070357, "B2C開立發票 自訂編號重覆，請重新設定", "CONFLICT"], // 重覆 (覆), not 重複
    [5070453, "B2C作廢發票 該發票已被作廢過", "CONFLICT"], // real re-void message
    [
      5070450,
      "B2C作廢發票 該發票已被折讓過，無法直接作廢發票並請確認該發票所開立的折讓單是否全部已作廢",
      "CONFLICT",
    ],
    [0, "特店編號不存在", "AUTH"],
    [0, "資料解密錯誤，請確認金鑰", "AUTH"],
    [5000022, "驗證發票金額發現錯誤，與商品合計金額不符", "VALIDATION"],
    [2020001, "捐贈碼為3~7碼純數字", "VALIDATION"],
    [9999999, "系統異常，請稍後再試", "PROVIDER"],
    [9000001, "呼叫財政部API失敗", "NETWORK"], // 財政部 maintenance — transient
  ])("maps RtnCode %s (%s) → %s", (code, msg, expected) => {
    expect(mapEcpayError(code, msg)).toBe(expected);
  });

  it("defaults to VALIDATION for an unrecognised business error", () => {
    expect(mapEcpayError(123456, "某個未知的欄位錯誤")).toBe("VALIDATION");
  });
});

describe("ecpayErrorReason (action-oriented axis, RtnMsg keywords)", () => {
  it.each([
    ["資料解密錯誤，請確認金鑰", "credentials_invalid"],
    ["簽章驗證失敗", "credentials_invalid"],
    ["特店編號不存在", "not_enrolled"],
    ["平台商編號不存在", "not_enrolled"],
    ["發票已作廢過", "already_voided"],
    ["該發票已被折讓過，無法直接作廢發票", "void_blocked_by_allowance"],
    ["自訂編號不可重複", "duplicate_order"],
    ["系統忙碌中，請稍後再試", "rate_limited"],
  ])("maps %s → %s (keyword fallback)", (msg, expected) => {
    expect(ecpayErrorReason(msg)).toBe(expected);
  });

  // Live-verified RtnCode + RtnMsg pairs (stage, 2026-08-01). The reason must be
  // resolved from the code table even though the raw message defeats keyword matching.
  it.each([
    [5070357, "B2C開立發票 自訂編號重覆，請重新設定", "duplicate_order"],
    [5070453, "B2C作廢發票 該發票已被作廢過", "already_voided"],
    [
      5070450,
      "B2C作廢發票 該發票已被折讓過，無法直接作廢發票並請確認該發票所開立的折讓單是否全部已作廢",
      "void_blocked_by_allowance",
    ],
  ])("maps RtnCode %s → %s", (code, msg, expected) => {
    expect(ecpayErrorReason(msg, code)).toBe(expected);
  });

  // Regression for issue #3 (問題 1): the real void-blocked message contains 作廢
  // ("…折讓單是否全部已作廢"), which must NOT be misread as already_voided even by
  // the keyword fallback alone (no code passed). Misclassifying it drops the 折讓.
  it("prefers void_blocked_by_allowance over already_voided on the real message", () => {
    expect(
      ecpayErrorReason(
        "該發票已被折讓過，無法直接作廢發票並請確認該發票所開立的折讓單是否全部已作廢",
      ),
    ).toBe("void_blocked_by_allowance");
  });

  it("maps 重覆 (覆 variant) to duplicate_order via keyword fallback", () => {
    expect(ecpayErrorReason("自訂編號重覆，請重新設定")).toBe("duplicate_order");
  });

  it("returns undefined for messages with no distinct consumer action", () => {
    expect(ecpayErrorReason("驗證發票金額發現錯誤，與商品合計金額不符")).toBeUndefined();
    expect(ecpayErrorReason("查無發票資料，請重新確認")).toBeUndefined();
    expect(ecpayErrorReason("發票字軌已用完")).toBeUndefined(); // code NUMBER_EXHAUSTED covers it
    expect(ecpayErrorReason("")).toBeUndefined();
    expect(ecpayErrorReason()).toBeUndefined();
  });
});

describe("mapEcpayTransportError (envelope TransCode)", () => {
  // Live-verified 2026-08-15 (stage, MerchantID 2000132) — the messages are the
  // exact TransMsg the gateway returns; classification keys off the code alone.
  it.each([
    [104, "Timestamp is over 10 minutes than it just produced.", "AUTH", "stale_timestamp"],
    [110, "The parameter [Data] decrypt fail.", "AUTH", "credentials_invalid"],
    [115, "B2C/B2B功能尚未開通，請聯繫所屬業務", "AUTH", "not_enrolled"],
  ])("maps TransCode %s (%s) → %s / %s", (code, _msg, expectedCode, expectedReason) => {
    expect(mapEcpayTransportError(code)).toEqual({ code: expectedCode, reason: expectedReason });
  });

  it("defaults to PROVIDER with no reason for unlisted TransCodes", () => {
    expect(mapEcpayTransportError(111)).toEqual({ code: "PROVIDER" }); // Data cannot be empty
    expect(mapEcpayTransportError(999)).toEqual({ code: "PROVIDER" });
  });
});

import { describe, expect, it } from "vitest";
import { mapEzpayError } from "../client.js";

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
});

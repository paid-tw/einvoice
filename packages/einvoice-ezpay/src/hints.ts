import { isInvoiceError } from "@paid-tw/einvoice";

/**
 * 商家可行動的錯誤提示（zh-TW）——與 `@paid-tw/einvoice-amego` 的
 * `amegoErrorHint` 同一套慣例。
 *
 * ezPay 的帳號／串接層錯誤（金鑰不符、尚未申請串接、合約到期、可開立張數
 * 用罄…）從 `InvoiceError` 的 `rawCode` + 原始訊息看不出「接下來該做什麼」，
 * 而這些恰好都需要商家自己到 ezPay 後台處理。此表把這些碼翻成可直接顯示
 * 給商家的行動指引；查表不中回傳 `undefined`，呼叫端退回顯示
 * `error.message`（ezPay 原文）。
 *
 * 來源：ezPay 電子發票技術串接手冊 §九 錯誤代碼；`KEY10002`／`KEY10006`
 * 的行為已對 cinv 測試環境實測驗證（2026-07）。注意 ezPay 的測試（cinv）
 * 與正式（inv）是**不同主機、不同商店註冊**——「查無商店／未申請」類錯誤
 * 也可能是把測試憑證打到正式主機（或相反）。
 */
const HINTS: Record<string, string> = {
  // 金鑰 / 串接設定
  KEY10002:
    "HashKey 或 HashIV 錯誤（解密失敗），請重新核對 ezPay 後台的串接金鑰。若使用測試商店憑證，請確認連線的是測試環境（cinv）而非正式環境。",
  KEY10006: "此商店尚未申請電子發票 API 串接，請至 ezPay 後台申請並啟用。",
  INV90005: "電子發票合約未生效或已到期，請聯繫 ezPay 確認合約狀態。",
  KEY10007: "請求時間驗證失敗（頁面或時間戳逾時），請稍後再試。",

  // 帳號狀態
  INV10020: "此商店的電子發票功能已暫停使用，請聯繫 ezPay 客服。",
  INV10021: "此商店的電子發票功能已異常終止，請聯繫 ezPay 客服。",

  // 可開立張數（ezPay 以張數計，非字軌配號）
  INV90006: "本期可開立發票張數已用罄，請至 ezPay 後台加購張數後即可繼續開立。",

  // 暫時性（ezPay 端 / 財政部大平台），稍後重試即可
  NOR10001: "ezPay 系統網路異常，請稍後再試。",
  KEY10014: "ezPay 系統連線逾時，請稍後再試。",
  CBC10003: "財政部平台異常，載具／愛心碼驗證暫時無法使用，請稍後再試。",
  CBC10004: "財政部平台連線異常，請稍後再試。",

  // 操作頻率限制
  LIB10014: "同一張發票 24 小時內請勿重複發送作廢請求，請稍後再試。",
};

/**
 * 依 ezPay 原始錯誤碼取得商家行動指引。
 *
 * 接受原始碼（`rawCode`，如 `"KEY10002"`）或直接丟入 `InvoiceError`
 * （以 `isInvoiceError` 判別並確認 `provider === "ezpay"`）。
 * 非商家可行動的錯誤回傳 `undefined`。
 *
 * ```ts
 * try {
 *   await invoices.issue(input);
 * } catch (e) {
 *   const hint = ezpayErrorHint(e);
 *   showError(hint ?? (isInvoiceError(e) ? e.message : "開立失敗"));
 * }
 * ```
 */
export function ezpayErrorHint(rawCode: string): string | undefined;
export function ezpayErrorHint(error: unknown): string | undefined;
export function ezpayErrorHint(input: unknown): string | undefined {
  if (typeof input === "string") {
    return HINTS[input];
  }
  if (isInvoiceError(input) && input.provider === "ezpay" && input.rawCode !== undefined) {
    return HINTS[input.rawCode];
  }
  return undefined;
}

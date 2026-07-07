import { isInvoiceError } from "@paid-tw/einvoice";

/**
 * 商家可行動的錯誤提示（zh-TW）。
 *
 * Amego 的帳號／串接層錯誤（IP 限制、尚未申請 API 串接、字軌用罄…）從
 * `InvoiceError` 的 `rawCode` + 原始 `message`（例如「IP 錯誤」）看不出
 * 「接下來該做什麼」——而這幾種恰好都需要商家自己到光貿後台操作，接入方
 * 無法以程式解決。此表把這些碼翻成可以直接顯示給商家的行動指引。
 *
 * 刻意只涵蓋「人需要介入」的碼：呼叫端程式錯誤（如參數格式）與一般業務
 * 錯誤（發票不存在、金額超過…）不在此列——那些應該由接入方依自己的
 * 業務語境處理。查表不中時回傳 `undefined`，呼叫端可退回顯示
 * `error.message`（光貿原文）。
 *
 * 來源：光貿官方錯誤表（invoice.amego.tw/info_detail?mid=71）；
 * 14「IP 錯誤」的行為已對真實商家帳號實測驗證（2026-07）。
 */
const HINTS: Record<string, string> = {
  // 通用錯誤 — 帳號 / 串接設定
  "12": "統一編號與此光貿帳號不符，請確認填寫的是該帳號註冊的統編。",
  "13": "光貿帳號尚未啟用，請聯繫光貿客服確認帳號狀態。",
  "14": "來源 IP 遭光貿拒絕：後台「API 介接」設有 IP 限制。若請求來自雲端服務（IP 不固定），請至光貿後台移除 IP 限制。",
  "16": "App Key 驗證失敗，請確認 App Key 是否貼錯，或已在光貿後台重新產生。",
  "19": "光貿帳號已停權，請聯繫光貿客服。",
  "22": "此光貿帳號尚未申請 API 串接，請至光貿後台「系統設定 → API 介接」申請並啟用。",

  // 通用錯誤 — 暫時性（光貿端），稍後重試即可
  "10": "光貿系統維護中，請稍後再試。",
  "15": "請求時間驗證失敗（時鐘偏差），請稍後再試；若持續發生，可啟用 syncTime 設定。",
  "18": "光貿系統忙碌（資料庫連線失敗），請稍後再試。",
  "21": "光貿系統使用人數過多，請稍後再試。",

  // 字軌用罄 — 需商家補號
  "3040111": "發票字軌已用罄，無可用號碼。請至光貿後台補充本期字軌後，系統即可繼續開立。",
  "3040191": "取號失敗（字軌配號異常），請至光貿後台確認本期字軌狀態。",
};

/**
 * 依 Amego 原始錯誤碼取得商家行動指引。
 *
 * 接受原始碼（`rawCode`，數字或字串皆可）或直接丟入 `InvoiceError`
 * （會先以 `isInvoiceError` 判別並確認 `provider === "amego"`）。
 * 非商家可行動的錯誤回傳 `undefined`。
 *
 * ```ts
 * try {
 *   await provider.issue(input);
 * } catch (e) {
 *   const hint = amegoErrorHint(e);
 *   showError(hint ?? (isInvoiceError(e) ? e.message : "開立失敗"));
 * }
 * ```
 */
export function amegoErrorHint(rawCode: string | number): string | undefined;
export function amegoErrorHint(error: unknown): string | undefined;
export function amegoErrorHint(input: unknown): string | undefined {
  if (typeof input === "string" || typeof input === "number") {
    return HINTS[String(input)];
  }
  if (isInvoiceError(input) && input.provider === "amego" && input.rawCode !== undefined) {
    return HINTS[input.rawCode];
  }
  return undefined;
}

# @paid-tw/einvoice-ecpay

[![npm version](https://img.shields.io/npm/v/@paid-tw/einvoice-ecpay.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ecpay)
[![npm downloads](https://img.shields.io/npm/dm/@paid-tw/einvoice-ecpay.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ecpay)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice-ecpay.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/npm/l/@paid-tw/einvoice-ecpay.svg)](https://github.com/paid-tw/einvoice/blob/main/LICENSE)

[English](./README.en.md) ｜ **繁體中文**

[`@paid-tw/einvoice`](https://www.npmjs.com/package/@paid-tw/einvoice) 的
[ECPay 綠界](https://www.ecpay.com.tw/) 轉接器，基於 ECPay **B2C 電子發票 2.0**
API（AES JSON API，而非舊版的 CheckMacValue API）實作了 `InvoiceProvider` 介面。

```bash
pnpm add @paid-tw/einvoice @paid-tw/einvoice-ecpay
```

```ts
import { createEcpayProvider } from "@paid-tw/einvoice-ecpay";

const invoices = createEcpayProvider({
  merchantId: process.env.ECPAY_MERCHANT_ID!,
  hashKey: process.env.ECPAY_HASH_KEY!, // 16 chars
  hashIV: process.env.ECPAY_HASH_IV!, // 16 chars
  mode: "TEST", // stage host; "PRODUCTION" → live host
});

await invoices.issue({ /* IssueInvoiceInput */ });
```

### 不需帳號即可試用

ECPay 提供共用的 **sandbox** 憑證。直接使用匯出的 `ECPAY_SANDBOX`
即可對測試特店開立發票：

```ts
import { createEcpayProvider, ECPAY_SANDBOX } from "@paid-tw/einvoice-ecpay";

const invoices = createEcpayProvider({ ...ECPAY_SANDBOX, mode: "TEST" }); // 特店 2000132 — never use in production
```

## 運作方式（已於測試環境實機驗證）

| 項目 | 說明 |
| --- | --- |
| 認證 | `Data` 欄位 = `JSON → PHP urlencode → AES-128-CBC (PKCS7) → Base64`（解碼時反向操作）。PHP url(en/de)code 語意：空白為 `+`，而非 `%20`。 |
| 封包 | `{ MerchantID, RqHeader: { Timestamp }, Data }`；回應外層為 `{ TransCode, TransMsg, Data }`。`TransCode === 1` 代表傳輸成功。 |
| 結果 | 解密 `Data` → `{ RtnCode, RtnMsg, … }`。`RtnCode === 1` 代表成功；否則為錯誤（這些代碼分布的範圍並不一致，因此對應關係改以 `RtnMsg` 為依據）。 |
| 商品明細 | 為 `{ ItemSeq, ItemName, ItemCount, ItemWord, ItemPrice, ItemTaxType, ItemAmount }` 的 JSON **陣列** — 並非以管線符號串接，也沒有 `CheckMacValue`。 |
| 載具 | `CarrierType`：空=紙本 / `1`=綠界 / `2`=自然人憑證 / `3`=手機條碼。含載具或捐贈的發票不得列印。 |

## 延遲開立（延遲 / 預約 / 觸發開立）

```ts
// TRIGGER (待觸發, default): issues only when you trigger it.
const { relateNumber } = await invoices.issuePending({ /* IssueInvoiceInput */ });
const res = await invoices.triggerIssue({ relateNumber });
// res.issued: true (DelayDay=0 → 4000004, res.invoiceNumber set) |
//             false (DelayDay>0 → 4000003, auto-issues later — query by relateNumber after)

// SCHEDULE (預約): auto-issues after N days (1–15), no trigger needed.
await invoices.issuePending({ /* … */ }, { mode: "SCHEDULE", delayDay: 3 });

// Edit a still-pending delayed invoice (keyed by its Tsr = orderId).
await invoices.editDelayIssue({ /* updated IssueInvoiceInput */ });

// Cancel a still-pending delayed invoice (before it issues/triggers).
await invoices.cancelDelayIssue(relateNumber);
```

## 載具驗證（手機條碼 / 愛心碼）

```ts
await invoices.validateMobileBarcode("/ABC1234"); // → boolean (CheckBarcode)
await invoices.validateLoveCode("168001"); // → boolean (CheckLoveCode)
await invoices.lookupLoveCodeOrganName("168001"); // → "財團法人…" | undefined (the charity name)
```

宣告為 `CARRIER_VALIDATION` 能力。

### 統一編號驗證

```ts
await invoices.lookupCompanyName("97025978"); // → "綠界科技股份有限公司" | undefined
await invoices.validateBan("97025978"); // → boolean
```

⚠️ 沒有公開資料的統編（政府/醫療/福委會 等）會回傳
`undefined`/`false` — 這 **並不** 代表它無效，因此請繼續開立。
只有當檢查碼或格式錯誤時才會拋出 `VALIDATION`（這種情況才應停止）。

## 設定

| 選項 | 必填 | 說明 |
| --- | --- | --- |
| `merchantId` | ✅ | 特店編號 |
| `hashKey` | ✅ | 16 字元的 AES HashKey（僅限伺服器端） |
| `hashIV` | ✅ | 16 字元的 AES HashIV（僅限伺服器端） |
| `mode` | | `"TEST"`（預設，測試環境）或 `"PRODUCTION"` |
| `validatePayload` | | 在本地端驗證開立的 payload（預設 `true`） |
| `debug` | | 選用的請求追蹤 logger（metadata：method/url/status/耗時/error，不含請求內容）（預設 `undefined`） |

此外也接受由 `@paid-tw/einvoice` 的 `BaseProviderConfig` 繼承而來的共用欄位：`baseUrl` / `timeoutMs` / `fetch` / `debug`（適用於 sandbox / 自訂 agent / edge runtime 等情境）。

輸入會先經共用 schema 驗證，失敗丟出 `InvoiceError`（code `VALIDATION`）；可用 `validatePayload: false` 關閉本地驗證。

## 字軌 / 編號

```ts
// 查詢財政部配號結果 — the invoice-number ranges allocated for a 民國年.
const ranges = await invoices.getGovInvoiceWordSetting("115");
// → [{ term, invType, header, start, end, count }, …]; throws NOT_FOUND if unallocated.

// 查詢字軌 — this merchant's own 字軌 (TrackID, range, used number, status).
const tracks = await invoices.getInvoiceWordSetting({ invoiceYear: "115", useStatus: "IN_USE" });
// → [{ trackId, year, term, invType, header, start, end, currentNumber, status }, …]

// 設定字軌號碼狀態 — a newly added 字軌 is inactive; enable it before issuing.
await invoices.setInvoiceWordStatus(trackId, "ENABLE"); // or "PAUSE" / "DISABLE"
```

## 發票列印

```ts
// Get a print URL (valid for 1 hour). Defaults to single-sided, today's date.
const url = await invoices.getPrintUrl({
  invoiceNumber: "JU11084038",
  invoiceDate: "2026-06-17", // optional; defaults to today (Asia/Taipei)
  style: "DOUBLE",   // SINGLE | DOUBLE | THERMAL | B2B_A4 | B2B_A5
  showDetail: true,  // B2B / 統編 invoices always show detail
  reprint: true,     // stamp as 補印 (ignored for B2B styles)
});
```

只有可列印紙本的發票才有效：含載具或捐贈的發票（`Print=0`）或
未知的號碼會回傳 查無資料 → `NOT_FOUND`。`B2B_A4` / `B2B_A5` 樣式
需要帶有統編的發票。

## 發送發票通知

```ts
// Email / SMS an invoice, void, allowance or award notification to the buyer
// and/or merchant. ECPay's stage env validates the request but does not deliver.
await invoices.sendNotification({
  invoiceNumber: "JU11084029",
  tag: "ISSUE",        // ISSUE | VOID | ALLOWANCE | ALLOWANCE_VOID | AWARD | ONLINE_ALLOWANCE
  method: "EMAIL",     // EMAIL | SMS | BOTH
  recipient: "CUSTOMER", // CUSTOMER | MERCHANT | BOTH
  email: "buyer@example.com", // and/or phone — at least one is required
});
```

折讓相關的 tag（`ALLOWANCE` / `ALLOWANCE_VOID` / `ONLINE_ALLOWANCE`）需要帶
`allowanceNumber`；`ONLINE_ALLOWANCE` 必須使用 `EMAIL` + `CUSTOMER`。對
未中獎的發票以 `tag: "AWARD"` 發送通知會拋出 `NOT_FOUND`（查無發票中獎資料）。

## 註銷重開

```ts
// Atomically void an invoice and reissue it. ECPay keeps the original
// 發票號碼 / 自訂編號 / 開立時間 — only the random code changes — so the reissue
// must carry the original orderId and issue time. Do it before the 13th of the
// month after the invoice's period.
const res = await invoices.voidWithReissue({
  invoiceNumber: orig.invoiceNumber,
  voidReason: "客戶要求重開",      // ≤ 20 chars
  invoiceDate: orig.invoiceDate,  // the original issue time (Date or yyyy-MM-dd HH:mm:ss)
  reissue: { ...issueInput, orderId: orig.orderId }, // same shape as issue()
});
res.invoiceNumber === orig.invoiceNumber; // true — reuses the original number
```

尚在待處理的發票（尚未上傳至財政部）還無法再次作廢；
未知的號碼會回傳 查無發票資料 → `NOT_FOUND`。

## 補充說明

- 零稅率發票（`taxType: "ZERO_RATED"` 或混合）需要通關方式註記：
  傳入 `providerOptions: { clearanceMark: "1" | "2" }`（1=非經海關，2=經海關）。
  這些驗證規則是依據實機 API 行為驗證，而非僅參照文件（例如
  ECPay 的 `ZeroTaxRateReason`/`SpecialTaxType`「必填」其實並未被
  API 強制，且 載具+捐贈 / B2B+載具 也會被接受）。
- `void` 與 `allowance` 需要發票的日期 — 透過
  `providerOptions: { invoiceDate: "YYYY-MM-DD" }` 傳入（開立結果中已帶有此值）。
  省略時預設為今日（Asia/Taipei）。
- `allowance` 使用 一般開立折讓（`/B2CInvoice/Allowance`，紙本）：會立即回傳真實的
  折讓單號，並可立即作廢（綠界 隔日才上傳至財政部）。預設不通知買受人；傳入
  `providerOptions: { allowanceNotify: "E"|"S"|"A", notifyMail, notifyPhone, reason }`
  即可發送通知。
- `allowanceOnline(input, { notifyMail, returnUrl?, … })` 為 線上折讓
  （AllowanceByCollegiate）：ECPay 會以 email 寄給買受人一個確認連結（72 小時
  `expiresAt`）；唯有買受人點選後才會開立折讓。可用
  `cancelAllowanceOnline({ invoiceNumber, allowanceNumber })` 取消尚在待處理者；
  已確認或紙本者則用 `voidAllowance` 作廢。
- 實機測試以 `ECPAY_LIVE=1` 執行（預設使用 `ECPAY_SANDBOX`）。

## 授權條款

MIT

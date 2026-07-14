# @paid-tw/einvoice-ezpay

[![npm version](https://img.shields.io/npm/v/@paid-tw/einvoice-ezpay.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ezpay)
[![npm downloads](https://img.shields.io/npm/dm/@paid-tw/einvoice-ezpay.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ezpay)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice-ezpay.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/npm/l/@paid-tw/einvoice-ezpay.svg)](https://github.com/paid-tw/einvoice/blob/main/LICENSE)

[English](./README.en.md) ｜ **繁體中文**

[ezPay](https://www.ezpay.com.tw/)（簡單行動支付 / 藍新）用於
[`@paid-tw/einvoice`](https://www.npmjs.com/package/@paid-tw/einvoice) 的轉接器。
在 ezPay 電子發票 API 之上實作統一的 `InvoiceProvider` 介面。

```bash
pnpm add @paid-tw/einvoice @paid-tw/einvoice-ezpay
```

```ts
import { createEzpayProvider } from "@paid-tw/einvoice-ezpay";

const invoices = createEzpayProvider({
  merchantId: process.env.EZPAY_MERCHANT_ID!,
  hashKey: process.env.EZPAY_HASH_KEY!, // 32 chars
  hashIV: process.env.EZPAY_HASH_IV!, // 16 chars
  mode: "TEST", // cinv host; "PRODUCTION" → inv host
});

const result = await invoices.issue({ /* IssueInvoiceInput */ });
```

由於它與 Amego 轉接器實作相同的 `InvoiceProvider` 介面，切換供應商只需修改一行設定，
你的商業邏輯完全不需要更動。

## 與 Amego 的差異

| 項目 | ezPay |
| --- | --- |
| 驗證 | AES-256-CBC 加密的 `PostData_`（HashKey/HashIV），而非 MD5 簽章 |
| 補位 | PKCS7 補位至 **32 位元組** 的倍數（ezPay 慣例），小寫十六進位 |
| 主機 | 測試 `cinv.ezpay.com.tw`，正式 `inv.ezpay.com.tw`（由 `mode` 選擇） |
| 回應 | 純文字 JSON `{ Status, Message, Result }`（Result 為 JSON 字串） |
| 商品項目 | 以管線符號 `\|` 串接的 `ItemName`/`ItemCount`/`ItemUnit`/`ItemPrice`/`ItemAmt` |
| 驗證碼 | 回應的 `CheckCode` = 以 HashIV/HashKey 包夾 5 個排序欄位後的 SHA256 |

## 設定

| 選項 | 必填 | 說明 |
| --- | --- | --- |
| `merchantId` | ✅ | 商店代號 (`MerchantID_`) |
| `hashKey` | ✅ | 32 字元的 AES HashKey（僅限伺服器端） |
| `hashIV` | ✅ | 16 字元的 AES HashIV（僅限伺服器端） |
| `mode` | | `"TEST"`（預設，cinv）或 `"PRODUCTION"`（inv） |
| `respondType` | | `"JSON"`（預設）或 `"String"` |
| `validatePayload` | | 在本地端驗證開立的資料內容（預設 `true`） |
| `verifyCheckCode` | | 驗證開立系列回應的 `CheckCode`（進階選項） |
| `debug` | | 選用的請求追蹤 logger（metadata：method/url/status/耗時/error，不含請求內容）。預設 `undefined` |

輸入會先經共用 schema 驗證，失敗丟出 `InvoiceError`（code `VALIDATION`）。ezPay 僅支援 TWD —— 非 TWD 的 `currency` 在送出前即被拒（`UNSUPPORTED`）。

## 觸發開立 / 觸發折讓（兩階段，ezPay 特有）

除了即時開立之外，ezPay 還支援先保留發票／折讓，之後再觸發。這些功能無法對應到統一介面，
因此以 `EzpayProvider` 上的額外方法提供：

```ts
// Hold an invoice (Status=0) — stored on the platform, not yet issued.
const pending = await invoices.issuePending({ /* IssueInvoiceInput */ });

// Trigger it → real invoice number.
const issued = await invoices.triggerIssue({
  invoiceTransNo: pending.invoiceTransNo,
  orderId: pending.orderId,
  totalAmount: pending.totalAmount,
});

// Confirm / cancel a held allowance (opened with providerOptions: { status: "0" }).
await invoices.triggerAllowance({
  allowanceNumber,
  orderId,
  totalAmount,
  action: "CONFIRM", // or "CANCEL"
});
```

保留中（`Status=3`）的預約發票也可以用 `triggerIssue` 提前開立。已確認的折讓會在隔天上傳，
之後就無法再取消，若要作廢已上傳的折讓，請改用 `voidAllowance`。

## 載具驗證（手機條碼 / 愛心碼）

在開立前先檢查手機條碼載具或捐贈碼是否已於財政部登錄，
背後使用 ezPay 的 `/Api_inv_application/` 查詢：

```ts
await invoices.validateMobileBarcode("/ABC1234"); // → boolean (IsExist)
await invoices.validateLoveCode("8585"); // → boolean
```

格式會先在本地端檢查（手機條碼 `/` + 7 個 `[0-9A-Z.+-]`；愛心碼 3–7 位數字）。
宣告為 `CARRIER_VALIDATION` 能力。

### 錯誤提示（選用）

ezPay 的帳號／串接層錯誤（金鑰不符、尚未申請 API 串接、合約到期、可開立張數
用罄…）從原始訊息看不出「接下來該做什麼」，而這些恰好都需要商家自己到 ezPay
後台處理。`ezpayErrorHint()` 把這類錯誤碼翻成可直接顯示給商家的 zh-TW 行動
指引；不屬於此類的錯誤回傳 `undefined`，請退回顯示 `error.message`（ezPay 原文）：

```ts
import { ezpayErrorHint } from "@paid-tw/einvoice-ezpay";
import { isInvoiceError } from "@paid-tw/einvoice";

try {
  await invoices.issue(input);
} catch (e) {
  const hint = ezpayErrorHint(e); // 也接受 rawCode："KEY10002"
  showError(hint ?? (isInvoiceError(e) ? e.message : "開立失敗"));
}
```

涵蓋：`KEY10002`／`KEY10006`／`INV90005`／`KEY10007`（金鑰與串接設定）、
`INV10020`／`INV10021`（帳號狀態）、`INV90006`（可開立張數用罄——ezPay 以張數
計，非字軌配號）、`NOR10001`／`KEY10014`／`CBC10003`／`CBC10004`（暫時性錯誤）、
`LIB10014`（24 小時內重複作廢的頻率限制）。其中 `KEY10002`「解密失敗」最常見的
實際原因是把測試商店（cinv）的憑證打到正式主機（inv）——ezPay 測試與正式為
不同主機、不同商店註冊，提示會一併指出。

若要以程式分流（而非顯示），請改用 `InvoiceError` 上正規化的 `reason` 欄位
（如 `duplicate_order`／`void_blocked_by_allowance`），或以 `ezpayErrorReason(rawCode)`
直接查表——不需要在呼叫端自行維護原始錯誤碼對照。

## 瀏覽器表單 POST（僅建立而不送出）

對於瀏覽器直接 POST 至 ezPay 的流程——例如結果頁面由 ezPay 渲染的查詢（`DisplayFlag=1`）——
可在不實際發出請求的情況下，建立加密後的表單欄位：

```ts
// Generic: encrypt any params for a chosen endpoint.
const { MerchantID_, PostData_ } = invoices.buildPostData({ /* ... */ });

// Query-specific: pass providerOptions.displayFlag to hand the result page to ezPay.
const fields = invoices.buildQueryPostData({
  invoiceNumber: "BB00000001",
  providerOptions: { randomNum: "4253", displayFlag: "1" },
});
// POST { MerchantID_, PostData_ } as a form to the matching endpoint URL.
```

## 注意事項

- ezPay 查詢除了統一的 `invoiceNumber`/`orderId` 之外，還需要一個額外的鍵值：
  傳入 `providerOptions: { randomNum }`（SearchType 0）或 `{ totalAmt }`
  （SearchType 1）。
- 即時生命週期測試會在設定 `EZPAY_LIVE=1` 並提供環境變數憑證的情況下，於測試環境執行：
  即時（issue → query → void）、折讓
  （issue → allowance → void）、觸發開立（issuePending → triggerIssue → void），
  以及觸發折讓（held allowance → cancel）。

## 授權

MIT

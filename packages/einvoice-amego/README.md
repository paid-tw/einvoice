# @paid-tw/einvoice-amego

[![npm version](https://img.shields.io/npm/v/@paid-tw/einvoice-amego.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-amego)
[![npm downloads](https://img.shields.io/npm/dm/@paid-tw/einvoice-amego.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-amego)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice-amego.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/npm/l/@paid-tw/einvoice-amego.svg)](https://github.com/paid-tw/einvoice/blob/main/LICENSE)

[English](./README.en.md) ｜ **繁體中文**

[`@paid-tw/einvoice`](https://www.npmjs.com/package/@paid-tw/einvoice) 的
[Amego](https://invoice.amego.tw/) 轉接器。透過 Amego 電子發票 API 實作
`InvoiceProvider` 介面。

```bash
pnpm add @paid-tw/einvoice @paid-tw/einvoice-amego
```

```ts
import { createAmegoProvider } from "@paid-tw/einvoice-amego";

const invoices = createAmegoProvider({
  sellerUbn: "12345678",            // 賣方統一編號
  appKey: process.env.AMEGO_APP_KEY!,
});

await invoices.issue({ /* IssueInvoiceInput */ });
```

Amego 測試與正式環境共用**同一個主機**，環境是由你的憑證決定，而非由 URL 或
模式決定。

### 免帳號試用

Amego 提供共用的**測試（sandbox）**憑證。你可以直接使用匯出的 `AMEGO_SANDBOX`
對測試商家開立發票：

```ts
import { createAmegoProvider, AMEGO_SANDBOX } from "@paid-tw/einvoice-amego";

const invoices = createAmegoProvider(AMEGO_SANDBOX); // 統編 12345678 — never use in production
```

## 狀態

請求簽章、各端點的欄位約定，以及回應解析皆已**對 Amego 線上測試環境驗證過**。
Amego 各端點之間刻意不一致——這個轉接器把驗證過的真實情況封裝起來，讓你不必自己處理：

| 項目 | 細節 |
| --- | --- |
| 大小寫 | `f0401` / `*_print` 使用 **PascalCase**；`invoice_query` / `*_file` / `*_list` / `allowance_query` 使用 **snake_case** |
| 陣列負載 | `f0501`、`g0401`、`g0501`、`*_status`、`ban_query` 接受 **JSON 陣列** |
| 區別欄位 | `invoice_query` / `invoice_file` 需要 `type: "invoice"` |
| 稅額拆分 | B2B 三聯式拆分未稅銷售額 + 稅額；B2C 二聯式保留含稅總額且稅額為 0；品項稅別混用 ⇒ 發票 TaxType 9 |
| 折讓 | 採用**未稅**金額並逐行帶 `Tax`；不回傳號碼（你提供的 `AllowanceNumber` 即為 id） |
| 日期 | 開立回傳 unix `invoice_time`；查詢回傳 `invoice_date`（YYYYMMDD）+ `invoice_time`（HH:MM:SS） |

你可以用 `AMEGO_LIVE=1` 自行執行線上生命週期測試（參見 `src/__tests__/live.test.ts`）。

### 韌性（選用）

```ts
createAmegoProvider({
  sellerTaxId, appKey,
  syncTime: true,                       // sync clock vs /json/time (avoids error 15)
  retry: { maxRetries: 3, baseDelayMs: 500 }, // retry transient network failures only
});
```

### 載具 / 統編 驗證

```ts
await invoices.validateMobileBarcode("/TRM+O+P"); // → boolean (registered?)
await invoices.validateBan("28080623");           // → boolean (company exists?)
```

`validateMobileBarcode` 與 ezPay 轉接器一致（`CARRIER_VALIDATION` 能力），因此兩個
provider 可互換使用；`barcodeQuery()` / `banQuery()` 則保留以取得完整的原始回應。

## 設定

| 選項 | 必填 | 說明 |
| --- | --- | --- |
| `sellerTaxId` | ✅ | 已在 Amego 註冊的賣方統一編號 |
| `appKey` | ✅ | 用於簽署請求的 App key（僅限伺服器端） |
| `mode` | | `"TEST"`（預設）或 `"PRODUCTION"` |
| `baseUrl` | | 覆寫 API 主機 |
| `timeoutMs` | | 請求逾時 |
| `fetch` | | 注入自訂的 `fetch` |

## 授權

MIT

# @paid-tw/einvoice

[![npm version](https://img.shields.io/npm/v/@paid-tw/einvoice.svg)](https://www.npmjs.com/package/@paid-tw/einvoice)
[![npm downloads](https://img.shields.io/npm/dm/@paid-tw/einvoice.svg)](https://www.npmjs.com/package/@paid-tw/einvoice)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/npm/l/@paid-tw/einvoice.svg)](https://github.com/paid-tw/einvoice/blob/main/LICENSE)

[English](./README.en.md) ｜ **繁體中文**

不綁定特定供應商的台灣電子發票**核心**（財政部 MIG 4.0）。定義統一的領域模型、
每個轉接器都要實作的 `InvoiceProvider` 介面、共用的 Zod 驗證，以及供測試使用的
記憶體內 `MockProvider`。

本套件**不含任何供應商邏輯，也不會發出網路請求** — 請另外搭配安裝一個供應商
轉接器（例如 `@paid-tw/einvoice-amego`）。

```bash
pnpm add @paid-tw/einvoice
```

## 匯出項目

- **型別** — `IssueInvoiceInput`、`AllowanceInput`、`Buyer`、`Carrier`、
  `TaxType`、`PriceMode`、`InvoiceCategory`、`AmountSummary`，… 以及它們的結果型別。
- **`InvoiceProvider`** — 介面契約：`issue`、`void`、`allowance`、
  `voidAllowance`、`query`。
- **`InvoiceError` / `InvoiceErrorCode` / `InvoiceErrorReason`** — 正規化的錯誤模型。
  `isInvoiceError(value)` 是它的型別守衛 — 比對的是以 `Symbol.for` 全域註冊的標記
  （而非 `instanceof`），因此即使載入了兩份套件（ESM/CJS 雙模組、版本不一致）仍可
  正確運作。`code` 刻意粗粒度（單一 `CONFLICT` 就涵蓋了訂單重複、已折讓不可作廢、
  已作廢、逾期——四種呼叫端處理方式完全不同的情境）；`reason` 是比 `code` 細一級、
  行動導向的語意軸（`duplicate_order`／`void_blocked_by_allowance`／`already_voided`／
  `past_deadline`／`rate_limited`／`credentials_invalid`…），由各轉接器負責對應
  （`amegoErrorReason`／`ezpayErrorReason`／`ecpayErrorReason`），無法判定時為
  `undefined`——呼叫端從此不必自行維護各供應商的原始錯誤碼對照表。
- **Schemas** — 用於執行階段驗證的 Zod schema（`issueInvoiceInputSchema`，…）。
  搭配 `parseInput(schema, input, provider)`：依共用 schema 驗證統一輸入，
  並丟出正規化的 `InvoiceError`（code 為 `VALIDATION`），而非原始的 `ZodError`。轉接器會使用它。
- **工具函式** — `composeTaxExclusive`、`splitTaxInclusive`、`deriveCategory`。
- **除錯記錄器** — `tracedFetch`，以及型別 `InvoiceDebugEvent` / `InvoiceDebugLogger`。
- **`MockProvider`** — 可實際運作、供測試使用的 `InvoiceProvider`。

## 金額計算

所有金額皆為整數的新台幣。請使用以下輔助函式一致地建立 `AmountSummary`：

```ts
import { composeTaxExclusive, splitTaxInclusive } from "@paid-tw/einvoice";

composeTaxExclusive(1000); // { salesAmount: 1000, taxAmount: 50, totalAmount: 1050 }
splitTaxInclusive(1050);   // { salesAmount: 1000, taxAmount: 50, totalAmount: 1050 }
```

## 除錯追蹤

在任一供應商 config 上設定 `debug`（這是 `BaseProviderConfig` 的欄位），即可在每次
HTTP 呼叫時收到「僅含中繼資料」的追蹤事件（provider／method／url／status／durationMs／error）
— **不會記錄請求／回應內容**。

```ts
import type { InvoiceDebugEvent } from "@paid-tw/einvoice";

const debug = (e: InvoiceDebugEvent) => console.log(e.provider, e.method, e.status);
const provider = createAmegoProvider({ /* …credentials… */, debug });
```

## MockProvider

供測試使用的記憶體內 `InvoiceProvider`。可用 `capabilities` 限制宣告的功能
（省略 `FOREIGN_CURRENCY` 時，`issue` 會以 `UNSUPPORTED` 拒絕非 TWD 幣別），
並可用 `failNext(error)` 注入一次性失敗以演練錯誤處理路徑。

```ts
import { Capability, InvoiceError, InvoiceErrorCode, MockProvider } from "@paid-tw/einvoice";

const provider = new MockProvider({
  capabilities: [Capability.ISSUE, Capability.QUERY], // 未含 FOREIGN_CURRENCY
});

// 注入一次性失敗
provider.failNext(
  new InvoiceError("network down", { provider: "mock", code: InvoiceErrorCode.NETWORK }),
);
```

## 授權

MIT

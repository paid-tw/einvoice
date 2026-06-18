# @paid-tw/einvoice-ezpay-crossborder

[![npm version](https://img.shields.io/npm/v/@paid-tw/einvoice-ezpay-crossborder.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ezpay-crossborder)
[![npm downloads](https://img.shields.io/npm/dm/@paid-tw/einvoice-ezpay-crossborder.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ezpay-crossborder)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice-ezpay-crossborder.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/npm/l/@paid-tw/einvoice-ezpay-crossborder.svg)](https://github.com/paid-tw/einvoice/blob/main/LICENSE)

[English](./README.en.md) ｜ **繁體中文**

[`@paid-tw/einvoice`](https://www.npmjs.com/package/@paid-tw/einvoice) 的
[ezPay 境外電商](https://www.ezpay.com.tw/)（cross-border e-commerce supplier）
轉接器。這是 ezPay **獨立於標準版的另一項服務** —— 專供境外賣家對台灣消費者開立
B2C 電子發票，**原生支援外幣**。

```bash
pnpm add @paid-tw/einvoice @paid-tw/einvoice-ezpay-crossborder
```

```ts
import { createEzpayCrossBorderProvider } from "@paid-tw/einvoice-ezpay-crossborder";

const invoices = createEzpayCrossBorderProvider({
  merchantId: process.env.EZPAY_MERCHANT_ID!, // 必須為「境外電商」類型商店
  hashKey: process.env.EZPAY_HASH_KEY!, // 32 字元
  hashIV: process.env.EZPAY_HASH_IV!, // 16 字元
  mode: "TEST", // cinv 主機；"PRODUCTION" → inv 主機
});
```

> 需要一組**境外電商（境外電商）類型商店**。一般 ezPay 商店會回
> `INV10023 企業類型不符`。標準版請改用
> [`@paid-tw/einvoice-ezpay`](https://www.npmjs.com/package/@paid-tw/einvoice-ezpay)。

## 外幣

設定 `currency`（ISO 4217）+ `exchangeRate`，金額即帶 2 位小數。使用
`currency: "TWD"`（預設）時金額維持整數。

```ts
// 美金發票 —— 小數金額
await invoices.issue({
  orderId: "ORDER_1",
  buyer: { name: "Buyer", email: "buyer@example.com" }, // email 載具
  items: [{ description: "Service", quantity: 1, unitPrice: 21.30, amount: 21.30 }],
  amount: { salesAmount: 20.30, taxAmount: 1.00, totalAmount: 21.30 },
  taxType: "TAXABLE",
  priceMode: "TAX_INCLUSIVE",
  currency: "USD",
  exchangeRate: 31.5,
});
```

`EZPAY_CB_CURRENCIES` 匯出了 API 接受的 20 種幣別代碼（附件三）。經實機驗證：清單內的
幣別都能成功開立（含零小數幣別 JPY/KRW/VND/IDR，仍以 2 位小數送出）；清單外的幣別會被
ezPay 以 `INV10002 欄位資料格式錯誤-Currency` 拒絕（對應為 `VALIDATION`）。

## 運作方式（已於測試環境實機驗證）

| 項目 | 說明 |
| --- | --- |
| 線路格式 | 與標準 ezPay 相同：表單 `MerchantID_` + AES-256-CBC `PostData_`、`Status`/`Result` 信封、SHA-256 `CheckCode` —— 重用自 `@paid-tw/einvoice-ezpay`。 |
| 端點 | `crossBorderInvoiceIssue` / `crossBorderAllowanceIssue` / `crossBorderInvoiceSearch` 為跨境專屬；觸發 / 作廢 / 折讓觸發 / 作廢折讓則與標準版共用。 |
| 金額 | `currency = TWD` → 整數；外幣 → 2 位小數（查詢回傳時最多會帶 7 位小數）。 |
| 買受人 | B2C，**僅 email 載具** —— `buyer.email` 為必填。 |

## 各項操作

```ts
// 兩段式：暫存（Status 0=待觸發 / 3=預約）後再開立。
const pend = await invoices.issuePending(input);                 // 或 { mode: "SCHEDULE", createStatusTime: "2026-12-25" }
await invoices.triggerIssue({ invoiceTransNo: pend.invoiceTransNo, orderId: pend.orderId, totalAmount: 105 });

// 作廢。
await invoices.void({ invoiceNumber: "CC00000014", reason: "客戶取消" });

// 折讓 —— 預設為待確認（Status=0）；可稍後確認/取消，或立即確認。
const al = await invoices.allowance({
  invoiceNumber: "CC00000014",
  allowanceId: "ORDER_1",
  items: [{ description: "商品", quantity: 1, unitPrice: 105, amount: 105 }],
  amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
  providerOptions: { currency: "TWD", buyerEmail: "buyer@example.com", merchantOrderNo: "ORDER_1", confirm: true },
});
await invoices.confirmAllowance({ allowanceNumber: al.allowanceNumber, orderId: "ORDER_1", totalAmount: 105 });
await invoices.cancelAllowance({ allowanceNumber: al.allowanceNumber, orderId: "ORDER_1", totalAmount: 105 });
await invoices.voidAllowance({ invoiceNumber: "CC00000014", allowanceNumber: al.allowanceNumber });

// 查詢：以 invoiceNumber（+ randomCode）或 orderId（+ totalAmount）。
await invoices.query({ invoiceNumber: "CC00000014", providerOptions: { randomCode: "0446" } });
await invoices.query({ orderId: "ORDER_1", providerOptions: { totalAmount: 105, currency: "TWD" } });
```

## 能力

`ISSUE` · `VOID` · `ALLOWANCE` · `VOID_ALLOWANCE` · `QUERY` · `QUERY_BY_ORDER_ID`
· `SCHEDULED_ISSUE` · `FOREIGN_CURRENCY`。

跨境僅限 B2C，因此**不**宣告 `B2B`、`MIXED_TAX` 或 `CARRIER_VALIDATION` —— 傳入
`buyer.ubn`、`carrier`、`donation` 或混合的逐項稅別會拋出 `UNSUPPORTED`。

## 設定

| 選項 | 必填 | 說明 |
| --- | --- | --- |
| `merchantId` | ✅ | 境外電商商店代號 |
| `hashKey` | ✅ | 32 字元 AES HashKey（僅限伺服器端） |
| `hashIV` | ✅ | 16 字元 AES HashIV（僅限伺服器端） |
| `mode` | | `"TEST"`（預設，cinv）或 `"PRODUCTION"`（inv） |
| `validatePayload` | | 在本地端驗證開立的 payload（預設 `true`） |
| `debug` | | 選用的請求追蹤 logger（metadata：method/url/status/耗時/error，不含請求內容）（預設 `undefined`） |

`issue` / `allowance` 使用自訂驗證器（支援外幣 2 位小數金額），`void` / `voidAllowance` / `query`
使用共用 schema；失敗丟出 `InvoiceError`（code `VALIDATION`，或能力限制時 `UNSUPPORTED`）。

實機測試以 `EZPAY_CB_LIVE=1` 對境外電商測試商店執行。

## 授權條款

MIT

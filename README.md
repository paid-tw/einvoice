# einvoice-tw

[![CI](https://github.com/paid-tw/einvoice/actions/workflows/ci.yml/badge.svg)](https://github.com/paid-tw/einvoice/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@paid-tw/einvoice.svg?label=%40paid-tw%2Feinvoice)](https://www.npmjs.com/package/@paid-tw/einvoice)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/github/license/paid-tw/einvoice.svg)](./LICENSE)

[English](./README.en.md) ｜ **繁體中文**

統一的**台灣電子發票 SDK**。一套與供應商無關的介面，搭配多個供應商轉接器 —— 在
Amego、ECPay、ezPay、ezReceipt 等供應商之間切換，完全不需要動到你的商業邏輯。

台灣所有加值中心都包裝同一套財政部 MIG 4.0 規格，因此核心操作完全一致：**開立 /
作廢 / 折讓 / 折讓作廢 / 查詢**。本 SDK 將這些操作建模一次，讓每個供應商都只是一個
輕薄的轉接器。

## 套件

| 套件 | npm | 角色 |
| --- | --- | --- |
| [`@paid-tw/einvoice`](./packages/einvoice) | core | 統一型別、`InvoiceProvider` 介面、Zod 驗證、`MockProvider` |
| [`@paid-tw/einvoice-amego`](./packages/einvoice-amego) | adapter | Amego (amego.tw) — MD5 簽章 |
| [`@paid-tw/einvoice-ezpay`](./packages/einvoice-ezpay) | adapter | ezPay 藍新 (ezpay.com.tw) — AES 加密 |
| [`@paid-tw/einvoice-ecpay`](./packages/einvoice-ecpay) | adapter | ECPay 綠界 (ecpay.com.tw) — B2C 2.0，AES 加密 |
| [`@paid-tw/einvoice-ezpay-crossborder`](./packages/einvoice-ezpay-crossborder) | adapter | ezPay 境外電商 — 跨境 B2C、原生外幣 |
| [`@paid-tw/einvoice-ezreceipt`](./packages/einvoice-ezreceipt) | adapter | ezReceipt 易發票 (COIMOTION) — 訂單導向 REST、token 認證 |

只需安裝你會用到的供應商 —— 轉接器是各自獨立的套件，因此一個只用 Amego 的應用程式
永遠不會拉進其他供應商的相依套件。

```bash
pnpm add @paid-tw/einvoice @paid-tw/einvoice-amego
```

## 使用方式

```ts
import { composeTaxExclusive } from "@paid-tw/einvoice";
import { createAmegoProvider } from "@paid-tw/einvoice-amego";

const invoices = createAmegoProvider({
  sellerTaxId: "12345678",
  appKey: process.env.AMEGO_APP_KEY!,
  mode: "PRODUCTION",
});

const result = await invoices.issue({
  orderId: "order-1001",
  buyer: { email: "buyer@example.com" },
  items: [{ description: "訂閱方案", quantity: 1, unitPrice: 1000, amount: 1000 }],
  amount: composeTaxExclusive(1000), // → { salesAmount: 1000, taxAmount: 50, totalAmount: 1050 }
  taxType: "TAXABLE",
  priceMode: "TAX_EXCLUSIVE",
});

console.log(result.invoiceNumber); // 例如 "AB12345678"
```

只要更換建構子即可切換供應商 —— 你其餘的程式碼相依於 `InvoiceProvider` 介面，而非
特定轉接器。

### 不需憑證即可測試

```ts
import { MockProvider } from "@paid-tw/einvoice";

const invoices = new MockProvider(); // 相同的驗證，但不發送網路請求
```

### 功能偵測

各供應商支援的選用功能不盡相同。每個供應商都會宣告一組 `capabilities`，讓你能在
執行期就先分支處理，而不是等到呼叫失敗才發現缺少某項功能：

```ts
import { Capability, supports, assertSupports } from "@paid-tw/einvoice";

if (supports(invoices, Capability.SCHEDULED_ISSUE)) {
  // ...
}

// 或拋出 UnsupportedCapabilityError（屬於 InvoiceError，code 為 "UNSUPPORTED"）：
assertSupports(invoices, Capability.SCHEDULED_ISSUE);
```

## 能力對照

每個轉接器都會宣告一組 `capabilities`；可在執行期用
`supports(provider, cap)` / `assertSupports(provider, cap)` 偵測。

| 能力 | Amego | ECPay | ezPay | ezPay 跨境 | ezReceipt |
| --- | :---: | :---: | :---: | :---: | :---: |
| `ISSUE` — 開立 | ✅ | ✅ | ✅ | ✅ | ✅ |
| `VOID` — 作廢 | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ALLOWANCE` — 折讓 | ✅ | ✅ | ✅ | ✅ | ✅ |
| `VOID_ALLOWANCE` — 折讓作廢 | ✅ | ✅ | ✅ | ✅ | ✅ |
| `QUERY` — 查詢 | ✅ | ✅ | ✅ | ✅ | ✅ |
| `B2B` — 統一編號買受人 | ✅ | ✅ | ✅ | — | ✅ |
| `MIXED_TAX` — 混合稅率發票 | ✅ | ✅ | ✅ | — | ✅ |
| `QUERY_BY_ORDER_ID` — 以訂單編號查詢 | ✅ | ✅ | ✅ | ✅ | — |
| `SCHEDULED_ISSUE` — 預約未來開立 | — | ✅ | ✅ | ✅ | — |
| `CARRIER_VALIDATION` — 手機條碼 / 愛心碼 | ✅ | ✅ | ✅ | — | ✅ |
| `FOREIGN_CURRENCY` — `currency` + `exchangeRate` 外幣註記 | ✅ | — | — | ✅ | — |

不具 `FOREIGN_CURRENCY` 能力的供應商，收到非 TWD 的 `currency` 會拋出
`UNSUPPORTED` 錯誤，而非靜默丟棄該註記。

## 架構

```
@paid-tw/einvoice (core)         與供應商無關：型別、介面、schemas、MockProvider
        ▲
        │ implements InvoiceProvider
        │
@paid-tw/einvoice-amego          將統一模型 ⇄ Amego 連線格式對應（簽章、加密、欄位）
@paid-tw/einvoice-ecpay  …
```

- **金額**：法定金額欄位為整數新台幣 —— 這是 MIG 不變式（連跨境發票都以 TWD 申報
  財政部）。外幣交易可用 `currency`（ISO 4217）+ `exchangeRate` _註記_ 原始幣別；
  具 `FOREIGN_CURRENCY` 能力的供應商會記錄該幣別，其餘供應商則會拒絕非 TWD 的
  `currency`，而非靜默丟棄（見 [能力對照](#能力對照)）。
- **錯誤**會正規化為單一的 `InvoiceError`，帶有穩定的 `code`，並保留供應商原始的
  代碼/訊息。請用 `isInvoiceError(e)` 型別守衛（檢查全域 `Symbol.for` brand，即使
  載入了兩份套件副本也能正確判斷），而非 `instanceof`。
- 轉接器會先用共用的 Zod schemas（透過 `parseInput`）驗證輸入，才送出網路請求；
  驗證失敗一律丟出 `InvoiceError`（`code` 為 `VALIDATION`）。兩個刻意的例外維持
  各自的驗證器：ezReceipt 的 `issue`（`buyer.email` 可放會員 id）與跨境的
  `issue` / `allowance`（外幣 2 位小數金額）。
- 設定 config 上的 **`debug`** 即可追蹤每次 HTTP 請求 —— 收到 provider / method /
  url / status / 耗時 / 錯誤的 metadata 事件（不含請求內容），適合除錯與可觀察性。

## 開發

```bash
pnpm install
pnpm build         # 建置所有套件（透過 tsdown／rolldown 產生 ESM + CJS + d.ts）
pnpm test          # vitest（離線，使用 MSW mocks）
pnpm typecheck
pnpm lint          # oxlint（oxc linter，含 type-aware 規則）
pnpm format        # oxfmt（oxc formatter，printWidth 100）
```

發版使用 [changesets](https://github.com/changesets/changesets)：`pnpm changeset` →
`pnpm exec changeset version` → 推送 `vX.Y.Z` git tag（Publish workflow 以 OIDC
trusted publishing 自動發布）。

## 貢獻一個供應商

1. 建立 `packages/einvoice-<provider>/`，相依於 `@paid-tw/einvoice`。
2. 實作 `InvoiceProvider`；對應統一模型 ⇄ 供應商欄位。
3. 將供應商的錯誤代碼對應到 `InvoiceErrorCode`。
4. 針對網路邊界補上 fixtures 與測試。

## 授權條款

MIT

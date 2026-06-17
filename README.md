# einvoice-tw

[![CI](https://github.com/paid-tw/einvoice/actions/workflows/ci.yml/badge.svg)](https://github.com/paid-tw/einvoice/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@paid-tw/einvoice.svg?label=%40paid-tw%2Feinvoice)](https://www.npmjs.com/package/@paid-tw/einvoice)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/github/license/paid-tw/einvoice.svg)](./LICENSE)

[English](./README.en.md) ｜ **繁體中文**

統一的**台灣電子發票 SDK**。一套與供應商無關的介面，搭配多個供應商轉接器 —— 在
Amego、ECPay、ezPay 或財政部平台之間切換，完全不需要動到你的商業邏輯。

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

## 架構

```
@paid-tw/einvoice (core)         與供應商無關：型別、介面、schemas、MockProvider
        ▲
        │ implements InvoiceProvider
        │
@paid-tw/einvoice-amego          將統一模型 ⇄ Amego 連線格式對應（簽章、加密、欄位）
@paid-tw/einvoice-ecpay  …
```

- **金額**一律為整數新台幣。
- **錯誤**會正規化為單一的 `InvoiceError`，帶有穩定的 `code`，並保留供應商原始的
  代碼/訊息。
- 轉接器會先用共用的 Zod schemas 驗證輸入，才送出網路請求。

## 開發

```bash
pnpm install
pnpm build       # 建置所有套件（透過 tsup 產生 ESM + CJS + d.ts）
pnpm test        # vitest
pnpm typecheck
```

發版使用 [changesets](https://github.com/changesets/changesets)：
`pnpm changeset` → `pnpm version` → `pnpm release`。

## 貢獻一個供應商

1. 建立 `packages/einvoice-<provider>/`，相依於 `@paid-tw/einvoice`。
2. 實作 `InvoiceProvider`；對應統一模型 ⇄ 供應商欄位。
3. 將供應商的錯誤代碼對應到 `InvoiceErrorCode`。
4. 針對網路邊界補上 fixtures 與測試。

## 授權條款

MIT

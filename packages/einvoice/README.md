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
- **`InvoiceError` / `InvoiceErrorCode`** — 正規化的錯誤模型。
- **Schemas** — 用於執行階段驗證的 Zod schema（`issueInvoiceInputSchema`，…）。
- **工具函式** — `composeTaxExclusive`、`splitTaxInclusive`、`deriveCategory`。
- **`MockProvider`** — 可實際運作、供測試使用的 `InvoiceProvider`。

## 金額計算

所有金額皆為整數的新台幣。請使用以下輔助函式一致地建立 `AmountSummary`：

```ts
import { composeTaxExclusive, splitTaxInclusive } from "@paid-tw/einvoice";

composeTaxExclusive(1000); // { salesAmount: 1000, taxAmount: 50, totalAmount: 1050 }
splitTaxInclusive(1050);   // { salesAmount: 1000, taxAmount: 50, totalAmount: 1050 }
```

## 授權

MIT

# @paid-tw/einvoice-ezpay-crossborder

[![npm version](https://img.shields.io/npm/v/@paid-tw/einvoice-ezpay-crossborder.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ezpay-crossborder)
[![npm downloads](https://img.shields.io/npm/dm/@paid-tw/einvoice-ezpay-crossborder.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ezpay-crossborder)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice-ezpay-crossborder.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/npm/l/@paid-tw/einvoice-ezpay-crossborder.svg)](https://github.com/paid-tw/einvoice/blob/main/LICENSE)

**English** ｜ [繁體中文](./README.md)

[ezPay 境外電商](https://www.ezpay.com.tw/) (cross-border e-commerce supplier)
adapter for [`@paid-tw/einvoice`](https://www.npmjs.com/package/@paid-tw/einvoice).
This is a **separate ezPay service** from the standard one — a distinct API for
foreign sellers issuing B2C e-invoices to Taiwan consumers, with native
foreign-currency support.

```bash
pnpm add @paid-tw/einvoice @paid-tw/einvoice-ezpay-crossborder
```

```ts
import { createEzpayCrossBorderProvider } from "@paid-tw/einvoice-ezpay-crossborder";

const invoices = createEzpayCrossBorderProvider({
  merchantId: process.env.EZPAY_MERCHANT_ID!, // a 境外電商-type merchant
  hashKey: process.env.EZPAY_HASH_KEY!, // 32 chars
  hashIV: process.env.EZPAY_HASH_IV!, // 16 chars
  mode: "TEST", // cinv host; "PRODUCTION" → inv host
});
```

> Needs a **cross-border (境外電商) merchant**. A standard ezPay merchant returns
> `INV10023 企業類型不符`. For the standard service use
> [`@paid-tw/einvoice-ezpay`](https://www.npmjs.com/package/@paid-tw/einvoice-ezpay).

## Foreign currency

Set `currency` (ISO 4217) + `exchangeRate`; the amounts then carry 2 decimals.
With `currency: "TWD"` (the default) the amounts stay integer.

```ts
// USD invoice — decimal amounts
await invoices.issue({
  orderId: "ORDER_1",
  buyer: { name: "Buyer", email: "buyer@example.com" }, // e-mail carrier
  items: [{ description: "Service", quantity: 1, unitPrice: 21.30, amount: 21.30 }],
  amount: { salesAmount: 20.30, taxAmount: 1.00, totalAmount: 21.30 },
  taxType: "TAXABLE",
  priceMode: "TAX_INCLUSIVE",
  currency: "USD",
  exchangeRate: 31.5,
});
```

## How it works (verified live on the test env)

| Aspect | Detail |
| --- | --- |
| Wire format | Same as standard ezPay: form `MerchantID_` + AES-256-CBC `PostData_`, `Status`/`Result` envelope, SHA-256 `CheckCode` — reused from `@paid-tw/einvoice-ezpay`. |
| Endpoints | `crossBorderInvoiceIssue` / `crossBorderAllowanceIssue` / `crossBorderInvoiceSearch` are cross-border-specific; trigger / void / allowance-touch / allowance-invalid are shared. |
| Amounts | `currency = TWD` → integers; foreign → 2 decimals (the API returns up to 7 decimals on read). |
| Buyer | B2C, **e-mail carrier only** — `buyer.email` is required. |

## Operations

```ts
// Two-phase: stage (Status 0=trigger / 3=schedule) then issue.
const pend = await invoices.issuePending(input);                 // or { mode: "SCHEDULE", createStatusTime: "2026-12-25" }
await invoices.triggerIssue({ invoiceTransNo: pend.invoiceTransNo, orderId: pend.orderId, totalAmount: 105 });

// Void.
await invoices.void({ invoiceNumber: "CC00000014", reason: "客戶取消" });

// Allowance — defaults to pending (Status=0); confirm/cancel later, or confirm now.
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

// Query: by invoiceNumber (+ randomCode) or by orderId (+ totalAmount).
await invoices.query({ invoiceNumber: "CC00000014", providerOptions: { randomCode: "0446" } });
await invoices.query({ orderId: "ORDER_1", providerOptions: { totalAmount: 105, currency: "TWD" } });
```

## Capabilities

`ISSUE` · `VOID` · `ALLOWANCE` · `VOID_ALLOWANCE` · `QUERY` · `QUERY_BY_ORDER_ID`
· `SCHEDULED_ISSUE` · `FOREIGN_CURRENCY`.

Cross-border is B2C-only, so it does **not** declare `B2B`, `MIXED_TAX` or
`CARRIER_VALIDATION` — passing a `buyer.ubn`, `carrier`, `donation` or mixed
per-item tax types throws `UNSUPPORTED`.

## Config

| Option | Required | Description |
| --- | --- | --- |
| `merchantId` | ✅ | 境外電商 merchant id |
| `hashKey` | ✅ | 32-char AES HashKey (server-side only) |
| `hashIV` | ✅ | 16-char AES HashIV (server-side only) |
| `mode` | | `"TEST"` (default, cinv) or `"PRODUCTION"` (inv) |
| `validatePayload` | | validate the issue payload locally (default `true`) |

Live tests run with `EZPAY_CB_LIVE=1` against a 境外電商 test merchant.

## License

MIT

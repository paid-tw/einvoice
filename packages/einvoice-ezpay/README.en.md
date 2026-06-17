# @paid-tw/einvoice-ezpay

[![npm version](https://img.shields.io/npm/v/@paid-tw/einvoice-ezpay.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ezpay)
[![npm downloads](https://img.shields.io/npm/dm/@paid-tw/einvoice-ezpay.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ezpay)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice-ezpay.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/npm/l/@paid-tw/einvoice-ezpay.svg)](https://github.com/paid-tw/einvoice/blob/main/LICENSE)

**English** ｜ [繁體中文](./README.md)

[ezPay](https://www.ezpay.com.tw/) (簡單行動支付 / 藍新) adapter for
[`@paid-tw/einvoice`](https://www.npmjs.com/package/@paid-tw/einvoice). Implements
the unified `InvoiceProvider` interface over the ezPay e-invoice API.

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

Because it implements the same `InvoiceProvider` interface as the Amego adapter,
switching providers is a one-line config change — your business logic doesn't
move.

## How it differs from Amego

| Concern | ezPay |
| --- | --- |
| Auth | AES-256-CBC encrypted `PostData_` (HashKey/HashIV), not MD5 signing |
| Padding | PKCS7 to a **32-byte** multiple (ezPay convention), lowercase hex |
| Host | test `cinv.ezpay.com.tw` vs prod `inv.ezpay.com.tw` (selected by `mode`) |
| Response | plaintext JSON `{ Status, Message, Result }` (Result is a JSON string) |
| Items | pipe-`\|`-joined `ItemName`/`ItemCount`/`ItemUnit`/`ItemPrice`/`ItemAmt` |
| Verify | response `CheckCode` = SHA256 over 5 sorted fields wrapped by HashIV/HashKey |

## Config

| Option | Required | Description |
| --- | --- | --- |
| `merchantId` | ✅ | 商店代號 (`MerchantID_`) |
| `hashKey` | ✅ | 32-char AES HashKey (server-side only) |
| `hashIV` | ✅ | 16-char AES HashIV (server-side only) |
| `mode` | | `"TEST"` (default, cinv) or `"PRODUCTION"` (inv) |
| `respondType` | | `"JSON"` (default) or `"String"` |
| `validatePayload` | | validate the issue payload locally (default `true`) |

## 觸發開立 / 觸發折讓 (two-phase, ezPay-specific)

Beyond immediate issue, ezPay supports holding an invoice/allowance and
triggering it later. These don't map onto the unified interface, so they are
extra methods on `EzpayProvider`:

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

A held (`Status=3`) scheduled invoice can also be issued early with
`triggerIssue`. A confirmed allowance uploads the next day and can no longer be
cancelled — void an uploaded one with `voidAllowance` instead.

## Carrier validation (手機條碼 / 愛心碼)

Check whether a mobile-barcode carrier or a donation code is registered at the
tax authority before issuing — backed by ezPay's `/Api_inv_application/` lookups:

```ts
await invoices.validateMobileBarcode("/ABC1234"); // → boolean (IsExist)
await invoices.validateLoveCode("8585"); // → boolean
```

Format is checked locally first (barcode `/` + 7 of `[0-9A-Z.+-]`; love code 3–7
digits). Declared as the `CARRIER_VALIDATION` capability.

## Browser Form POST (build without sending)

For flows where the browser POSTs straight to ezPay — e.g. a query whose result
page is rendered by ezPay (`DisplayFlag=1`) — build the encrypted form fields
without performing the request:

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

## Notes

- ezPay query needs an extra key beyond the unified `invoiceNumber`/`orderId`:
  pass `providerOptions: { randomNum }` (SearchType 0) or `{ totalAmt }`
  (SearchType 1).
- Live lifecycle tests run against the test environment with `EZPAY_LIVE=1` and
  the credentials in env: immediate (issue → query → void), allowance
  (issue → allowance → void), 觸發開立 (issuePending → triggerIssue → void),
  and 觸發折讓 (held allowance → cancel).

## License

MIT

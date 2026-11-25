# @paid-tw/einvoice-ezpay

[![npm version](https://img.shields.io/npm/v/@paid-tw/einvoice-ezpay.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ezpay)
[![npm downloads](https://img.shields.io/npm/dm/@paid-tw/einvoice-ezpay.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ezpay)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice-ezpay.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/npm/l/@paid-tw/einvoice-ezpay.svg)](https://github.com/paid-tw/einvoice/blob/main/LICENSE)

**English** ｜ [繁體中文](./README.md)

[ezPay](https://www.ezpay.com.tw/) (藍新, formerly 簡單行動支付) adapter for
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
| `merchantId` | ✅ | store id (商店代號), `MerchantID_` |
| `hashKey` | ✅ | 32-char AES HashKey (server-side only) |
| `hashIV` | ✅ | 16-char AES HashIV (server-side only) |
| `mode` | | `"TEST"` (default, cinv) or `"PRODUCTION"` (inv) |
| `respondType` | | `"JSON"` (default) or `"String"` |
| `validatePayload` | | validate the issue payload locally (default `true`) |
| `verifyCheckCode` | | verify the `CheckCode` on issue-family responses (expert knob) |
| `debug` | | optional request-tracing logger (metadata only: method / url / status / duration / error; no bodies). Default `undefined` |

Inputs are validated against the shared schema first; failures throw `InvoiceError` (code `VALIDATION`). ezPay only supports TWD — a non-TWD `currency` is rejected before sending (`UNSUPPORTED`).

## Trigger-issue / trigger-allowance (觸發開立 / 觸發折讓) — two-phase, ezPay-specific

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

## Carrier validation (mobile barcode 手機條碼 / charity code 愛心碼)

Check whether a mobile-barcode carrier or a donation code is registered at the
tax authority before issuing — backed by ezPay's `/Api_inv_application/` lookups:

```ts
await invoices.validateMobileBarcode("/ABC1234"); // → boolean (IsExist)
await invoices.validateLoveCode("8585"); // → boolean
```

Format is checked locally first (barcode `/` + 7 of `[0-9A-Z.+-]`; love code 3–7
digits). Declared as the `CARRIER_VALIDATION` capability.

### Error hints (optional)

ezPay's account/integration-level errors (wrong HashKey/IV, e-invoice API not
enabled, expired contract, invoice quota exhausted…) don't tell the merchant
*what to do next* — and they are exactly the ones only the merchant can fix in
the ezPay backend. `ezpayErrorHint()` translates those raw codes into
actionable zh-TW guidance suitable for direct display; anything else returns
`undefined` so you can fall back to `error.message` (ezPay's original text):

```ts
import { ezpayErrorHint } from "@paid-tw/einvoice-ezpay";
import { isInvoiceError } from "@paid-tw/einvoice";

try {
  await invoices.issue(input);
} catch (e) {
  const hint = ezpayErrorHint(e); // also accepts a raw code: "KEY10002"
  showError(hint ?? (isInvoiceError(e) ? e.message : "issue failed"));
}
```

Covers `KEY10002` / `KEY10006` / `INV90005` / `KEY10007` (keys & integration
setup), `INV10020` / `INV10021` (account state), `INV90006` (invoice quota),
exhausted number tracks (字軌 — ezPay answers with the generic `LIB10001`, which
the SDK normalizes to `NUMBER_EXHAUSTED` from the message; this hint needs the
`InvoiceError`, not the raw code), `NOR10001` / `KEY10014` /
`CBC10003` / `CBC10004` (transient), and `LIB10014` (the 24-hour re-void rate
limit). The most common real-world cause of `KEY10002` "decryption failed" is
test-store (cinv) credentials hitting the production host (inv) — ezPay's test
and production environments are separate hosts with separate registrations,
and the hint says so.

For programmatic branching (instead of display), use the normalized `reason`
field on `InvoiceError` (e.g. `duplicate_order` / `void_blocked_by_allowance`),
or look it up directly with `ezpayErrorReason(rawCode)` — no need to maintain
your own raw-code table at the call site.

## 字軌 management (`provider.track`, ezPay-specific)

Wraps ezPay's 字軌管理 API (EZP_Track 1.0.0): register a 字軌 range, change its
status, and list a period's ranges. These endpoints are keyed by the platform
**member** (`CompanyID_`), not the store, so they need extra config:

| Option | Description |
| --- | --- |
| `companyId` | Member id (會員編號, `CompanyID_`, e.g. `C54352706`) |
| `companyHashKey` / `companyHashIV` | The member's API keys (會員管理/基本資料); omit when they equal the store keys |

```ts
const invoices = createEzpayProvider({ merchantId, hashKey, hashIV, companyId: "C54352706" });

// year is the ROC year (民國年); term 1–6 = Jan–Feb … Nov–Dec
const track = await invoices.track.create({
  year: 115, term: 6, letters: "AB", startNumber: 0, endNumber: 49, // type defaults to "07"
});
await invoices.track.setStatus({ managementNo: track.managementNo, year: 115, status: "PAUSED" });
const tracks = await invoices.track.search({ year: 115, term: 6 }); // [] when there are none
```

Each returned range's `CheckCode` is verified (the 字軌 API wraps with `HashIv=`,
lowercase v, unlike the invoice API); `verifyCheckCode: false` disables it.
`LIB10004`/`LIB10016` (range exists / overlaps) and `SET10006` (status unchanged
or already disabled) map to `CONFLICT`; `MOD10003` and any 查無資料 message to
`NOT_FOUND` (an empty period really answers `INM10002` + 查無資料, so `search`
resolves `[]`); `INM10004` (bad parameter, e.g. a past period) to `VALIDATION`.
The undocumented `Flag=3` is a used-up range (`status: "EXHAUSTED"`), and a
disabled range is reported with `endNumber` equal to `startNumber`. The member
keys differ from the store keys in practice (the store keys get `KEY10002`). ezPay does not check
that a range was really assigned to you by 財政部 — verify before registering.

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
  (issue → allowance → void), trigger-issue (觸發開立) (issuePending →
  triggerIssue → void), and trigger-allowance (觸發折讓) (held allowance → cancel).

## License

MIT

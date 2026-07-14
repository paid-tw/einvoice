# @paid-tw/einvoice-ezreceipt

[![npm version](https://img.shields.io/npm/v/@paid-tw/einvoice-ezreceipt.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ezreceipt)
[![npm downloads](https://img.shields.io/npm/dm/@paid-tw/einvoice-ezreceipt.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ezreceipt)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice-ezreceipt.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/npm/l/@paid-tw/einvoice-ezreceipt.svg)](https://github.com/paid-tw/einvoice/blob/main/LICENSE)

**English** ｜ [繁體中文](./README.md)

[ezReceipt (易發票)](https://www.ezreceipt.cc/) (the **COIMOTION** platform) adapter for
[`@paid-tw/einvoice`](https://www.npmjs.com/package/@paid-tw/einvoice). Unlike the
encrypted form-post providers, ezReceipt is an **order-centric REST + JSON** API
with **token authentication**.

```bash
pnpm add @paid-tw/einvoice @paid-tw/einvoice-ezreceipt
```

```ts
import { createEzreceiptProvider } from "@paid-tw/einvoice-ezreceipt";

const invoices = createEzreceiptProvider({
  appCode: process.env.EZRECEIPT_APPCODE!, // x-deva-appcode (tax ID, 統編)
  appKey: process.env.EZRECEIPT_APPKEY!, // x-deva-appkey
  accName: process.env.EZRECEIPT_ACCNAME!, // a DEDICATED API account
  password: process.env.EZRECEIPT_PASSWORD!, // plaintext — hashed locally before sending
  mode: "TEST", // tryapi host; "PRODUCTION" → api host
});

await invoices.issue({ /* IssueInvoiceInput */ });
```

## Authentication (handled for you)

Every call carries `x-deva-appcode` + `x-deva-appkey`; privileged operations also
need an `x-deva-token`. The client logs in lazily (`sha1(sha1(accName)+password)` —
the plaintext never leaves the process), **caches the token**, and **transparently
re-logs in once on a `-3 Invalid token`**.

> ⚠️ **Use a dedicated API account.** COIMOTION allows one active token per
> account, so an API login invalidates a web-backend session on the same account
> (and vice-versa). Give the integration its own `accName`.

## How it works (verified live on the test env)

| Aspect | Detail |
| --- | --- |
| Transport | `POST` JSON to `{host}{endpoint}`; response `{ code, message, value }` (`code 0` = success). |
| Issue | All-in-one `eInvoice/invoice/issue` — the order is created implicitly from `prodList` (only `prodList` is required, `order` is optional). |
| Identity | Operations key off the internal `invID` / `awID` (not the invoice number, 發票號碼). The provider resolves the invID from the invoice number via `invoice/list`, or you can pass `providerOptions.invID` (the issue result's `raw.id`) to skip the lookup. |
| Amounts | The platform computes tax (`trCode` 0 = 5%); `prodList[].sales` is the unit price, `incTax` follows `priceMode`. |

## Operations

```ts
// issue (開立) — B2C (member carrier), B2B (tax ID, 統編), donation, mobile barcode, mixed tax…
const inv = await invoices.issue({
  orderId: "ORDER_1",
  buyer: { name: "Buyer", email: "m@x.com" },
  items: [{ description: "Item", quantity: 1, unitPrice: 100, amount: 100 }],
  amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
  taxType: "TAXABLE",
  priceMode: "TAX_EXCLUSIVE",
  carrier: { type: "MEMBER", code: "member_001" },
});

await invoices.query({ invoiceNumber: inv.invoiceNumber }); // resolves invID by number
await invoices.void({ invoiceNumber: inv.invoiceNumber, reason: "Customer canceled" });

const al = await invoices.allowance({
  invoiceNumber: inv.invoiceNumber,
  allowanceId: "A1",
  items: [{ description: "Item", quantity: 1, unitPrice: 100, amount: 100 }],
  amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
});
await invoices.voidAllowance({
  invoiceNumber: inv.invoiceNumber,
  allowanceNumber: al.allowanceNumber,
  providerOptions: { awID: (al.raw as { awID: number }).awID },
});
```

- **B2B**: pass `buyer.ubn` → mapped to `issueTo` (no carrier needed).
- **Donation**: pass `donation.npoban` → carrierType 5.
- **Mixed tax**: set per-item `taxType` (taxable 應稅 / zero-rated 零稅率 / tax-free 免稅).

> **Validation**: `issue` intentionally skips the shared schema — ezReceipt accepts a member id via `buyer.email`, which the schema's `.email()` check would reject; `void` / `allowance` / `voidAllowance` / `query` DO use the shared schema and throw `InvoiceError` (code `VALIDATION`) on failure.

## Capabilities

`ISSUE` · `VOID` · `ALLOWANCE` · `VOID_ALLOWANCE` · `QUERY` · `B2B` · `MIXED_TAX` ·
`CARRIER_VALIDATION` (validate a mobile barcode / charity code against the MOF
platform via `checkMobileCode` / `checkCharity`).

Not declared: `FOREIGN_CURRENCY` (a true cross-border 境外電商 / carrierType 20
needs a cross-border-type account — a normal account returns `1052`),
`SCHEDULED_ISSUE`, `QUERY_BY_ORDER_ID`.

## Extension methods

The unified interface only covers the 5 operations; the typed provider returned by
`createEzreceiptProvider` also exposes these directly:

**Reconciliation / lifecycle**

- `listInvoices` — list issued invoices (reconciliation / reporting).
- `revokeInvoice` — 註銷 an invoice (distinct from `void` 作廢).
- `replyInvoice` — reply to an exchange-type (msgType=2) invoice.

**Allowance helpers**

- `getAllowanceQuota` — each line's remaining creditable quota.
- `notifyAllowance` — queue allowance-event email notifications.
- `notifyInvoice` — queue invoice-event email notifications (recipient is not selectable, see below).

**Proof / print**

- `getInvoicePrintInfo` — data needed to render an invoice proof (JSON).
- `printInvoice` — invoice proof print file (PDF bytes). `format` is **required**; allowed values `1`/`2`/`11`/`12`/`21`/`22`/`25` (verified live; omitting it returns `304`).
- `printAllowance` — allowance print file (PDF bytes). `format`: `1` thermal / `2` A4.

**MOF (財政部) lookups**

- `checkMobileCode` — validate a mobile barcode against the MOF platform.
- `checkCharity` — validate a charity code against the MOF platform.
- `lookupBusiness` — look up business/organisation info by 統編.

**Invoice-track (字軌) management**

- `listInvoiceTracks` — list invoice-number track segments.
- `adjustInvoiceTrack` — adjust a track segment's start/end number.
- `setDefaultTrack` — set the default track (with / without 統編).
- `setInvoiceTrackStatus` — open / close a track segment.
- `splitInvoiceTrack` — split a track segment in two.
- `updateInvoiceTrack` — update a track (bizType / platform / memo).
- `listLogos` — list uploaded logo ids.
- `uploadLogo` — upload a logo image.
- `viewLogo` — read a logo image (bytes).
- `setInvoiceTrackLogo` — set the logo a track prints on invoices.

## Invoice-notification recipient (verified live)

`notifyInvoice` **cannot pick a recipient**. Behaviour verified live on `tryapi`:

- The endpoint ignores any per-send recipient override (`email` / `notifyEmail` /
  `to` / `receiverEmail` … none had any effect); `forceToBuyer` only flips the
  user's "notify buyer" toggle, it does not change the address.
- The invoice's `notifyEmail` (the intended target) is set **only at issue time**,
  via `issue`'s `providerOptions.sendTo.email` (after issuing, `view` shows it as
  `notifyEmail`). A top-level `notifyEmail` body field or a MEMBER carrier's
  `buyer.email` do **not** set it, and no endpoint changes it afterwards.
- ⚠️ The `tryapi` sandbox redirects **all** notification mail to the API account's
  own registered email (ignoring `notifyEmail`/buyer), so whether `notifyEmail` is
  the real delivery address cannot be confirmed there.
- To mail an **already-issued** invoice to an arbitrary address: render the proof
  with `printInvoice` and send it from your own mailer.

## Config

| Option | Required | Description |
| --- | --- | --- |
| `appCode` | ✅ | `x-deva-appcode` (tax ID 統一編號 / app code) |
| `appKey` | ✅ | `x-deva-appkey` |
| `accName` | ✅ | login account (dedicated API account) |
| `password` | ✅* | plaintext login password (*or supply a pre-obtained `token`) |
| `token` | | a pre-obtained access token, to skip login |
| `stID` | | partner store id (`x-deva-stid`) for partner (合作廠商) access |
| `mode` | | `"TEST"` (default, `tryapi`) or `"PRODUCTION"` (`api`) |
| `validatePayload` | | validate the issue payload locally (default `true`) |
| `debug` | | optional request-tracing logger (metadata only: method / url / status / duration / error; no bodies), default `undefined` |

Notes: invoice-number-track (字軌) allocation (配號) is **backend-only** — the API
can only manage existing tracks. Live tests run with `EZRECEIPT_LIVE=1` against a
dedicated API account.

## License

MIT

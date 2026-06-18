# @paid-tw/einvoice-amego

[![npm version](https://img.shields.io/npm/v/@paid-tw/einvoice-amego.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-amego)
[![npm downloads](https://img.shields.io/npm/dm/@paid-tw/einvoice-amego.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-amego)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice-amego.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/npm/l/@paid-tw/einvoice-amego.svg)](https://github.com/paid-tw/einvoice/blob/main/LICENSE)

**English** ｜ [繁體中文](./README.md)

[Amego](https://invoice.amego.tw/) adapter for
[`@paid-tw/einvoice`](https://www.npmjs.com/package/@paid-tw/einvoice). Implements
the `InvoiceProvider` interface over the Amego e-invoice API.

```bash
pnpm add @paid-tw/einvoice @paid-tw/einvoice-amego
```

```ts
import { createAmegoProvider } from "@paid-tw/einvoice-amego";

const invoices = createAmegoProvider({
  sellerUbn: "12345678",            // seller tax ID (賣方統一編號)
  appKey: process.env.AMEGO_APP_KEY!,
});

await invoices.issue({ /* IssueInvoiceInput */ });
```

Amego uses a **single host** for test and production — the environment is
selected by your credentials, not a URL or mode.

### Try it without an account

Amego publishes shared **sandbox** credentials. Use the exported `AMEGO_SANDBOX`
to issue against the test merchant straight away:

```ts
import { createAmegoProvider, AMEGO_SANDBOX } from "@paid-tw/einvoice-amego";

const invoices = createAmegoProvider(AMEGO_SANDBOX); // tax ID (統編) 12345678 — never use in production
```

## Status

Request signing, the per-endpoint field contracts, and response parsing are
**verified against the live Amego sandbox**. Amego is deliberately inconsistent
across endpoints — this adapter encodes the verified reality so you don't have to:

| Concern | Detail |
| --- | --- |
| Casing | `f0401` / `*_print` use **PascalCase**; `invoice_query` / `*_file` / `*_list` / `allowance_query` use **snake_case** |
| Array payloads | `f0501`, `g0401`, `g0501`, `*_status`, `ban_query` take a **JSON array** |
| Discriminator | `invoice_query` / `invoice_file` require `type: "invoice"` |
| Tax split | B2B triplicate (三聯式) splits untaxed sales + tax; B2C duplicate (二聯式) keeps the tax-inclusive (含稅) total with tax 0; mixed item tax types ⇒ invoice TaxType 9 |
| Allowance | tax-**exclusive** amounts with a per-line `Tax`; returns no number (the supplied `AllowanceNumber` is the id) |
| Dates | issue returns unix `invoice_time`; query returns `invoice_date` (YYYYMMDD) + `invoice_time` (HH:MM:SS) |

Run the live lifecycle test yourself with `AMEGO_LIVE=1` (see `src/__tests__/live.test.ts`).

### Resilience (opt-in)

```ts
createAmegoProvider({
  sellerTaxId, appKey,
  syncTime: true,                       // sync clock vs /json/time (avoids error 15)
  retry: { maxRetries: 3, baseDelayMs: 500 }, // retry transient network failures only
});
```

### Carrier / tax ID (統編) validation

```ts
await invoices.validateMobileBarcode("/TRM+O+P"); // → boolean (registered?)
await invoices.validateBan("28080623");           // → boolean (company exists?)
```

`validateMobileBarcode` mirrors the ezPay adapter (`CARRIER_VALIDATION`
capability) so the two providers are interchangeable; `barcodeQuery()` /
`banQuery()` remain for the full raw responses.

## Config

| Option | Required | Description |
| --- | --- | --- |
| `sellerTaxId` | ✅ | seller tax ID (賣方統一編號) registered with Amego |
| `appKey` | ✅ | App key used to sign requests (server-side only) |
| `mode` | | `"TEST"` (default) or `"PRODUCTION"` |
| `baseUrl` | | Override the API host |
| `timeoutMs` | | Request timeout |
| `fetch` | | Inject a custom `fetch` |
| `debug` | | optional request-tracing logger (metadata only: method / url / status / duration / error; no bodies) |
| `syncTime` | | sync clock vs `/json/time` to avoid error 15 (see Resilience example above) |
| `retry` | | retry transient network failures only (see Resilience example above) |

`mode` / `baseUrl` / `timeoutMs` / `fetch` / `debug` are shared fields inherited
from `@paid-tw/einvoice`'s `BaseProviderConfig`.

Inputs are validated against the shared schema first; failures throw
`InvoiceError` (code `VALIDATION`).

## License

MIT

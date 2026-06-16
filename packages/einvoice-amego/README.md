# @paid-tw/einvoice-amego

[Amego](https://invoice.amego.tw/) adapter for
[`@paid-tw/einvoice`](https://www.npmjs.com/package/@paid-tw/einvoice). Implements
the `InvoiceProvider` interface over the Amego e-invoice API.

```bash
pnpm add @paid-tw/einvoice @paid-tw/einvoice-amego
```

```ts
import { createAmegoProvider } from "@paid-tw/einvoice-amego";

const invoices = createAmegoProvider({
  sellerTaxId: "12345678",     // 賣方統一編號
  appKey: process.env.AMEGO_APP_KEY!,
  mode: "PRODUCTION",          // or "TEST"
});

await invoices.issue({ /* IssueInvoiceInput */ });
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
| Tax split | B2B 三聯式 splits untaxed sales + tax; B2C 二聯式 keeps the 含稅 total with tax 0; mixed item tax types ⇒ invoice TaxType 9 |
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

## Config

| Option | Required | Description |
| --- | --- | --- |
| `sellerTaxId` | ✅ | 賣方統一編號 registered with Amego |
| `appKey` | ✅ | App key used to sign requests (server-side only) |
| `mode` | | `"TEST"` (default) or `"PRODUCTION"` |
| `baseUrl` | | Override the API host |
| `timeoutMs` | | Request timeout |
| `fetch` | | Inject a custom `fetch` |

## License

MIT

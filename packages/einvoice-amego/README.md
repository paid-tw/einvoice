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

> ⚠️ **Field mapping is not yet verified.** The request signing and plumbing are
> implemented, but the unified→Amego field names, endpoint paths, and response
> parsing are marked with `// VERIFY:` and must be confirmed against the official
> docs at <https://invoice.amego.tw/api_doc/> before production use.

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

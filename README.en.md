# einvoice-tw

[![CI](https://github.com/paid-tw/einvoice/actions/workflows/ci.yml/badge.svg)](https://github.com/paid-tw/einvoice/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@paid-tw/einvoice.svg?label=%40paid-tw%2Feinvoice)](https://www.npmjs.com/package/@paid-tw/einvoice)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/github/license/paid-tw/einvoice.svg)](./LICENSE)

**English** ｜ [繁體中文](./README.md)

Unified **e-invoice (電子發票) SDK for Taiwan**. One provider-agnostic interface,
many provider adapters — switch between Amego, ECPay, ezPay, ezReceipt, and more
without touching your business logic.

All Taiwan value-added centers wrap the same MOF (財政部) MIG 4.0 spec, so the core
operations are identical: **issue / void / allowance / void-allowance / query**
(開立 / 作廢 / 折讓 / 折讓作廢 / 查詢). This SDK models those once and lets each
provider be a thin adapter.

## Packages

| Package | npm | Role |
| --- | --- | --- |
| [`@paid-tw/einvoice`](./packages/einvoice) | core | Unified types, `InvoiceProvider` interface, Zod validation, `MockProvider` |
| [`@paid-tw/einvoice-amego`](./packages/einvoice-amego) | adapter | Amego (amego.tw) — MD5-signed |
| [`@paid-tw/einvoice-ezpay`](./packages/einvoice-ezpay) | adapter | ezPay (藍新, ezpay.com.tw) — AES-encrypted |
| [`@paid-tw/einvoice-ecpay`](./packages/einvoice-ecpay) | adapter | ECPay (綠界, ecpay.com.tw) — B2C 2.0, AES-encrypted |
| [`@paid-tw/einvoice-ezpay-crossborder`](./packages/einvoice-ezpay-crossborder) | adapter | ezPay cross-border (境外電商) — B2C, foreign-currency-native |
| [`@paid-tw/einvoice-ezreceipt`](./packages/einvoice-ezreceipt) | adapter | ezReceipt (易發票, COIMOTION) — order-centric REST, token auth |

Install only the providers you use — adapters are separate packages, so an app
that only uses Amego never pulls in another provider's dependencies.

```bash
pnpm add @paid-tw/einvoice @paid-tw/einvoice-amego
```

## Usage

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
  items: [{ description: "Subscription plan", quantity: 1, unitPrice: 1000, amount: 1000 }],
  amount: composeTaxExclusive(1000), // → { salesAmount: 1000, taxAmount: 50, totalAmount: 1050 }
  taxType: "TAXABLE",
  priceMode: "TAX_EXCLUSIVE",
});

console.log(result.invoiceNumber); // e.g. "AB12345678"
```

Swap providers by changing only the constructor — the rest of your code depends
on the `InvoiceProvider` interface, not the adapter.

### Testing without credentials

`MockProvider` runs the same validation as a real adapter without any network. It
also models the state machine (no re-void / no allowance on a voided invoice),
gates on its declared capabilities, and exposes `failNext()` to inject a one-shot
error so you can exercise your error handling:

```ts
import { Capability, InvoiceError, MockProvider } from "@paid-tw/einvoice";

const invoices = new MockProvider(); // declares every capability by default

// Simulate a domestic-only provider — a non-TWD currency is rejected (UNSUPPORTED)
const domestic = new MockProvider({ capabilities: [Capability.ISSUE, Capability.VOID] });

// Inject a one-shot failure to test the caller's error path
invoices.failNext(new InvoiceError("network timeout", { provider: "mock", code: "NETWORK" }));
```

### Feature detection

Providers differ in optional features. Each declares a `capabilities` set so you
can branch at runtime instead of discovering a gap only when a call fails:

```ts
import { Capability, supports, assertSupports } from "@paid-tw/einvoice";

if (supports(invoices, Capability.SCHEDULED_ISSUE)) {
  // ...
}

// Or throw UnsupportedCapabilityError (an InvoiceError, code "UNSUPPORTED"):
assertSupports(invoices, Capability.SCHEDULED_ISSUE);
```

## Capabilities

Each adapter declares a `capabilities` set; feature-detect at runtime with
`supports(provider, cap)` / `assertSupports(provider, cap)`.

| Capability | Amego | ECPay | ezPay | ezPay X-border | ezReceipt |
| --- | :---: | :---: | :---: | :---: | :---: |
| `ISSUE` — issue (開立) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `VOID` — void (作廢) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ALLOWANCE` — allowance (折讓) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `VOID_ALLOWANCE` — void allowance (折讓作廢) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `QUERY` — query (查詢) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `B2B` — buyer with tax ID (統一編號) | ✅ | ✅ | ✅ | — | ✅ |
| `MIXED_TAX` — mixed tax-rate invoice | ✅ | ✅ | ✅ | — | ✅ |
| `QUERY_BY_ORDER_ID` — look up by order id | ✅ | ✅ | ✅ | ✅ | — |
| `SCHEDULED_ISSUE` — schedule future issuance | — | ✅ | ✅ | ✅ | — |
| `CARRIER_VALIDATION` — mobile barcode / charity code (手機條碼 / 愛心碼) | ✅ | ✅ | ✅ | — | ✅ |
| `FOREIGN_CURRENCY` — `currency` + `exchangeRate` annotation | ✅ | — | — | ✅ | — |

A provider that lacks `FOREIGN_CURRENCY` rejects a non-TWD `currency` with an
`UNSUPPORTED` error rather than silently dropping the annotation.

## Architecture

```
@paid-tw/einvoice (core)         provider-agnostic: types, interface, schemas, MockProvider
        ▲
        │ implements InvoiceProvider
        │
@paid-tw/einvoice-amego          maps unified model ⇄ Amego wire format (sign, encrypt, fields)
@paid-tw/einvoice-ecpay  …
```

- **Money**: the statutory amount fields are integers in New Taiwan Dollars — a
  MIG invariant (even cross-border invoices are filed to the government in TWD).
  A foreign-currency sale can be _annotated_ with `currency` (ISO 4217) +
  `exchangeRate`; providers with the `FOREIGN_CURRENCY` capability record the
  original currency, while the others reject a non-TWD `currency` instead of
  silently dropping it (see [Capabilities](#capabilities)).
- **Errors** are normalized to a single `InvoiceError` with a stable `code` plus
  the provider's raw code/message. Use the `isInvoiceError(e)` guard rather than
  `instanceof` — it checks a globally-registered `Symbol.for` brand, so it still
  works when two copies of the package are loaded (dual ESM/CJS, version skew).
- Adapters validate inputs with the shared Zod schemas (via `parseInput`) before
  hitting the network; a failure rejects with `InvoiceError` (code `VALIDATION`).
  Two intentional exceptions keep their own validators: ezReceipt's `issue`
  (accepts a member id via `buyer.email`) and the cross-border `issue`/`allowance`
  (2-decimal foreign amounts).
- Set `debug` on a config to trace every HTTP call — metadata-only events
  (provider / method / url / status / duration / error), not bodies.

## Development

```bash
pnpm install
pnpm build         # build all packages (ESM + CJS + d.ts via tsdown / rolldown)
pnpm test          # vitest (offline; uses MSW mocks)
pnpm typecheck
pnpm lint          # oxlint (oxc linter, with type-aware rules)
pnpm format        # oxfmt (oxc formatter, printWidth 100)
```

Releases use [changesets](https://github.com/changesets/changesets): `pnpm changeset`
→ `pnpm exec changeset version` → push a `vX.Y.Z` git tag (auto-published by the
Publish workflow via npm OIDC trusted publishing).

## Contributing a provider

1. `packages/einvoice-<provider>/`, depend on `@paid-tw/einvoice`.
2. Implement `InvoiceProvider`; map unified ⇄ provider fields.
3. Map the provider's error codes onto `InvoiceErrorCode`.
4. Add fixtures + tests against the network boundary.

## License

MIT

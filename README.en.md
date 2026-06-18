# einvoice-tw

[![CI](https://github.com/paid-tw/einvoice/actions/workflows/ci.yml/badge.svg)](https://github.com/paid-tw/einvoice/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@paid-tw/einvoice.svg?label=%40paid-tw%2Feinvoice)](https://www.npmjs.com/package/@paid-tw/einvoice)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/github/license/paid-tw/einvoice.svg)](./LICENSE)

**English** ｜ [繁體中文](./README.md)

Unified **e-invoice (電子發票) SDK for Taiwan**. One provider-agnostic interface,
many provider adapters — switch between Amego, ECPay, ezPay, or the MOF platform
without touching your business logic.

All Taiwan value-added centers wrap the same 財政部 MIG 4.0 spec, so the core
operations are identical: **開立 / 作廢 / 折讓 / 折讓作廢 / 查詢**. This SDK models
those once and lets each provider be a thin adapter.

## Packages

| Package | npm | Role |
| --- | --- | --- |
| [`@paid-tw/einvoice`](./packages/einvoice) | core | Unified types, `InvoiceProvider` interface, Zod validation, `MockProvider` |
| [`@paid-tw/einvoice-amego`](./packages/einvoice-amego) | adapter | Amego (amego.tw) — MD5-signed |
| [`@paid-tw/einvoice-ezpay`](./packages/einvoice-ezpay) | adapter | ezPay 藍新 (ezpay.com.tw) — AES-encrypted |
| [`@paid-tw/einvoice-ecpay`](./packages/einvoice-ecpay) | adapter | ECPay 綠界 (ecpay.com.tw) — B2C 2.0, AES-encrypted |
| [`@paid-tw/einvoice-ezpay-crossborder`](./packages/einvoice-ezpay-crossborder) | adapter | ezPay 境外電商 — cross-border B2C, foreign-currency-native |
| [`@paid-tw/einvoice-ezreceipt`](./packages/einvoice-ezreceipt) | adapter | ezReceipt 易發票 (COIMOTION) — order-centric REST, token auth |

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
  items: [{ description: "訂閱方案", quantity: 1, unitPrice: 1000, amount: 1000 }],
  amount: composeTaxExclusive(1000), // → { salesAmount: 1000, taxAmount: 50, totalAmount: 1050 }
  taxType: "TAXABLE",
  priceMode: "TAX_EXCLUSIVE",
});

console.log(result.invoiceNumber); // e.g. "AB12345678"
```

Swap providers by changing only the constructor — the rest of your code depends
on the `InvoiceProvider` interface, not the adapter.

### Testing without credentials

```ts
import { MockProvider } from "@paid-tw/einvoice";

const invoices = new MockProvider(); // same validation, no network
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
| `ISSUE` — 開立 | ✅ | ✅ | ✅ | ✅ | ✅ |
| `VOID` — 作廢 | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ALLOWANCE` — 折讓 | ✅ | ✅ | ✅ | ✅ | ✅ |
| `VOID_ALLOWANCE` — 折讓作廢 | ✅ | ✅ | ✅ | ✅ | ✅ |
| `QUERY` — 查詢 | ✅ | ✅ | ✅ | ✅ | ✅ |
| `B2B` — 統一編號 buyer | ✅ | ✅ | ✅ | — | ✅ |
| `MIXED_TAX` — mixed tax-rate invoice | ✅ | ✅ | ✅ | — | ✅ |
| `QUERY_BY_ORDER_ID` — look up by order id | ✅ | ✅ | ✅ | ✅ | — |
| `SCHEDULED_ISSUE` — schedule future issuance | — | ✅ | ✅ | ✅ | — |
| `CARRIER_VALIDATION` — 手機條碼 / 愛心碼 | ✅ | ✅ | ✅ | — | ✅ |
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
  the provider's raw code/message.
- Adapters validate inputs with the shared Zod schemas before hitting the network.

## Development

```bash
pnpm install
pnpm build       # build all packages (ESM + CJS + d.ts via tsup)
pnpm test        # vitest
pnpm typecheck
```

Releases use [changesets](https://github.com/changesets/changesets):
`pnpm changeset` → `pnpm version` → `pnpm release`.

## Contributing a provider

1. `packages/einvoice-<provider>/`, depend on `@paid-tw/einvoice`.
2. Implement `InvoiceProvider`; map unified ⇄ provider fields.
3. Map the provider's error codes onto `InvoiceErrorCode`.
4. Add fixtures + tests against the network boundary.

## License

MIT

# @paid-tw/einvoice

[![npm version](https://img.shields.io/npm/v/@paid-tw/einvoice.svg)](https://www.npmjs.com/package/@paid-tw/einvoice)
[![npm downloads](https://img.shields.io/npm/dm/@paid-tw/einvoice.svg)](https://www.npmjs.com/package/@paid-tw/einvoice)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/npm/l/@paid-tw/einvoice.svg)](https://github.com/paid-tw/einvoice/blob/main/LICENSE)

**English** ｜ [繁體中文](./README.md)

Provider-agnostic **core** for Taiwan e-invoices (MOF 財政部 MIG 4.0). Defines the
unified domain model, the `InvoiceProvider` interface every adapter implements,
shared Zod validation, and an in-memory `MockProvider` for tests.

This package has **no provider logic and no network calls** — install a provider
adapter (e.g. `@paid-tw/einvoice-amego`) alongside it.

```bash
pnpm add @paid-tw/einvoice
```

## Exports

- **Types** — `IssueInvoiceInput`, `AllowanceInput`, `Buyer`, `Carrier`,
  `TaxType`, `PriceMode`, `InvoiceCategory`, `AmountSummary`, … and their results.
- **`InvoiceProvider`** — the contract: `issue`, `void`, `allowance`,
  `voidAllowance`, `query`.
- **`InvoiceError` / `InvoiceErrorCode` / `InvoiceErrorReason`** — normalized error
  model. `isInvoiceError(value)` is its type guard — it checks a globally-registered
  `Symbol.for` brand (not `instanceof`), so it still works when two copies of the
  package are loaded (dual ESM/CJS, version skew). `code` is deliberately coarse
  (`CONFLICT` alone covers duplicate-order, void-blocked-by-allowance,
  already-voided and past-deadline — four situations a caller handles completely
  differently); `reason` is the finer, action-oriented axis (`duplicate_order` /
  `void_blocked_by_allowance` / `already_voided` / `past_deadline` / `rate_limited`
  / `credentials_invalid`…), resolved per adapter (`amegoErrorReason` /
  `ezpayErrorReason` / `ecpayErrorReason`) and `undefined` when unknown — so
  consumers no longer hand-roll per-provider raw-code tables.
- **Schemas** — Zod schemas (`issueInvoiceInputSchema`, …) for runtime validation.
  Pair with `parseInput(schema, input, provider)`: it validates a unified input
  against a shared schema and throws a normalized `InvoiceError` (code `VALIDATION`)
  instead of a raw `ZodError`. Adapters use it.
- **Utils** — `composeTaxExclusive`, `splitTaxInclusive`, `deriveCategory`.
- **Debug logger** — `tracedFetch`, plus the types `InvoiceDebugEvent` / `InvoiceDebugLogger`.
- **`MockProvider`** — a working `InvoiceProvider` for tests.

## Money & amounts

All amounts are integer New Taiwan Dollars. Use the helpers to build an
`AmountSummary` consistently:

```ts
import { composeTaxExclusive, splitTaxInclusive } from "@paid-tw/einvoice";

composeTaxExclusive(1000); // { salesAmount: 1000, taxAmount: 50, totalAmount: 1050 }
splitTaxInclusive(1050);   // { salesAmount: 1000, taxAmount: 50, totalAmount: 1050 }
```

## Debug tracing

Set `debug` on any provider config (it's a field on `BaseProviderConfig`) to receive
metadata-only trace events (provider/method/url/status/durationMs/error) for each HTTP
call — **bodies are not logged**.

```ts
import type { InvoiceDebugEvent } from "@paid-tw/einvoice";

const debug = (e: InvoiceDebugEvent) => console.log(e.provider, e.method, e.status);
const provider = createAmegoProvider({ /* …credentials… */, debug });
```

## MockProvider

An in-memory `InvoiceProvider` for tests. Use `capabilities` to restrict the declared
capabilities (with `FOREIGN_CURRENCY` omitted, `issue` rejects a non-TWD currency with
`UNSUPPORTED`), and `failNext(error)` to inject a one-shot failure for exercising error
paths.

```ts
import { Capability, InvoiceError, InvoiceErrorCode, MockProvider } from "@paid-tw/einvoice";

const provider = new MockProvider({
  capabilities: [Capability.ISSUE, Capability.QUERY], // no FOREIGN_CURRENCY
});

// Inject a one-shot failure
provider.failNext(
  new InvoiceError("network down", { provider: "mock", code: InvoiceErrorCode.NETWORK }),
);
```

## License

MIT

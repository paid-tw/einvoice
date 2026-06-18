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
- **`InvoiceError` / `InvoiceErrorCode`** — normalized error model.
- **Schemas** — Zod schemas (`issueInvoiceInputSchema`, …) for runtime validation.
- **Utils** — `composeTaxExclusive`, `splitTaxInclusive`, `deriveCategory`.
- **`MockProvider`** — a working `InvoiceProvider` for tests.

## Money & amounts

All amounts are integer New Taiwan Dollars. Use the helpers to build an
`AmountSummary` consistently:

```ts
import { composeTaxExclusive, splitTaxInclusive } from "@paid-tw/einvoice";

composeTaxExclusive(1000); // { salesAmount: 1000, taxAmount: 50, totalAmount: 1050 }
splitTaxInclusive(1050);   // { salesAmount: 1000, taxAmount: 50, totalAmount: 1050 }
```

## License

MIT

# @paid-tw/einvoice-ezreceipt

## 0.2.2

### Patch Changes

- Updated dependencies [d3cecf9]
  - @paid-tw/einvoice@0.5.0

## 0.2.1

### Patch Changes

- Upgrade Zod from v3 to v4 (`^4.4.3`).

  Migrated all schemas to the v4 API: `z.record(key, value)` now takes explicit
  key/value schemas, `z.string().email()` → `z.email()`, `.passthrough()` →
  `z.looseObject(...)`, the `required_error` enum param → `error`, and the removed
  `SafeParseReturnType` type → `ZodSafeParseResult`. No behavioural or public-API
  changes — the unified model, validation messages, and error codes are unchanged.

- Updated dependencies
  - @paid-tw/einvoice@0.4.1

## 0.2.0

### Minor Changes

- Observability, error-guard robustness, and a higher-fidelity test double.

  - **Opt-in request tracing.** Set `debug` on any provider config to receive
    metadata-only trace events (`provider` / `method` / `url` / `status` /
    `durationMs` / `error`) for each HTTP call. Every adapter routes its fetch
    through the new core `tracedFetch`; it is a zero-overhead passthrough when
    `debug` is unset, and request/response bodies are never logged.
  - **`isInvoiceError` now checks a `Symbol.for` brand**, not `instanceof`, so it
    still narrows correctly when two copies of the package are loaded (dual
    ESM/CJS, transitive version skew).
  - **MockProvider fidelity.** Configurable `capabilities` (a non-TWD `currency` is
    rejected with `UNSUPPORTED` when `FOREIGN_CURRENCY` is omitted), a tighter state
    machine (`allowance` on a voided invoice → `CONFLICT`; `voidAllowance` checks
    the allowance exists → `NOT_FOUND`), validation via the shared `parseInput`, and
    `failNext(error)` to inject a one-shot failure for exercising error paths.

### Patch Changes

- Updated dependencies
  - @paid-tw/einvoice@0.4.0

## 0.1.4

### Patch Changes

- Adopt the shared input schemas where they fit, so validation errors are normalized to `InvoiceError` (code `VALIDATION`) like the other adapters. ezReceipt wires `void` / `allowance` / `voidAllowance` / `query`; ezPay cross-border wires `void` / `voidAllowance` / `query`. `issue` (both) and crossborder `allowance` keep their provider-specific validators (ezReceipt accepts a member id via `buyer.email`; cross-border carries 2-decimal foreign-currency amounts).

## 0.1.3

### Patch Changes

- Updated dependencies
  - @paid-tw/einvoice@0.3.2

## 0.1.2

### Patch Changes

- Fix CJS type resolution. Each package's `exports["."]` had a single `types`
  pointing at the ESM `index.d.ts`, so `require()` consumers resolved ESM-shaped
  declarations. Split the map into per-condition `import` / `require` blocks, each
  with its own `types` (`index.d.ts` for ESM, `index.d.cts` for CJS — both already
  emitted by tsup). No API or runtime change. Verified with publint + attw
  (node10 / node16 CJS / node16 ESM / bundler all green).
- Updated dependencies
  - @paid-tw/einvoice@0.3.1

## 0.1.1

### Patch Changes

- ea54dbd: Fix the `.d.ts` build: `resolveInvID` now takes `providerOptions` as an optional
  parameter, so the internal one-argument call in `printInvoice` type-checks. The
  0.1.0 runtime was correct, but its generated type declarations were stale (the
  declaration build had been failing silently). No API change.

## 0.1.0

### Minor Changes

- 4f016d8: New adapter: ezReceipt 易發票 (COIMOTION API). Implements the unified
  `InvoiceProvider` over an order-centric REST + JSON API with token
  authentication — distinct from the encrypted form-post providers. The client
  logs in lazily (`sha1(sha1(accName)+password)`), caches the access token, and
  re-logs in transparently on `-3 Invalid token`. `issue` maps to the all-in-one
  `eInvoice/invoice/issue` (order created implicitly from `prodList`); void /
  query / allowance / voidAllowance key off the internal invID/awID (resolved from
  the invoice number, or via `providerOptions`). Supports B2B (issueTo 統編), mixed
  per-item tax, and member / 手機條碼 / donation carriers. Verified live end-to-end
  on the test environment; 100% line coverage with MSW + an env-gated live suite.

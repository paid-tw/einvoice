# @paid-tw/einvoice-ezpay-crossborder

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
  - @paid-tw/einvoice-ezpay@0.4.1

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
  - @paid-tw/einvoice-ezpay@0.4.0

## 0.1.4

### Patch Changes

- Adopt the shared input schemas where they fit, so validation errors are normalized to `InvoiceError` (code `VALIDATION`) like the other adapters. ezReceipt wires `void` / `allowance` / `voidAllowance` / `query`; ezPay cross-border wires `void` / `voidAllowance` / `query`. `issue` (both) and crossborder `allowance` keep their provider-specific validators (ezReceipt accepts a member id via `buyer.email`; cross-border carries 2-decimal foreign-currency amounts).

## 0.1.3

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @paid-tw/einvoice@0.3.2
  - @paid-tw/einvoice-ezpay@0.3.2

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
  - @paid-tw/einvoice-ezpay@0.3.1

## 0.1.1

### Patch Changes

- 535a7b3: Verify the response `CheckCode` on issued invoices (附件二). `issue` and
  `triggerIssue` now recompute the SHA-256 CheckCode over MerchantID /
  MerchantOrderNo / InvoiceTransNo / TotalAmt / RandomNum (reusing
  `@paid-tw/einvoice-ezpay`'s `makeCheckCode`) and throw a `PROVIDER` error on a
  mismatch, detecting a tampered or mis-routed reply. Controlled by the
  `verifyCheckCode` config option (default on). Verified live: the CheckCode
  matches real responses for TWD and every foreign currency (raw `TotalAmt`
  format, e.g. `"21.0000000"`, included).

## 0.1.0

### Minor Changes

- 9635d1c: New adapter: ezPay 境外電商 (cross-border e-commerce supplier). Implements the
  unified `InvoiceProvider` over ezPay's CES API — a separate service from the
  standard ezPay one, for foreign sellers issuing B2C e-invoices to Taiwan
  consumers. Foreign-currency-native (`FOREIGN_CURRENCY` capability: set
  `currency` + `exchangeRate`, amounts carry 2 decimals; the 20 currencies of
  附件三 are accepted, others return INV10002). B2C e-mail-carrier only, so 統編 /
  載具 / 捐贈 / 混合稅率 are rejected as `UNSUPPORTED`. Reuses the standard ezPay
  wire layer (AES-256-CBC, CheckCode) via `@paid-tw/einvoice-ezpay`. Verified live
  end-to-end on the ezPay cross-border test environment.

### Patch Changes

- Updated dependencies [ee30cb1]
  - @paid-tw/einvoice@0.3.0
  - @paid-tw/einvoice-ezpay@0.3.0

# @paid-tw/einvoice-ezreceipt

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

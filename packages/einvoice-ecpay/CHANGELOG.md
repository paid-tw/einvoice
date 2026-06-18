# @paid-tw/einvoice-ecpay

## 0.3.2

### Patch Changes

- A wrong-length `HashKey` / `HashIV` now throws a clear error naming the field and the actual byte count, instead of an opaque Node `createCipheriv` error (ECPay AES-128 → 16/16 bytes, ezPay AES-256 → 32/16).
- Input validation now rejects with a normalized `InvoiceError` (code `VALIDATION`, with the provider name and the offending field/message) instead of leaking a raw `ZodError` — matching the contract that every operation rejects with an `InvoiceError`.
- Updated dependencies
  - @paid-tw/einvoice@0.3.2

## 0.3.1

### Patch Changes

- Fix CJS type resolution. Each package's `exports["."]` had a single `types`
  pointing at the ESM `index.d.ts`, so `require()` consumers resolved ESM-shaped
  declarations. Split the map into per-condition `import` / `require` blocks, each
  with its own `types` (`index.d.ts` for ESM, `index.d.cts` for CJS — both already
  emitted by tsup). No API or runtime change. Verified with publint + attw
  (node10 / node16 CJS / node16 ESM / bundler all green).
- Updated dependencies
  - @paid-tw/einvoice@0.3.1

## 0.3.0

### Minor Changes

- ee30cb1: Add a `FOREIGN_CURRENCY` capability for the `currency` + `exchangeRate`
  annotation. Amego declares it and maps the fields; ECPay and ezPay don't
  support a foreign-currency field, so they now reject a non-TWD `currency` with
  an `UNSUPPORTED` error instead of silently dropping it. The statutory amounts
  are still integer TWD. The top-level README gains a capability matrix.

### Patch Changes

- Updated dependencies [ee30cb1]
  - @paid-tw/einvoice@0.3.0

## 0.2.0

### Minor Changes

- d8d2bd0: New adapter: ECPay 綠界 (B2C 電子發票 2.0). Implements the unified
  `InvoiceProvider` (issue/void/allowance/voidAllowance/query) over ECPay's
  AES-128-CBC JSON API — a third provider with yet another wire format
  (`JSON → PHP urlencode → AES-128 → Base64` Data field inside a TransCode/RtnCode
  envelope, Items as a JSON array, no CheckMacValue). Adds the 延遲/觸發開立
  two-phase (DelayIssue → TriggerIssue) and 手機條碼/愛心碼 carrier validation
  (CARRIER_VALIDATION capability), per-field issue validation with the business
  rules confirmed live (amount sum, paper vs carrier, donation), keyword-based
  RtnCode error mapping, the public `ECPAY_SANDBOX` credentials, MSW tests covering
  success and error paths, and an env-gated live suite verified end-to-end on the
  ECPay stage environment. 100% statement/function/line coverage.

### Patch Changes

- Updated dependencies [9adf03f]
- Updated dependencies [aa2b551]
- Updated dependencies [3eb6b07]
- Updated dependencies [4fa0a22]
  - @paid-tw/einvoice@0.2.0

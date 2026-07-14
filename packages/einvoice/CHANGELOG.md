# @paid-tw/einvoice

## 0.5.0

### Minor Changes

- d3cecf9: Add `InvoiceErrorReason` — a normalized, action-oriented semantic axis on
  `InvoiceError`, one level finer than `InvoiceErrorCode`. The codes are
  deliberately coarse (`CONFLICT` alone covers duplicate-order,
  void-blocked-by-allowance, already-voided and past-deadline — four situations
  a caller handles completely differently), which forced consumers to hand-roll
  per-provider raw-code tables. `reason` is that table, maintained once per
  adapter and `undefined` when unknown:

  - `@paid-tw/einvoice` — `InvoiceErrorReason` (13 values: `duplicate_order`,
    `void_blocked_by_allowance`, `already_voided`, `duplicate_allowance`,
    `past_deadline`, `carrier_not_registered`, `rate_limited`,
    `credentials_invalid`, `not_enrolled`, `contract_expired`, `ip_blocked`,
    `account_suspended`, `stale_timestamp`), the optional `reason` field on
    `InvoiceError` / `InvoiceErrorOptions`, and conditional `toJSON` inclusion.
  - `@paid-tw/einvoice-amego` — `amegoErrorReason(rawCode)`, wired into every
    thrown `InvoiceError`. Key mappings verified live (2026-07): `3040171`
    duplicate OrderId, `3050141` void blocked by allowance history (permanent,
    even after the allowance is voided), `3050131` repeat void, `3040132`
    unregistered carrier at issue time.
  - `@paid-tw/einvoice-ezpay` — `ezpayErrorReason(rawCode)` wired into both
    throw sites, plus `ezpayErrorHint()` (zh-TW merchant-actionable guidance,
    same convention as `amegoErrorHint`). Also reclassifies `LIB10014` (24-hour
    re-void rate limit, verified live on cinv) from the `VALIDATION`
    fallthrough to `PROVIDER` — it is transient, not a caller-input error.
    `@paid-tw/einvoice-ezpay-crossborder` inherits both via `ezpayRequest`.
  - `@paid-tw/einvoice-ecpay` — `ecpayErrorReason(rtnMsg)`, keyword-based like
    `mapEcpayError` (ECPay's `RtnCode` ranges are inconsistent; the message is
    the reliable signal).

## 0.4.1

### Patch Changes

- Upgrade Zod from v3 to v4 (`^4.4.3`).

  Migrated all schemas to the v4 API: `z.record(key, value)` now takes explicit
  key/value schemas, `z.string().email()` → `z.email()`, `.passthrough()` →
  `z.looseObject(...)`, the `required_error` enum param → `error`, and the removed
  `SafeParseReturnType` type → `ZodSafeParseResult`. No behavioural or public-API
  changes — the unified model, validation messages, and error codes are unchanged.

## 0.4.0

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

## 0.3.2

### Patch Changes

- - Enforce amount consistency (`salesAmount + taxAmount === totalAmount`) on **allowances** as well as invoices — `amountSummarySchema` now checks it, so `allowance()` rejects an inconsistent amount instead of sending it to the provider.
  - Add `InvoiceError.toJSON()` so structured logging keeps the normalized fields (`code` / `rawCode` / `rawMessage`); a plain `JSON.stringify(error)` used to drop them.
  - Add and export shared helpers: `parseInput`, `parseTaipeiDate`, `taipeiDateTime`, `taxTypeToCode`.

## 0.3.1

### Patch Changes

- Fix CJS type resolution. Each package's `exports["."]` had a single `types`
  pointing at the ESM `index.d.ts`, so `require()` consumers resolved ESM-shaped
  declarations. Split the map into per-condition `import` / `require` blocks, each
  with its own `types` (`index.d.ts` for ESM, `index.d.cts` for CJS — both already
  emitted by tsup). No API or runtime change. Verified with publint + attw
  (node10 / node16 CJS / node16 ESM / bundler all green).

## 0.3.0

### Minor Changes

- ee30cb1: Add a `FOREIGN_CURRENCY` capability for the `currency` + `exchangeRate`
  annotation. Amego declares it and maps the fields; ECPay and ezPay don't
  support a foreign-currency field, so they now reject a non-TWD `currency` with
  an `UNSUPPORTED` error instead of silently dropping it. The statutory amounts
  are still integer TWD. The top-level README gains a capability matrix.

## 0.2.0

### Minor Changes

- 9adf03f: Support cross-border foreign-currency invoices. `IssueInvoiceInput` gains optional
  `currency` (ISO 4217) and `exchangeRate` fields (exchangeRate required when
  currency ≠ TWD). The statutory amount fields remain TWD — a MIG invariant — so
  these annotate the original transaction. The Amego adapter maps them to the
  `Currency` / `ExchangeRate` fields; verified live.
- aa2b551: Initial release: provider-agnostic core (`@paid-tw/einvoice`) with unified types,
  `InvoiceProvider` interface, Zod validation, and `MockProvider`; plus the Amego
  adapter scaffold (`@paid-tw/einvoice-amego`).
- 3eb6b07: Add `isValidMobileBarcode` to core — a standalone 手機條碼 (載具 3J0002) format
  check ("/" + 7 of [0-9A-Z.+-]), now reused by `carrierSchema`. The Amego
  `barcodeQuery` validates the format locally first (fail-fast) and maps Amego's
  codes per the live-verified behaviour: 9000111/9000112 (empty/format) →
  VALIDATION, 9000113 (不存在) → NOT_FOUND.
- 4fa0a22: Add 統一編號 (UBN — Unified Business Number) validation as a standalone, provider-
  agnostic primitive in core: `isValidUbn(input, { legacy? })` implements the
  財政部 checksum (post-2023 ÷5, plus the legacy ÷10 option and the 7th-digit special
  case). The unified model now uses the official term: `Buyer.taxId` → `Buyer.ubn`
  and `taxIdSchema` → `ubnSchema` (which now verifies the checksum, not just 8
  digits). 統一編號 is distinct from a 稅籍編號 (tax registration number); the
  misleading `taxId` naming is gone.

  The Amego adapter consumes the core validator (its `BuyerIdentifier` and
  `banQuery` both checksum-validate, matching Amego's server-side enforcement —
  3040122 / 99), and `AmegoConfig.sellerTaxId` is renamed to `sellerUbn`. Amego's
  `ban` wire field is kept only at the API boundary. All verified live.

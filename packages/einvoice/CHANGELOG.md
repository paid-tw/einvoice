# @paid-tw/einvoice

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

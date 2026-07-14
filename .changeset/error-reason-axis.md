---
"@paid-tw/einvoice": minor
"@paid-tw/einvoice-amego": minor
"@paid-tw/einvoice-ezpay": minor
"@paid-tw/einvoice-ecpay": minor
---

Add `InvoiceErrorReason` — a normalized, action-oriented semantic axis on
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

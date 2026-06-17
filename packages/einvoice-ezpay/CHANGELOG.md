# @paid-tw/einvoice-ezpay

## 0.2.0

### Minor Changes

- 185e8b4: New adapter: ezPay (簡單行動支付 / 藍新). Implements the unified `InvoiceProvider`
  (issue/void/allowance/voidAllowance/query) over ezPay's AES-256-CBC-encrypted API
  — a second, structurally different provider (encryption + per-endpoint Version +
  plaintext-JSON responses) that validates the core abstraction holds. Includes the
  crypto core (PostData\_ encryption + CheckCode, asserted against the official
  vector), per-field validation, MSW tests covering success and error responses,
  and an env-gated live lifecycle test (verified end-to-end on the ezPay test env).

### Patch Changes

- Updated dependencies [9adf03f]
- Updated dependencies [aa2b551]
- Updated dependencies [3eb6b07]
- Updated dependencies [4fa0a22]
  - @paid-tw/einvoice@0.2.0

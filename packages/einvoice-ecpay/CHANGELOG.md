# @paid-tw/einvoice-ecpay

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

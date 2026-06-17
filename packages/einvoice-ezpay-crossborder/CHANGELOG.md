# @paid-tw/einvoice-ezpay-crossborder

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

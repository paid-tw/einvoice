---
"@paid-tw/einvoice-ezpay-crossborder": minor
---

New adapter: ezPay 境外電商 (cross-border e-commerce supplier). Implements the
unified `InvoiceProvider` over ezPay's CES API — a separate service from the
standard ezPay one, for foreign sellers issuing B2C e-invoices to Taiwan
consumers. Foreign-currency-native (`FOREIGN_CURRENCY` capability: set
`currency` + `exchangeRate`, amounts carry 2 decimals; the 20 currencies of
附件三 are accepted, others return INV10002). B2C e-mail-carrier only, so 統編 /
載具 / 捐贈 / 混合稅率 are rejected as `UNSUPPORTED`. Reuses the standard ezPay
wire layer (AES-256-CBC, CheckCode) via `@paid-tw/einvoice-ezpay`. Verified live
end-to-end on the ezPay cross-border test environment.

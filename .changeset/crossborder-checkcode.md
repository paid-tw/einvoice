---
"@paid-tw/einvoice-ezpay-crossborder": patch
---

Verify the response `CheckCode` on issued invoices (附件二). `issue` and
`triggerIssue` now recompute the SHA-256 CheckCode over MerchantID /
MerchantOrderNo / InvoiceTransNo / TotalAmt / RandomNum (reusing
`@paid-tw/einvoice-ezpay`'s `makeCheckCode`) and throw a `PROVIDER` error on a
mismatch, detecting a tampered or mis-routed reply. Controlled by the
`verifyCheckCode` config option (default on). Verified live: the CheckCode
matches real responses for TWD and every foreign currency (raw `TotalAmt`
format, e.g. `"21.0000000"`, included).

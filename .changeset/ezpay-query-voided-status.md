---
"@paid-tw/einvoice-ezpay": patch
---

Fix `query()` reporting a voided invoice as `ISSUED`. ezPay's `invoice_search`
returns `InvoiceStatus: "2"` for a voided invoice (`"1"` = issued), but the
adapter only treated `"0"` as voided, so `"2"` fell through to `ISSUED` (#13).
`"2"` now maps to `VOIDED`; `"0"` (待開立 in the merchant backend, not a void) no
longer does.

---
"@paid-tw/einvoice": minor
"@paid-tw/einvoice-amego": minor
---

Support cross-border foreign-currency invoices. `IssueInvoiceInput` gains optional
`currency` (ISO 4217) and `exchangeRate` fields (exchangeRate required when
currency ≠ TWD). The statutory amount fields remain TWD — a MIG invariant — so
these annotate the original transaction. The Amego adapter maps them to the
`Currency` / `ExchangeRate` fields; verified live.

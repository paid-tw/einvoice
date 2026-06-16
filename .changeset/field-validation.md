---
"@paid-tw/einvoice-amego": minor
---

Add per-field validation of the f0401 / f0401_custom payloads, run by default
before sending (opt out with `validatePayload: false`). Rules are verified
against the live sandbox and include ones Amego silently accepts — malformed
email, bad `Currency`, non-numeric `ExchangeRate`, `PrinterLang`, `BuyerName`
"0000" — plus the server-enforced ones (8-digit 統編, ≤256 品名, ≤6 單位, item
TaxType 1–3, zero-rated requires CustomsClearanceMark + ZeroTaxRateReason,
`DetailVat=0` only with 統編). Also fixes `invoice.issueCustom`, which must send
an ARRAY payload (and validates the merchant-supplied InvoiceNumber/InvoiceDate
YYYYMMDD/InvoiceTime hh:mm:ss), and maps the f0401_custom field error (code 99).

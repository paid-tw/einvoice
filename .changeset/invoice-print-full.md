---
"@paid-tw/einvoice-amego": minor
---

Expand `invoice.print` to the full spec (now an options object): look up by
`invoiceNumber` or `orderId` (type discriminator), and pass `printInvoiceType`
(1 正本 / 2 補印 / 3 單印明細) and `printInvoiceDetail` (0/1/2) — the previous
positional signature couldn't express these. Returns `data.base64_data` (XML for
printerType 1, ESC/POS for ≥2; a $0 invoice can't be printed). Map the print
param errors 31–36 → VALIDATION. Verified live (real base64 output + order
lookup).

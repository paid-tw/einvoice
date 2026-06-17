---
"@paid-tw/einvoice-amego": minor
---

Expand `invoice.file` to the full spec (now an options object, matching
`invoice.print`): look up by `invoiceNumber` or `orderId` (type discriminator),
and `downloadStyle` gains `5` (QRcode_A4) alongside 0/1/2/3. Returns
`data.file_url` (valid ~10 minutes). Verified live (order lookup + style 5).

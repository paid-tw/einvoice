---
"@paid-tw/einvoice-amego": minor
---

Expand `invoice.query` to look up by `invoiceNumber` or `orderId` (options
object, matching `invoice.print`/`file`; the unified `query()` already supported
both). The unified `query()` now also maps each item's `taxType` and `remark`.
The full nested response (`product_item[]`, `wait[]`, `allowance[]`,
`detail_vat`/`detail_amount_round`, carrier/npoban, etc.) is available on `raw`,
and its shape is covered by the captured fixture.

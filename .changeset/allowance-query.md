---
"@paid-tw/einvoice-amego": patch
---

Cover the `allowance_query` response shape (verified live): nested `data` with
`invoice_type`, `invoice_status`, `allowance_type`, buyer fields, 未稅
`total_amount` + `tax_amount`, `detail_vat`, `product_item[]`
(original_invoice_number/date + per-line tax), and the `wait[]` pending-schedule
array (e.g. a queued D0501 void). Request shape (`{ allowance_number }`) was
already correct.

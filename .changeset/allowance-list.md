---
"@paid-tw/einvoice-amego": patch
---

Cover the `allowance_list` response shape (verified live): pagination
(`page_total`/`page_now`/`data_total`) plus rows of `{ allowance_number,
invoice_type (D0401/D0501/B…), invoice_status, allowance_date, allowance_type,
buyer_*, tax_amount, total_amount (未稅), cancel_date, create_date, product_item[]
with original_invoice_number/date + per-line tax }`. The request shape
(date_select/date_start/date_end/limit/page) was already correct.

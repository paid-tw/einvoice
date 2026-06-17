---
"@paid-tw/einvoice-amego": patch
---

Cover the `invoice_list` response shape with a full real captured row:
pagination (`page_total`/`page_now`/`data_total`) plus rows with `invoice_type`
(C0401/A0401/…), `invoice_status`, dates, buyer fields, the full amount block,
carrier/npoban, `invoice_lottery`, `order_id`, etc. Request shape and the 31–36
param error codes were already correct/mapped.

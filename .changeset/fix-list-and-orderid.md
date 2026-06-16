---
"@paid-tw/einvoice-amego": patch
---

Fix `invoice.list`/`allowances.list`, which silently returned no data because the
date-range fields were wrong. Amego expects `date_select` + `date_start`/`date_end`
(numeric YYYYMMDD) + `limit` + `page` (not `start_date`/`end_date`/`page_size`).
Also support querying by `orderId` via `invoice_query`'s `type: "order"`. Both
verified against the live sandbox; the list path is now covered by the live test.

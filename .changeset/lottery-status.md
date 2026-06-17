---
"@paid-tw/einvoice-amego": patch
---

Cover the `lottery.status` (中獎發票) response shape: `data[]` of
`{ invoice_date (YYYYMMDD), invoice_number, type }` where `type` references the
lottery_type prize definitions. The `{ Year, Period }` request and the empty
envelope are verified live (the sandbox merchant has no winners); the winning-row
shape is from the official spec.

---
"@paid-tw/einvoice-amego": patch
---

Cover the `allowance_status` response and export an `UPLOAD_STATUS` code map
(1 待處理 … 99 完成) shared by invoice/allowance status & query. The request is a
PascalCase array `[{ AllowanceNumber }]` (note: `allowance_query` uses snake_case
— Amego is inconsistent); the response is `data[]` of `{ allowance_number, type
(D0401/D0501/NOT_FOUND/TYPE_ERROR), status, tax_amount, total_amount (未稅) }`. A
well-formed but unknown allowance returns `type: "NOT_FOUND"` with code 0 (not an
error) — verified live.

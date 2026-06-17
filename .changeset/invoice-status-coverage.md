---
"@paid-tw/einvoice-amego": patch
---

Cover the `invoice_status` response: a PascalCase array request `[{InvoiceNumber}]`
returns `data[]` of `{ invoice_number, type (C0401/C0501/C0701/NOT_FOUND/TYPE_ERROR),
status (UPLOAD_STATUS), total_amount }`. A batch can mix real invoices and unknown
ones (`type: "NOT_FOUND"`, code 0) — verified live. The 99 per-record error was
already mapped.

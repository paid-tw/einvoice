---
"@paid-tw/einvoice-amego": patch
---

Fix `invoice.print` and `allowances.print`, which sent PascalCase fields Amego
rejects. Verified live: `invoice_print` needs `{ type:"invoice", invoice_number,
printer_type, printer_lang? }` (PascalCase → "type 查詢類型不存在"), and
`allowance_print` needs snake_case `{ allowance_number, printer_type, printer_lang? }`
(PascalCase → "allowance_number 不可為空"). `printer_lang` is now optional (Amego
uses the model's default when omitted). Both return `data.base64_data` for
printer_type ≥ 2.

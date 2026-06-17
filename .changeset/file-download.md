---
"@paid-tw/einvoice-amego": patch
---

Cover the PDF file endpoints, verified live. `invoice.file` ({ type:"invoice",
invoice_number, download_style }) and `allowances.file` ({ allowance_number,
download_style }) both return `data.file_url` (a link valid ~10 minutes) — their
shapes were already correct (unlike the print endpoints). Tighten
`allowances.file` `download_style` to the spec's `0 | 1 | 3` (A4整張 / A4(地址+A5) / A5).

---
"@paid-tw/einvoice-amego": patch
---

Complete the `f0501` (作廢發票) error-code mapping: `3050111` (CancelInvoiceNumber
錯誤) and `3050124` (發票類型錯誤) → VALIDATION; `3050126` (超過修改期限) and
`3050131` (等待排程) → CONFLICT (alongside the already-mapped 3050112/3050121-123/
3050125/3050141). The `void()` array shape was already correct. Verified live.

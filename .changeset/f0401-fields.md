---
"@paid-tw/einvoice-amego": patch
---

Reconcile f0401 validation with the full auto-numbering spec (verified live):
allow `PrinterLang` 3 (UTF-8) and any `PrinterType` model code (previously
limited to 1/2, which wrongly rejected valid values); add `PrintDetail`,
`TrackApiCode`, `BrandName`, and `TaxAdjustment` with its precondition rule
(統編 + DetailVat=0 + SalesAmount ending in 10/30/50/70/90 — Amego silently
accepts violations, so we reject them locally).

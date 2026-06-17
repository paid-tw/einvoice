---
"@paid-tw/einvoice-amego": patch
---

Audit the full f0401 (開立發票) error-code family and refine two mappings:
`3040191` (無法取得下一張發票) → NUMBER_EXHAUSTED (was VALIDATION) and `3040192`
(取得發票列印格式錯誤) → PROVIDER (a system error, not caller input). A test now
locks in that every documented f0401 code (3040111–3040193) is categorized. All
33 f0401 request fields were already present in the validation schema.

---
"@paid-tw/einvoice-amego": patch
---

Fix the g0501 (作廢折讓) error-code mapping — 6 codes were falling through to
PROVIDER (the 4040 range rule doesn't cover 4050xxx). `4050121`
(CancelAllowanceNumber 錯誤) and `4050133` (折讓類型錯誤) → VALIDATION; `4050131`
(折讓開立中), `4050132` (已存在作廢折讓), `4050135` (超過修改期限), `4050141` (等待排程)
→ CONFLICT (alongside 4050112 → VALIDATION and 4050134 → NOT_FOUND). g0401 (4040xxx)
was already complete. A test locks in the full g0501 family (incl. string codes).

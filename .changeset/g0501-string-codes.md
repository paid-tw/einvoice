---
"@paid-tw/einvoice-amego": patch
---

Handle string error codes. `g0501` (作廢折讓) returns `code` as a STRING (e.g.
`"4050112"`/`"4050134"`), unlike `f0501` which returns a number. The success
check and `mapAmegoErrorCode` now coerce the code, so these are detected and
mapped correctly: `4050112` (data 應為陣列) → VALIDATION, `4050134` (折讓單不存在)
→ NOT_FOUND. The `voidAllowance` request shape (array `[{CancelAllowanceNumber}]`)
was already correct. Verified live.

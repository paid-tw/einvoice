---
"@paid-tw/einvoice-amego": minor
---

Validate the 統一編號 checksum (the post-2023 "divisible by 5" algorithm), which
Amego enforces server-side (bad checksums → 3040122 on issue, 99 on ban_query).
`BuyerIdentifier` now requires a valid checksum (not just 8 digits), `banQuery`
rejects bad ids locally before the call, and the checksum helper is exported as
`isValidTaxId`. Verified live (28080623 / 10458575 valid, 28080624 rejected; an
empty `name` means "no company found", not an error).

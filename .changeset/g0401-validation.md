---
"@paid-tw/einvoice-amego": minor
---

Add full per-field validation for `g0401` (開立折讓), closing the last gap (f0401
already had it). `amegoAllowancePayloadSchema` validates AllowanceNumber (≤16),
AllowanceDate/OriginalInvoiceDate (YYYYMMDD), AllowanceType (1/2), BuyerIdentifier
(統編 checksum), BuyerName, and each ProductItem (OriginalInvoiceNumber,
OriginalDescription ≤256, ≤7-decimal amounts, integer Tax, TaxType 1/2/3) —
amounts may be strings or numbers, as the official example mixes both. The
`allowance()` method validates before sending (opt out with validatePayload:false)
and now defaults BuyerName to 消費者. Maps the `4040xxx` error family (field →
VALIDATION, 原發票不存在 4040156 → NOT_FOUND, state conflicts 4040152-154/4040161-163
→ CONFLICT), all returned as string codes. Verified live.

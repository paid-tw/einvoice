---
"@paid-tw/einvoice-amego": patch
---

Fix `lottery.type` (獎項定義), previously failing with code 16. No-data endpoints
must send an EMPTY `data` string (signed over ""), not `"{}"` — Amego strips the
data and verifies the signature against an empty string. `amegoRequest` now sends
empty data when none is provided, and `lottery.type()` returns the prize-type
list. Verified live.

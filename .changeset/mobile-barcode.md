---
"@paid-tw/einvoice": minor
"@paid-tw/einvoice-amego": patch
---

Add `isValidMobileBarcode` to core — a standalone 手機條碼 (載具 3J0002) format
check ("/" + 7 of [0-9A-Z.+-]), now reused by `carrierSchema`. The Amego
`barcodeQuery` validates the format locally first (fail-fast) and maps Amego's
codes per the live-verified behaviour: 9000111/9000112 (empty/format) →
VALIDATION, 9000113 (不存在) → NOT_FOUND.

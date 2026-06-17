---
"@paid-tw/einvoice-amego": patch
---

Fix `time()` (伺服器時間): `/json/time` is a plain GET with no signing and its
response has no `code` envelope, so routing it through the signed POST path
threw against the real API (it only passed against mocks). It now does a GET via
`fetchServerTime` and returns the full breakdown ({ timestamp, text, year, month,
day, hour, minute, second }). The opt-in clock sync uses the same GET. Verified live.

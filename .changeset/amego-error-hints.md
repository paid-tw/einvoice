---
"@paid-tw/einvoice-amego": minor
---

Add `amegoErrorHint()` — translate Amego account/setup-level raw error codes
(IP allowlist `14`, API access not enabled `22`, bad App Key `16`, account
disabled/suspended `13`/`19`, UBN mismatch `12`, transient `10`/`15`/`18`/`21`,
number tracks exhausted `3040111`/`3040191`) into actionable zh-TW guidance for
direct merchant display. Accepts a raw code (`"14"` / `14`) or an
`InvoiceError` (guarded via `isInvoiceError`, amego-only); returns `undefined`
for everything else so callers fall back to `error.message`.

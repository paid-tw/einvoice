---
"@paid-tw/einvoice-ecpay": patch
---

Classify ECPay transport-layer (`TransCode`) errors instead of lumping every
`TransCode ≠ 1` into `PROVIDER`. A wrong HashKey/HashIV never reaches the
business layer — the envelope returns `TransCode 110` ("The parameter [Data]
decrypt fail.", HTTP 500, live-verified on stage 2026-08-15) — so a credentials
mistake used to surface as a provider outage. Now:

- `110` decrypt fail → `AUTH` / `credentials_invalid`
- `115` B2C/B2B 功能尚未開通 (unknown or un-enrolled merchant) → `AUTH` / `not_enrolled`
- `104` timestamp over 10 minutes → `AUTH` / `stale_timestamp`
- any other `TransCode ≠ 1` → `PROVIDER` (unchanged)

Adds `mapEcpayTransportError` to the public exports, cross-language
`fixtures/ecpay/transport-errors.json`, live regressions, and errors.json cases
for the live 重覆-variant wordings (5070357 / 5070453). Also documents that
`RqHeader.Revision` is live-verified optional (the SDK omits it, per current
behaviour).

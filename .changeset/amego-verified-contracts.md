---
"@paid-tw/einvoice-amego": minor
---

Correct every Amego endpoint against the live-verified API contract: per-endpoint
field casing (PascalCase vs snake_case), array payloads (`f0501`/`g0401`/`g0501`/
`*_status`/`ban_query`), the `type` discriminator and nested `data` parsing for
queries, B2B/B2C/mixed (TaxType 9) amount handling, tax-exclusive allowances with
per-line tax, and the full set of issue fields (carrier id1/id2, member carrier
`amego`, `DetailVat`, telephone, etc.). Adds opt-in clock sync (`syncTime`) and
network retry (`retry`).

---
"@paid-tw/einvoice": minor
"@paid-tw/einvoice-amego": minor
---

Add 統一編號 (UBN — Unified Business Number) validation as a standalone, provider-
agnostic primitive in core: `isValidUbn(input, { legacy? })` implements the
財政部 checksum (post-2023 ÷5, plus the legacy ÷10 option and the 7th-digit special
case). The unified model now uses the official term: `Buyer.taxId` → `Buyer.ubn`
and `taxIdSchema` → `ubnSchema` (which now verifies the checksum, not just 8
digits). 統一編號 is distinct from a 稅籍編號 (tax registration number); the
misleading `taxId` naming is gone.

The Amego adapter consumes the core validator (its `BuyerIdentifier` and
`banQuery` both checksum-validate, matching Amego's server-side enforcement —
3040122 / 99), and `AmegoConfig.sellerTaxId` is renamed to `sellerUbn`. Amego's
`ban` wire field is kept only at the API boundary. All verified live.

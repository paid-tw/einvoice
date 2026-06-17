---
"@paid-tw/einvoice-amego": patch
---

Reconcile `mapAmegoErrorCode` against the complete official error table
(info_detail?mid=71 — 141 codes). Map the print/file/query operation-state codes
51 (超過查詢期限), 52 (等待異動排程), 53 (載具/類型不可), 55 (不符合條件), 56 (0元發票)
→ CONFLICT (were PROVIDER). Every documented code now resolves intentionally;
only genuine system/transient errors (10/18/21/72/3040192) remain PROVIDER.

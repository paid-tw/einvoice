---
"@paid-tw/einvoice-amego": patch
---

Audit f0401_custom and g0401 for full field + error-code coverage (no gaps
found). f0401_custom has all 8 self-numbering fields on top of the f0401 base;
g0401 has all 11 top-level + 9 item fields. Tests now lock in the full g0401
`4040xxx` family (VALIDATION / CONFLICT 4040152-154,4040161-163 / NOT_FOUND
4040156, incl. string-code coercion) and the f0401_custom code 99.

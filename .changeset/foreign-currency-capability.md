---
"@paid-tw/einvoice": minor
"@paid-tw/einvoice-amego": minor
"@paid-tw/einvoice-ecpay": minor
"@paid-tw/einvoice-ezpay": minor
---

Add a `FOREIGN_CURRENCY` capability for the `currency` + `exchangeRate`
annotation. Amego declares it and maps the fields; ECPay and ezPay don't
support a foreign-currency field, so they now reject a non-TWD `currency` with
an `UNSUPPORTED` error instead of silently dropping it. The statutory amounts
are still integer TWD. The top-level README gains a capability matrix.

---
"@paid-tw/einvoice-ezpay": patch
---

Classify an exhausted 字軌 as `NUMBER_EXHAUSTED` instead of `VALIDATION` (#15).
When a store has no invoice numbers left for the current period, ezPay answers
with the generic data-error code `LIB10001` and the message
`已無任何本期(N)字軌資料可使用，請確認。`; the adapter looked at the code alone
and reported a recoverable condition as a permanent input error.

- `mapEzpayError(code, message?)` takes the response message as an optional
  second argument and uses it to tell this case apart. Other `LIB10001`
  messages stay `VALIDATION`; calling it with the code alone behaves as before.
- `ezpayErrorHint(error)` returns an "add 字軌 in the ezPay backend" hint for
  such an error. The raw-code form `ezpayErrorHint("LIB10001")` still returns
  `undefined`, since the code alone does not identify the case.

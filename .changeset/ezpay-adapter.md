---
"@paid-tw/einvoice-ezpay": minor
---

New adapter: ezPay (簡單行動支付 / 藍新). Implements the unified `InvoiceProvider`
(issue/void/allowance/voidAllowance/query) over ezPay's AES-256-CBC-encrypted API
— a second, structurally different provider (encryption + per-endpoint Version +
plaintext-JSON responses) that validates the core abstraction holds. Includes the
crypto core (PostData_ encryption + CheckCode, asserted against the official
vector), per-field validation, MSW tests covering success and error responses,
and an env-gated live lifecycle test (verified end-to-end on the ezPay test env).

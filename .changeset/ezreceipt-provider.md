---
"@paid-tw/einvoice-ezreceipt": minor
---

New adapter: ezReceipt 易發票 (COIMOTION API). Implements the unified
`InvoiceProvider` over an order-centric REST + JSON API with token
authentication — distinct from the encrypted form-post providers. The client
logs in lazily (`sha1(sha1(accName)+password)`), caches the access token, and
re-logs in transparently on `-3 Invalid token`. `issue` maps to the all-in-one
`eInvoice/invoice/issue` (order created implicitly from `prodList`); void /
query / allowance / voidAllowance key off the internal invID/awID (resolved from
the invoice number, or via `providerOptions`). Supports B2B (issueTo 統編), mixed
per-item tax, and member / 手機條碼 / donation carriers. Verified live end-to-end
on the test environment; 100% line coverage with MSW + an env-gated live suite.

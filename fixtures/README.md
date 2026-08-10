# Cross-language wire fixtures

Language-neutral test fixtures that pin each provider's **wire contract**: given
a unified SDK input, what the provider actually receives on the wire. Every SDK
that implements a provider — the TypeScript `@paid-tw/einvoice` adapters and the
Ruby port — runs its own tests against **these same fixtures**. A change on
either side that drifts the wire mapping turns a fixture assertion red, so the
two SDKs stay twins by construction rather than by discipline.

These fixtures are the source of truth for the wire mapping. They are not a
replacement for each SDK's own unit tests (error handling, result parsing,
edge cases) — they cover the one thing both SDKs must agree on exactly: the
bytes that reach the provider.

## Layout

```
fixtures/
  <provider>/
    issue.json           one file per operation family
    void-allowance.json
    query.json
    errors.json          provider error code → normalized error
```

## Case schema (operation fixtures)

Each file is `{ "version", "provider", "cases": [...] }`. A case:

```jsonc
{
  "name": "issue: B2C, member carrier",
  "operation": "issue",              // issue | void | allowance | voidAllowance | query
  "input": { ... },                  // unified SDK input, verbatim public API shape
  "expect": {
    "endpoint": "/B2CInvoice/Issue", // provider path the request must POST to
    "data": {                        // SUBSET match against the decrypted wire payload
      "RelateNumber": "ORDER_1",
      "TaxType": "1"
    },
    "dataAbsent": ["CustomerIdentifier"], // keys that must NOT be present (optional)
    "dataExact": false               // when true, `data` is a FULL match, not a subset
  }
}
```

### How an SDK consumes a case

1. Construct the provider with the fixed test credentials below.
2. Call `provider.<operation>(input)` with a stubbed HTTP layer that captures
   the outgoing request.
3. Decrypt/decode the captured request body to the wire `data` object (for ECPay:
   Base64 → AES-128-CBC → PHP-urldecode → JSON).
4. Assert the request path equals `expect.endpoint`.
5. Assert `expect.data` is a subset of the captured `data` (deep partial match),
   every key in `expect.dataAbsent` is missing, and — if `expect.dataExact` —
   that `data` has no keys beyond those in `expect.data`.

### Dynamic fields

Fixtures are deterministic: cases that would otherwise depend on "today" or a
random value pass the value explicitly in `input` (e.g. `invoiceDate` via
`providerOptions`) so the expected wire value is fixed. The request envelope's
`Timestamp` and any transport-level nonce are outside `expect.data` and are not
asserted. Assertions are partial by default precisely so that additive,
non-load-bearing wire fields don't break the contract.

## Error schema (`errors.json`)

`{ "version", "provider", "cases": [...] }`, each mapping a provider business
error to the normalized `InvoiceError`:

```jsonc
{
  "name": "void blocked by active allowance",
  "rtnCode": "5070450",
  "rtnMsg": "B2C作廢發票 該發票已被折讓過，無法直接作廢發票",
  "expect": { "code": "CONFLICT", "rawCode": "5070450" }
}
```

`code` is the stable `InvoiceErrorCode` both SDKs normalize onto; `rawCode` is
the provider code preserved on the error.

## ECPay test vectors

Fixed values used to build/verify the ECPay envelope (16-byte AES-128 key/IV):

| | |
|---|---|
| MerchantID | `2000132` |
| HashKey | `ejCk326UnaZWKisg` |
| HashIV | `q9jcZX8Ib9LM8wYk` |

These are ECPay's published B2C 2.0 sandbox values; the fixtures assert only the
plaintext wire payload, so the exact key/IV matter only for round-tripping the
`Data` envelope, not for the assertions themselves.

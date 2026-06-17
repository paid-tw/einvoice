# @paid-tw/einvoice-ecpay

[ECPay 綠界](https://www.ecpay.com.tw/) adapter for
[`@paid-tw/einvoice`](https://www.npmjs.com/package/@paid-tw/einvoice). Implements
the `InvoiceProvider` interface over the ECPay **B2C 電子發票 2.0** API (the AES
JSON API, not the legacy CheckMacValue one).

```bash
pnpm add @paid-tw/einvoice @paid-tw/einvoice-ecpay
```

```ts
import { createEcpayProvider } from "@paid-tw/einvoice-ecpay";

const invoices = createEcpayProvider({
  merchantId: process.env.ECPAY_MERCHANT_ID!,
  hashKey: process.env.ECPAY_HASH_KEY!, // 16 chars
  hashIV: process.env.ECPAY_HASH_IV!, // 16 chars
  mode: "TEST", // stage host; "PRODUCTION" → live host
});

await invoices.issue({ /* IssueInvoiceInput */ });
```

### Try it without an account

ECPay publishes shared **sandbox** credentials. Use the exported `ECPAY_SANDBOX`
to issue against the stage merchant straight away:

```ts
import { createEcpayProvider, ECPAY_SANDBOX } from "@paid-tw/einvoice-ecpay";

const invoices = createEcpayProvider({ ...ECPAY_SANDBOX, mode: "TEST" }); // 特店 2000132 — never use in production
```

## How it works (verified live on stage)

| Concern | Detail |
| --- | --- |
| Auth | The `Data` field = `JSON → PHP urlencode → AES-128-CBC (PKCS7) → Base64` (decoded in reverse). PHP url(en/de)code semantics: a space is `+`, not `%20`. |
| Envelope | `{ MerchantID, RqHeader: { Timestamp }, Data }`; the reply wraps `{ TransCode, TransMsg, Data }`. `TransCode === 1` = transport OK. |
| Result | Decrypt `Data` → `{ RtnCode, RtnMsg, … }`. `RtnCode === 1` = success; otherwise an error (the codes span inconsistent ranges, so the mapping keys off `RtnMsg`). |
| Items | A JSON **array** of `{ ItemSeq, ItemName, ItemCount, ItemWord, ItemPrice, ItemTaxType, ItemAmount }` — not pipe-joined, and there is no `CheckMacValue`. |
| Carrier | `CarrierType`: 空=紙本 / `1`=綠界 / `2`=自然人憑證 / `3`=手機條碼. A carrier/donation invoice must not print. |

## Two-phase issue (延遲 / 觸發開立)

```ts
const { relateNumber } = await invoices.issuePending({ /* IssueInvoiceInput */ }); // DelayIssue, held
const issued = await invoices.triggerIssue({ relateNumber }); // TriggerIssue → real invoice number
```

## Carrier validation (手機條碼 / 愛心碼)

```ts
await invoices.validateMobileBarcode("/ABC1234"); // → boolean (CheckBarcode)
await invoices.validateLoveCode("168001"); // → boolean (CheckLoveCode)
```

Declared as the `CARRIER_VALIDATION` capability. (ECPay's B2C API has no working
統編 validation endpoint, so there is no `validateBan`.)

## Config

| Option | Required | Description |
| --- | --- | --- |
| `merchantId` | ✅ | 特店編號 |
| `hashKey` | ✅ | 16-char AES HashKey (server-side only) |
| `hashIV` | ✅ | 16-char AES HashIV (server-side only) |
| `mode` | | `"TEST"` (default, stage) or `"PRODUCTION"` |
| `validatePayload` | | validate the issue payload locally (default `true`) |

## 字軌 / numbering

```ts
// 查詢財政部配號結果 — the invoice-number ranges allocated for a 民國年.
const ranges = await invoices.getGovInvoiceWordSetting("115");
// → [{ term, invType, header, start, end, count }, …]; throws NOT_FOUND if unallocated.
```

## Notes

- `void` and `allowance` need the invoice's date — pass it via
  `providerOptions: { invoiceDate: "YYYY-MM-DD" }` (the issue result carries it).
  It defaults to today (Asia/Taipei) when omitted.
- `allowance` uses 協議折讓 (`AllowanceByCollegiate`): the buyer confirms it via a
  notification (so it requires a `providerOptions.notifyMail`), and it becomes
  voidable only after confirmation.
- Live tests run with `ECPAY_LIVE=1` (defaulting to `ECPAY_SANDBOX`).

## License

MIT

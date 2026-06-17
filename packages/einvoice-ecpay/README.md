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

## Delayed issue (延遲 / 預約 / 觸發開立)

```ts
// TRIGGER (待觸發, default): issues only when you trigger it.
const { relateNumber } = await invoices.issuePending({ /* IssueInvoiceInput */ });
const res = await invoices.triggerIssue({ relateNumber });
// res.issued: true (DelayDay=0 → 4000004, res.invoiceNumber set) |
//             false (DelayDay>0 → 4000003, auto-issues later — query by relateNumber after)

// SCHEDULE (預約): auto-issues after N days (1–15), no trigger needed.
await invoices.issuePending({ /* … */ }, { mode: "SCHEDULE", delayDay: 3 });

// Edit a still-pending delayed invoice (keyed by its Tsr = orderId).
await invoices.editDelayIssue({ /* updated IssueInvoiceInput */ });
```

## Carrier validation (手機條碼 / 愛心碼)

```ts
await invoices.validateMobileBarcode("/ABC1234"); // → boolean (CheckBarcode)
await invoices.validateLoveCode("168001"); // → boolean (CheckLoveCode)
await invoices.lookupLoveCodeOrganName("168001"); // → "財團法人…" | undefined (the charity name)
```

Declared as the `CARRIER_VALIDATION` capability.

### 統一編號 validation

```ts
await invoices.lookupCompanyName("97025978"); // → "綠界科技股份有限公司" | undefined
await invoices.validateBan("97025978"); // → boolean
```

⚠️ A 統編 with no public data (政府/醫療/福委會, etc.) resolves to
`undefined`/`false` — that does **not** mean it is invalid, so keep issuing.
Only a bad checksum/format throws `VALIDATION` (the case where you should stop).

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

// 查詢字軌 — this merchant's own 字軌 (TrackID, range, used number, status).
const tracks = await invoices.getInvoiceWordSetting({ invoiceYear: "115", useStatus: "IN_USE" });
// → [{ trackId, year, term, invType, header, start, end, currentNumber, status }, …]

// 設定字軌號碼狀態 — a newly added 字軌 is inactive; enable it before issuing.
await invoices.setInvoiceWordStatus(trackId, "ENABLE"); // or "PAUSE" / "DISABLE"
```

## Notes

- Zero-rated invoices (`taxType: "ZERO_RATED"` or mixed) require a customs mark:
  pass `providerOptions: { clearanceMark: "1" | "2" }` (1=非經海關, 2=經海關). The
  validation rules are checked against live API behaviour, not just the docs (e.g.
  ECPay's `ZeroTaxRateReason`/`SpecialTaxType` "requirements" aren't enforced by
  the API, and carrier+donation / B2B+carrier are accepted).
- `void` and `allowance` need the invoice's date — pass it via
  `providerOptions: { invoiceDate: "YYYY-MM-DD" }` (the issue result carries it).
  It defaults to today (Asia/Taipei) when omitted.
- `allowance` uses 協議折讓 (`AllowanceByCollegiate`): the buyer confirms it via a
  notification (so it requires a `providerOptions.notifyMail`), and it becomes
  voidable only after confirmation.
- Live tests run with `ECPAY_LIVE=1` (defaulting to `ECPAY_SANDBOX`).

## License

MIT

# @paid-tw/einvoice-ecpay

[![npm version](https://img.shields.io/npm/v/@paid-tw/einvoice-ecpay.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ecpay)
[![npm downloads](https://img.shields.io/npm/dm/@paid-tw/einvoice-ecpay.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ecpay)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice-ecpay.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/npm/l/@paid-tw/einvoice-ecpay.svg)](https://github.com/paid-tw/einvoice/blob/main/LICENSE)

**English** ｜ [繁體中文](./README.md)

[ECPay (綠界)](https://www.ecpay.com.tw/) adapter for
[`@paid-tw/einvoice`](https://www.npmjs.com/package/@paid-tw/einvoice). Implements
the `InvoiceProvider` interface over the ECPay **B2C e-invoice (電子發票) 2.0** API (the AES
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

const invoices = createEcpayProvider({ ...ECPAY_SANDBOX, mode: "TEST" }); // merchant (特店) 2000132 — never use in production
```

## How it works (verified live on stage)

| Concern | Detail |
| --- | --- |
| Auth | The `Data` field = `JSON → PHP urlencode → AES-128-CBC (PKCS7) → Base64` (decoded in reverse). PHP url(en/de)code semantics: a space is `+`, not `%20`. |
| Envelope | `{ MerchantID, RqHeader: { Timestamp }, Data }`; the reply wraps `{ TransCode, TransMsg, Data }`. `TransCode === 1` = transport OK. |
| Result | Decrypt `Data` → `{ RtnCode, RtnMsg, … }`. `RtnCode === 1` = success; otherwise an error (the codes span inconsistent ranges, so the mapping keys off `RtnMsg`). |
| Items | A JSON **array** of `{ ItemSeq, ItemName, ItemCount, ItemWord, ItemPrice, ItemTaxType, ItemAmount }` — not pipe-joined, and there is no `CheckMacValue`. |
| Carrier | `CarrierType`: empty=paper (紙本) / `1`=ECPay (綠界) / `2`=citizen certificate (自然人憑證) / `3`=mobile barcode (手機條碼). A carrier/donation invoice must not print. |

## Delayed issue (delay 延遲 / schedule 預約 / trigger 觸發開立)

```ts
// TRIGGER (pending-trigger, 待觸發 — default): issues only when you trigger it.
const { relateNumber } = await invoices.issuePending({ /* IssueInvoiceInput */ });
const res = await invoices.triggerIssue({ relateNumber });
// res.issued: true (DelayDay=0 → 4000004, res.invoiceNumber set) |
//             false (DelayDay>0 → 4000003, auto-issues later — query by relateNumber after)

// SCHEDULE (預約): auto-issues after N days (1–15), no trigger needed.
await invoices.issuePending({ /* … */ }, { mode: "SCHEDULE", delayDay: 3 });

// Edit a still-pending delayed invoice (keyed by its Tsr = orderId).
await invoices.editDelayIssue({ /* updated IssueInvoiceInput */ });

// Cancel a still-pending delayed invoice (before it issues/triggers).
await invoices.cancelDelayIssue(relateNumber);
```

## Carrier validation (mobile barcode 手機條碼 / charity code 愛心碼)

```ts
await invoices.validateMobileBarcode("/ABC1234"); // → boolean (CheckBarcode)
await invoices.validateLoveCode("168001"); // → boolean (CheckLoveCode)
await invoices.lookupLoveCodeOrganName("168001"); // → "財團法人…" | undefined (the charity name)
```

Declared as the `CARRIER_VALIDATION` capability.

### Tax ID (統一編號) validation

```ts
await invoices.lookupCompanyName("97025978"); // → "綠界科技股份有限公司" (the company name) | undefined
await invoices.validateBan("97025978"); // → boolean
```

⚠️ A tax ID (統編) with no public data (government 政府 / medical 醫療 / welfare committee 福委會, etc.) resolves to
`undefined`/`false` — that does **not** mean it is invalid, so keep issuing.
Only a bad checksum/format throws `VALIDATION` (the case where you should stop).

## Config

| Option | Required | Description |
| --- | --- | --- |
| `merchantId` | ✅ | merchant id (特店編號) |
| `hashKey` | ✅ | 16-char AES HashKey (server-side only) |
| `hashIV` | ✅ | 16-char AES HashIV (server-side only) |
| `mode` | | `"TEST"` (default, stage) or `"PRODUCTION"` |
| `validatePayload` | | validate the issue payload locally (default `true`) |

## Number tracks (字軌) / numbering

```ts
// Query the MOF number allocation (查詢財政部配號結果) — invoice-number ranges allocated for a ROC year (民國年).
const ranges = await invoices.getGovInvoiceWordSetting("115");
// → [{ term, invType, header, start, end, count }, …]; throws NOT_FOUND if unallocated.

// Query tracks (查詢字軌) — this merchant's own tracks (字軌) (TrackID, range, used number, status).
const tracks = await invoices.getInvoiceWordSetting({ invoiceYear: "115", useStatus: "IN_USE" });
// → [{ trackId, year, term, invType, header, start, end, currentNumber, status }, …]

// Set track status (設定字軌號碼狀態) — a newly added track (字軌) is inactive; enable it before issuing.
await invoices.setInvoiceWordStatus(trackId, "ENABLE"); // or "PAUSE" / "DISABLE"
```

## Printing (發票列印)

```ts
// Get a print URL (valid for 1 hour). Defaults to single-sided, today's date.
const url = await invoices.getPrintUrl({
  invoiceNumber: "JU11084038",
  invoiceDate: "2026-06-17", // optional; defaults to today (Asia/Taipei)
  style: "DOUBLE",   // SINGLE | DOUBLE | THERMAL | B2B_A4 | B2B_A5
  showDetail: true,  // B2B / tax ID (統編) invoices always show detail
  reprint: true,     // stamp as a reprint (補印) (ignored for B2B styles)
});
```

Only paper-printable invoices work: a carrier/donation invoice (`Print=0`) or an
unknown number returns "no data" (查無資料) → `NOT_FOUND`. The `B2B_A4` / `B2B_A5`
styles require an invoice carrying a tax ID (統編).

## Notifications (發送發票通知)

```ts
// Email / SMS an invoice, void, allowance or award notification to the buyer
// and/or merchant. ECPay's stage env validates the request but does not deliver.
await invoices.sendNotification({
  invoiceNumber: "JU11084029",
  tag: "ISSUE",        // ISSUE | VOID | ALLOWANCE | ALLOWANCE_VOID | AWARD | ONLINE_ALLOWANCE
  method: "EMAIL",     // EMAIL | SMS | BOTH
  recipient: "CUSTOMER", // CUSTOMER | MERCHANT | BOTH
  email: "buyer@example.com", // and/or phone — at least one is required
});
```

Allowance tags (`ALLOWANCE` / `ALLOWANCE_VOID` / `ONLINE_ALLOWANCE`) need an
`allowanceNumber`; `ONLINE_ALLOWANCE` must use `EMAIL` + `CUSTOMER`. Notifying a
non-winning invoice with `tag: "AWARD"` throws `NOT_FOUND` ("no award data", 查無發票中獎資料).

## Void & reissue (註銷重開)

```ts
// Atomically void an invoice and reissue it. ECPay keeps the original
// invoice number / custom number / issue time (發票號碼 / 自訂編號 / 開立時間) —
// only the random code changes — so the reissue must carry the original orderId
// and issue time. Do it before the 13th of the month after the invoice's period.
const res = await invoices.voidWithReissue({
  invoiceNumber: orig.invoiceNumber,
  voidReason: "Customer requested reissue",      // ≤ 20 chars
  invoiceDate: orig.invoiceDate,  // the original issue time (Date or yyyy-MM-dd HH:mm:ss)
  reissue: { ...issueInput, orderId: orig.orderId }, // same shape as issue()
});
res.invoiceNumber === orig.invoiceNumber; // true — reuses the original number
```

A still-pending invoice (not yet uploaded to the MOF) can't be re-voided yet;
an unknown number returns "no invoice data" (查無發票資料) → `NOT_FOUND`.

## Notes

- Zero-rated invoices (`taxType: "ZERO_RATED"` or mixed) require a customs mark:
  pass `providerOptions: { clearanceMark: "1" | "2" }` (1=not via customs 非經海關,
  2=via customs 經海關). The
  validation rules are checked against live API behaviour, not just the docs (e.g.
  ECPay's `ZeroTaxRateReason`/`SpecialTaxType` "requirements" aren't enforced by
  the API, and carrier+donation / B2B+carrier are accepted).
- `void` and `allowance` need the invoice's date — pass it via
  `providerOptions: { invoiceDate: "YYYY-MM-DD" }` (the issue result carries it).
  It defaults to today (Asia/Taipei) when omitted.
- `allowance` uses the standard paper allowance (一般開立折讓; `/B2CInvoice/Allowance`,
  紙本): it returns a real allowance number (折讓單號) immediately and is voidable
  right away (ECPay 綠界 uploads to the MOF next day). It defaults to no buyer
  notification; pass
  `providerOptions: { allowanceNotify: "E"|"S"|"A", notifyMail, notifyPhone, reason }`
  to notify.
- `allowanceOnline(input, { notifyMail, returnUrl?, … })` is the online allowance
  (線上折讓, AllowanceByCollegiate): ECPay emails the buyer a confirmation link (72h
  `expiresAt`); the allowance is issued only when they click it. Cancel a
  still-pending one with `cancelAllowanceOnline({ invoiceNumber, allowanceNumber })`;
  void a confirmed/paper one with `voidAllowance`.
- Live tests run with `ECPAY_LIVE=1` (defaulting to `ECPAY_SANDBOX`).

## License

MIT

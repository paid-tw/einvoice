# @paid-tw/einvoice-ezpay

[ezPay](https://www.ezpay.com.tw/) (簡單行動支付 / 藍新) adapter for
[`@paid-tw/einvoice`](https://www.npmjs.com/package/@paid-tw/einvoice). Implements
the unified `InvoiceProvider` interface over the ezPay e-invoice API.

```bash
pnpm add @paid-tw/einvoice @paid-tw/einvoice-ezpay
```

```ts
import { createEzpayProvider } from "@paid-tw/einvoice-ezpay";

const invoices = createEzpayProvider({
  merchantId: process.env.EZPAY_MERCHANT_ID!,
  hashKey: process.env.EZPAY_HASH_KEY!, // 32 chars
  hashIV: process.env.EZPAY_HASH_IV!, // 16 chars
  mode: "TEST", // cinv host; "PRODUCTION" → inv host
});

const result = await invoices.issue({ /* IssueInvoiceInput */ });
```

Because it implements the same `InvoiceProvider` interface as the Amego adapter,
switching providers is a one-line config change — your business logic doesn't
move.

## How it differs from Amego

| Concern | ezPay |
| --- | --- |
| Auth | AES-256-CBC encrypted `PostData_` (HashKey/HashIV), not MD5 signing |
| Padding | PKCS7 to a **32-byte** multiple (ezPay convention), lowercase hex |
| Host | test `cinv.ezpay.com.tw` vs prod `inv.ezpay.com.tw` (selected by `mode`) |
| Response | plaintext JSON `{ Status, Message, Result }` (Result is a JSON string) |
| Items | pipe-`\|`-joined `ItemName`/`ItemCount`/`ItemUnit`/`ItemPrice`/`ItemAmt` |
| Verify | response `CheckCode` = SHA256 over 5 sorted fields wrapped by HashIV/HashKey |

## Config

| Option | Required | Description |
| --- | --- | --- |
| `merchantId` | ✅ | 商店代號 (`MerchantID_`) |
| `hashKey` | ✅ | 32-char AES HashKey (server-side only) |
| `hashIV` | ✅ | 16-char AES HashIV (server-side only) |
| `mode` | | `"TEST"` (default, cinv) or `"PRODUCTION"` (inv) |
| `respondType` | | `"JSON"` (default) or `"String"` |
| `validatePayload` | | validate the issue payload locally (default `true`) |

## Notes

- ezPay query needs an extra key beyond the unified `invoiceNumber`/`orderId`:
  pass `providerOptions: { randomNum }` (SearchType 0) or `{ totalAmt }`
  (SearchType 1).
- A live lifecycle test (issue → query → void) runs against the test environment
  with `EZPAY_LIVE=1` and the credentials in env.

## License

MIT

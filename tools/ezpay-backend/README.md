# ezpay-backend

A small, runtime-agnostic HTTP client + reverse-engineering reference for the
**ezPay 電子發票 加值中心** (value-added center) backend — for bulk work the
official REST API doesn't expose, chiefly **monthly invoice-detail CSV export**.

This is an internal repo tool, not a published package. Full path/param/format
reference: **[EZPAY-BACKEND.md](./EZPAY-BACKEND.md)**.

## Credentials

The client takes `ubn` / `account` / `password` directly, so it stays runtime- and
secret-store-agnostic. The Bun helpers here read them from 1Password via the `op`
CLI — set the item name in the env (nothing account-specific is baked into source):

```bash
export EZPAY_OP_ITEM="<your prod 1Password item>"        # fields: ubn, username, password
export EZPAY_CINV_OP_ITEM="<your cinv/test 1Password item>"  # fields: LoginUBN, username, password
```

Or pass `EZPAY_UBN` / `EZPAY_ACCOUNT` / `EZPAY_PASSWORD` in the env. Fetched creds
are cached to `secrets*.json` (gitignored) to avoid repeated biometric prompts.

## Use it — bulk CSV export

```bash
bun install
bun run download.ts 2025-12                   # one month  -> ./out/ezpay_<UBN>_2025-12.csv
bun run download.ts 2025-01 2025-12           # month range (inclusive)
bun run download.ts 2025-12 --mer 10000001    # filter to one store (MerID)
bun run download.ts 2025-12 --out ./out       # choose the output dir
```

`download.ts` logs in headlessly (no human captcha), exports `search_invoice_by_csv`
per month via the client, skips empty months, and writes one UTF-8 CSV each.

## Client + MSW tests

`client.ts` is a runtime-agnostic `EzpayBackendClient` (global `fetch`, injectable;
no Bun/Node-only APIs) with `login()`, `searchInvoices`/`searchAllInvoices`,
`countInvoices`/`monthlyStats`, `exportCsv`, `getInvoiceDetail`, `getNotifyHistory`,
`resendNotification`, `listPrintableInvoices`, and `printInvoicePdf` (server-generated
證明聯 PDF, pure HTTP). It takes a `baseUrl` so it points at prod (`inv.`) or the test
site (`cinv.`).

Tests follow the monorepo's MSW pattern (`msw/node` + vitest) and run fully offline:

```bash
bun run test          # vitest run  — all mocked, no network
```

`__tests__/server.ts` mocks the backend and **decodes `send_data_` on the server
side** to assert the client's wire encoding; `__tests__/fixtures.ts` holds synthetic
responses (shapes only — all values are fabricated, no real customer data). Covered:
the captcha-leak login handshake (+ `captchaSolver` path + wrong-captcha error), list
parsing & pagination, `MOD10003`/`INV20002` handling, CSV export (+ empty-dump
detection + store scoping), detail/notify lookups, resend payload + validation,
`monthlyStats`, print/PDF flow, `KEY10008` session expiry, and `web_base_encode`
round-trips. Run under Node (not `bun test`) so MSW's node interceptor works — `bun
run test` invokes the vitest binary, which runs under Node via its shebang.

## Files

| file | what |
|------|------|
| `lib.ts` | `web_base_encode`/decode, `send_data_` builders (`formWorkEncode`, `serializeEncode`), `ezpayUrls(base)`, query builders, month helpers |
| `client.ts` | **`EzpayBackendClient`** — runtime-agnostic, prod/cinv, all operations |
| `creds.ts` | Bun-only: fetch prod/cinv creds from 1Password (`PROD`/`CINV` targets, item names via env) |
| `download.ts` | **the tool**: bulk monthly CSV downloader (client + creds) |
| `EZPAY-BACKEND.md` | full HTTP reference (paths, params, formats, limits, security findings) |
| `__tests__/` | `server.ts` (MSW), `fixtures.ts` (synthetic), `client.test.ts` |

## Notes

- Login needs the captcha only in theory: a wrong-captcha error leaks the correct
  code and it isn't rotated, so login is fully scriptable. Provide a `captchaSolver`
  (e.g. OCR of `captcha_img_com`) as a fallback if ezPay ever patches this.
- Query window is **≤ 1 month** per request (`INV20002` otherwise); the CSV returns
  all rows for the range in one shot (no pagination).
- Exported CSVs contain customer PII (names, emails, IPs) — the tool writes them to
  `out/` which, along with `secrets*.json`, is gitignored. Handle exports per your
  own data-retention rules; never commit them.

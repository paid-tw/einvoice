# nat

Headless client + reverse-engineering reference for the 財政部 電子發票整合服務平台
(`einvoice.nat.gov.tw`) 營業人 side — pull a business's own 進項/銷項 invoices and
折讓單 from the MoF source.

This is an internal repo tool, not a published package. Full path/param/format
reference: **[NAT-PLATFORM.md](./NAT-PLATFORM.md)**.

Pure JS/TS + bun. No `sharp`, no python at runtime. Captcha OCR =
**onnxruntime-web (wasm) + jimp** (ddddocr `common_old.onnx`).

## Setup

```bash
bun install
bun run node_modules/.bin/playwright install chromium   # browser transport (Cloudflare)
bash scripts/fetch_ocr_model.sh                          # fetch the OCR model (~13.6 MB, gitignored)
```

The model fetch is a one-time step that needs `python3` + `pip` (it pulls the model out
of the ddddocr PyPI package). Nothing at *runtime* uses python — only this setup step.

Run the offline tests with `bun run test`.

Credentials: either set `NAT_UBN`, `NAT_USER_ID`, and `NAT_PASSWORD`, or set
`NAT_OP_ITEM` to a 1Password item exposing the fields `統一編號`, `user_id`,
`user_password`. 1Password credentials are cached to `secrets.nat-*.json`
(gitignored, mode 0600). Nothing account-specific is baked into source.

## NatClient — the client

`nat-client.ts` exports `NatClient` (Playwright-based; data calls run in-page so they
carry Cloudflare's `cf_clearance` + the Bearer JWT — a bare fetch is 403'd).

```ts
const c = await NatClient.login();                 // automated OCR-captcha login
const [{ ban }] = await c.authorizedCompanies();
// online (即時) — ≤200 rows, ≤1-month range:
const rows = await c.queryInvoices({ ban, from: "2026-08-01", to: "2026-08-31", invType: "1" });
// offline (非即時) — any size / a 期別:
await c.createReportJob({ ban, from: "2026-07-01", to: "2026-07-31", invType: "1", fileType: "EXCEL" });
const jobs = await c.listJobs();                   // decodes each job token (status "2" = done)
const done = jobs.find(j => j.status === "2" && Number(j.dataCount) > 0);
const xlsx = await c.downloadJob(done);            // Uint8Array (XLSX/CSV)
await c.close();
```

`invType`: `"0"` 進銷項 / `"1"` 進項 / `"2"` 銷項. Demo: `bun run nat-client.ts 2026-08`
(online 進項 count for the month).

### exportInvoices — high-level bulk export

`exportInvoices({ ban, from, to, invType })` returns unified `NatInvoice[]` for **any**
range/size: it splits into ≤1-month chunks, runs a 非即時 **CSV** job per chunk, polls
until done, downloads, and parses the 財政部 **M/D** CSV → one object per invoice (M row,
keyed by the Chinese column headers) with its line items in `items` (D rows). Each row is
tagged with a computed `direction` ("進項"/"銷項") derived from 買方/賣方統一編號 vs `ban`.

```ts
const invoices = await c.exportInvoices({ ban, from: "2024-01-01", to: "2025-12-31", invType: "1",
  onProgress: (ym, n) => console.log(ym, n) });
// invoices[0] = { 發票號碼, 發票日期, 賣方統一編號, 總計, 課稅別, …27 cols, items: [{品名,數量,單價,金額,…}] }
```

## Spot verification — nat-verify

Verify individual invoices against the MoF platform (the statutory source of
truth) — for reconciling a gateway export or local DB row whose status/amount is
in doubt. Gateway exports can go stale (e.g. an invoice voided on the platform
after the gateway snapshot still shows 是否作廢=否); the MoF row is authoritative.

```bash
NAT_OP_ITEM='<your item>' bun run nat-verify.ts 2024-06..2024-07 AB12345678 CD23456789
# ✓ AB12345678: 發票狀態=作廢已確認  發票日期=…  總計=…  傳送方名稱=…  品項=2
```

`<range>` is the 發票日期 window (`YYYY-MM` or `YYYY-MM..YYYY-MM`, chunked into
≤2-month jobs); `--in` marks the numbers as 進項 (default 銷項); `--json` dumps the
full decoded M row + items. Exit 1 if any invoice is not found.

Implementation note: the online (即時) query only serves the **current month**, so
each invoice runs as a 非即時 CSV job with `invNoStart == invNoEnd == 發票號碼` —
works for any archived month and returns exactly that invoice's M/D rows.

## Monthly history export (resumable)

Two CLIs write the government's native CSV, one file per month, and skip months already
downloaded so an interrupted run just resumes:

```bash
NAT_OP_ITEM='<your item>' bun run nat-export-history.ts    [fromYm] [toYm]   # 進+銷 invoices
NAT_OP_ITEM='<your item>' bun run nat-export-allowances.ts [fromYm] [toYm]   # 折讓單 (btb412w)
```

Defaults: `2020-02` → the current month (resolved in Asia/Taipei), output under
`./out/nat-history` and `./out/nat-allowances` (override with `OUTDIR`). Empty months in
**either** export are recorded with a `.empty` marker file so they aren't retried. Files
are written atomically with mode 0600, so an interrupted partial file is not mistaken for
a completed month. The current (still-open) month is always re-fetched on each run; only
closed months are treated as final. Downloaded CSVs contain PII — `out/` is gitignored;
handle per your own data-retention rules.

### Switching accounts

Set `NAT_OP_ITEM` to a different 1Password login (creds are cached per item). If a
company has more than one login under the same 統編, run bulk jobs on a secondary one to
spare the primary account — the login/job methods are identical across accounts.

## Auth / captcha

- Login: OAuth2 PKCE (ORY Hydra) + 5-digit image captcha. `nat-session.ts` `login()`
  automates it: click 營業人 tab → OCR the captcha (retry until accepted) → `doLogin` →
  complete consent → JWT lands in `sessionStorage["token"]`.
- Captcha PNG is transparent-bg + black digits (glyph in the **alpha** channel) → flatten
  over white before OCR. `ocr.ts` + `lib/captcha.ts` + `ocr-model/` (ddddocr). Accuracy
  ~9/10; a `length≠5` result is refetched → effective ≫90%.

## Files

| file | what |
|------|------|
| `nat-client.ts` | **NatClient** — login / online query / offline job create·list·download / `exportInvoices` + 折讓 variants + demo CLI |
| `nat-session.ts` | reusable `login()` → authenticated Playwright page + JWT (`natCreds()` reads 1Password) |
| `ocr.ts`, `lib/captcha.ts`, `ocr-model/` | captcha OCR (onnxruntime-web + jimp + ddddocr); `charset.json` vendored, model fetched |
| `nat-verify.ts` | spot-verify single invoices (offline job + `invNoStart/End`) against the MoF record |
| `nat-export-history.ts` | resumable monthly 進+銷 invoice CSV export |
| `nat-export-allowances.ts` | resumable monthly 折讓單 CSV export |
| `scripts/fetch_ocr_model.sh` | download the ddddocr OCR model into `ocr-model/` (gitignored) |
| `NAT-PLATFORM.md` | full reference (hosts, auth, btb411w/btb412w API, limits, offline job flow) |

Cloudflare requires the browser transport — keep the `NatClient` session open for the
duration of the data work (the JWT lives in `sessionStorage`, not a cookie).

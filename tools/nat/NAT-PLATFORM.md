# 財政部 電子發票整合服務平台 — reverse-engineering reference (營業人 / btb411w)

Target: `https://www.einvoice.nat.gov.tw` (SPA) — the government e-invoice portal.
Goal: pull a business's own **進項/銷項發票** history from the source, for the
營業人 (business) account. Verified live against a 營業人 account (credentials from
a 1Password item, name supplied via `$NAT_OP_ITEM`).

## 0. Architecture

Three hosts:
- `www.einvoice.nat.gov.tw` — the Vue SPA (`/accounts/*` login, `/dashboard/*` app).
- `service-mc.einvoice.nat.gov.tw` — **auth** API (`/act/login/*`, `/sso/*` ORY-Hydra OAuth2).
- `service-m.einvoice.nat.gov.tw` — **data** API (`/btb/{invoice,report,settings}/api/*`).

⚠️ **Everything is behind Cloudflare bot protection.** A bare `fetch`/`curl` — even
with a valid Bearer token — gets a `403` + `Just a moment...` interstitial. Data calls
MUST go through a real browser context (Playwright `context.request` / `page.evaluate`)
that carries the `cf_clearance` cookie and a browser TLS fingerprint. So the NAT client
is **Playwright-based**, unlike the ezPay backend (pure fetch).

Auth token: after login, a **JWT lives in `sessionStorage["token"]`** (a `CU`/`LU`
2-char prefix + an RS256 JWT, ~1194 chars). Data calls send it verbatim as
`Authorization: Bearer <token>`. It is NOT a cookie and does NOT persist across browser
launches (sessionStorage) — so login + data must run in one browser session, or the
token be extracted and replayed via the same Cloudflare-cleared context.

## 1. Login (OAuth2 PKCE + image captcha)

Identity selector on the login page: 消費者 / **營業人·扣繳單位** / 專業代理人 / 受贈團體 /
政府機關·學校. The business form is `/accounts/login/b` (reached by clicking 營業人, not
by URL alone — a direct nav bounces back to the 消費者 `mw` tab).

Business form fields: `ban` (統一編號), `user_id` (帳號), `user_password` (密碼),
`captcha` (圖形驗證碼).

Flow (ORY-Hydra):
1. Hitting `/dashboard/...` unauth → `service-mc/act/login/api/proxy/login/b` →
   `sso/login/oauth2/auth?...&code_challenge=…&code_challenge_method=S256&login_type=b`
   → SPA login page at `/accounts/login?login_challenge=<X>`. The SPA holds the PKCE
   verifier; `<X>` is the login_challenge.
2. **Captcha:** `GET service-mc/act/login/api/act002i/captcha` →
   `{ "token": "L_CAPTCHA_<uuid>", "image": "<base64 PNG>" }`. Token-based (not
   session-only). The PNG is **transparent-bg + black digits — the glyph is in the
   ALPHA channel only** (RGB all 0); flatten over white before OCR. 5 digits, one
   strikethrough line. Refresh = re-GET the endpoint.
3. **Submit:** `POST service-mc/act/login/api/client/doLogin` (JSON):
   `{ loginType:"U", userType:"B", loginChallenge:<X>, ban, customId:<帳號>, password,
      captchaToken, captcha:<5 digits> }`
   → `200 { "redirectTo": "<sso/oauth2/auth?...&login_verifier=…>" }` on success (wrong
   captcha → an error instead).
4. **Complete OAuth:** navigate `redirectTo` → `consent/doConsent?consent_challenge=…`
   → `…&consent_verifier=…` → `code` → dashboard, and `sessionStorage.token` is set.

Automated end-to-end in `nat-session.ts` (`login()`; captcha solved by the OCR below;
retries until accepted). Verified: logs in, extracts the JWT.

## 2. Captcha OCR (onnxruntime-web + jimp)

No `sharp`, no python — matches the BankTeller project's proven stack:
- Model: **ddddocr `common_old.onnx`** (13.6 MB) + `charset.json` (8210 classes, idx 0 = CTC blank).
- Preprocess (jimp): flatten RGBA over white (`L = 255 − alpha`), resize to **H=64**
  (W = round(w·64/h), **BILINEAR** — keeps thin "1" strokes), PIL-'L' luma
  `(299R+587G+114B)/1000`, floor, `/255` → tensor `[1,1,64,W]`.
- Run (onnxruntime-web wasm) → output `(T,1,8210)` → CTC greedy decode (argmax/timestep,
  drop repeats + blank) → `digitsOnly`.
- **Accuracy: 9/10** on a fresh sample. The one miss was a CTC collapse of adjacent
  repeated digits (`20037`→`2037`). Since answers are always **5 digits**, treat
  `length≠5` as a miss and refetch → effective accuracy ≫90%; login also just retries
  on rejection. Files: `ocr.ts`, `lib/captcha.ts`, `ocr-model/`.

## 3. 進項/銷項 query — btb411w (查詢與下載 › 發票查詢/列印/下載)

Screen `BTB411W`, three tabs: **線上查詢** (online, ≤200) / **非即時查詢** (offline/async) /
**新增** (create an offline job). SPA chunks: `btb411w-online`, `btb411w-online-detail`,
`btb411w-offline`, `btb411w-offline-add(-cb)`.

### 3.1 Online query ★ (verified)

`GET service-m/btb/report/api/btb411w/invoice` with Bearer JWT. Query params (verified):

| param | meaning |
|-------|---------|
| `invoiceDateBegin` / `invoiceDateEnd` | ISO `YYYY-MM-DDTHH:mm:ss.SSSZ` range |
| `companyBan` | 營業人統編 |
| `queryInvType` | **1 = 進項, 2 = 銷項** (銷&進 = both) |
| `queryBusinessType` | 資料類型 (0 = 全部 / 有買受人統編 / 無買受人統編) |
| `invStatus` | 發票狀態 (0 = 全部) |
| `invType` | 發票類別 (`00` = 全部) |
| `showMessage` | `true` |

Response: `{ "content": [ { "token": "<JWT-ish blob encoding the invoice fields>", … } ] }`.
Each row's `token` decodes like a job token (JWT payload → base64 `data` → JSON;
`NatClient.decodeDataToken`) into full invoice fields (verified 2026-08-09):
`invoiceNumber, invoiceDate (YYYYMMDD), fmtInvDate (ISO), salesAmount, taxAmount,
totalAmount, taxType, extStatus, processDate, carrierType/carrierId1/2, mainRemark,
emfFormatCode, sourceType, invType, buyerId, buyerName, sellerId, sellerName,
senderId, senderName (傳送方 = the value-added centre), migType, messageType,
zeroTax/freeTaxSalesAmount, …Str display variants`.
The SPA also exposes optional filters: `invoiceNumberStart/End`, `buyerTaxId`,
`buyerName`, `sellerId`, `sellerName`, `carrierType`/`carrierId`, `invoicePeriod` (期別),
最後異動日期 range, 手機條碼. ⚠️ `invoiceNumberStart/End` did **not** match live even for
an in-window invoice (returned 0 rows; exact param encoding unconfirmed) — for
single-invoice lookups use the offline job's `invNoStart/End` instead (§3.3, verified).

**Hard limit: 200 rows.** A single **month** of 進項 is typically well under 200 for a
small business, so query per-month by date range. A **期別 (bimonthly)** or busy month
can exceed 200 → use the offline job (§3.3).

⚠️ **History window: current month only** (observed 2026-08-09): unfiltered one-day
probes on 2026-07-15, -06-15, -05-15, -02-16, 2025-12-15, 2025-06-16 all returned
**0 rows** while 2026-08 (the running month) returned data. Anything older must go
through the offline job (§3.3).

### 3.1.1 進項 vs 銷項 (queryInvType) & how to tell them apart

`queryInvType`: **`0` = 進銷項 (both, default)**, `1` = 進項 (we bought), `2` = 銷項 (we issued).
A combined (`0`) export uses the **exact same M/D format** — there is **no 進/銷 flag column**.
Distinguish by the statutory party 統編 vs your own `ban`:
- **進項**: `買方統一編號 == ban` (we're the buyer; `賣方統一編號` = the supplier).
- **銷項**: `賣方統一編號 == ban` (we're the seller; `買方統一編號` = the customer, `0000000000`
  for B2C consumers).

So existing data already tells them apart — no need to export separately. `exportInvoices`
tags each row with a computed `direction` ("進項"/"銷項"). A combined (`0`) export contains
both directions in the same M/D format; NAT aggregates *all* of the company's e-invoices
regardless of which value-added centre issued them (so invoices issued through one provider
still appear here alongside those from any other).

### 3.2 Download (online result actions)

Buttons on the result table map to SPA actions `btb411wReportCsv` / `btb411wReportXlsx` /
`btb411wReportPdf` / `btb411wApplyPdfReportJob`:
- **下載CSV檔 / 下載Excel檔** — up to **200** rows.
- **下載PDF檔 / (A5) / 電子發票證明聯(5.7)** — realtime PDF ≤ **10** rows; >10 → a batch
  report job (≤20). `btb411wUpdateBuyerRemark` updates 買受人註記 (≤20 at a time).

Online-result actions map to these endpoints (base `service-m/btb/report`, +Bearer):
- `btb411wReportCsv` / `btb411wReportXlsx` → `/api/btb411w/report` (fileType param) — ≤200 rows.
- `btb411wReportPdf` → `/api/btb411w/report` (PDF, ≤10 realtime).
- `btb411wQueryInvoiceDetail` → `GET /api/btb411w/invoice/detail` — one invoice's line items.
- `btb411wUpdateBuyerRemark` — update 買受人註記 (≤20/call).

### 3.3 Offline / async (非即時) — for > 200 rows ★

For a 期別 (2 months) or any range over 200, use the async job (UI: **新增** tab
`/offline/add`, results under **非即時查詢** `/offline`). All base `service-m/btb/report`,
+Bearer JWT, through the browser (Cloudflare). From the SPA api chunk (`index-93dd06f1.js`):

All three verified live (created a 進項 job → completed → downloaded the XLSX).
`{jobType}` = `1`.

| step | action | endpoint |
|------|--------|----------|
| **create job** | `btb411wApplyXlsxReportJob` | `POST /api/btb411w/reportJob/apply/xlsx` |
| **list jobs** | `btb411wQueryXlsxReportJob` | `GET  /api/btb411w/reportJob/xlsx` (PDF: `/reportJob/pdf`) |
| **download** | `btb411wDownloadReport` | `POST /api/btb411w/download/{jobType}` → XLSX blob |

**Create body** (verified) — note `companyBan` is an **array** and `queryType:"I"` is fixed
(invoice; the 依期別/年月/日期 UI mode just resolves to `invStartDate`/`invEndDate`):
```json
{ "invStartDate":"2026-08-01T00:00:00.000Z", "invEndDate":"2026-08-31T23:59:59.999Z",
  "companyBan":["12345678"], "queryInvType":"1", "invStatus":"0", "invType":"00",
  "fileType":"EXCEL", "queryType":"I" }
```
`fileType` = `EXCEL` | `CSV`; `queryInvType` 1 進項 / 2 銷項; optional `invNoStart/End`,
`sellerBan`/`buyerBan`, `lastProcessDateStart/End` (最後異動日期). **Range ≤ 2 months**.

★ `invNoStart`/`invNoEnd` verified live (2026-08-09): a job with both set to one
發票號碼 + a date window returns exactly that invoice's M/D rows (`dataCount:3` =
1 M + 2 D for a two-item invoice) regardless of how old the month is — this is the
**single-invoice verification path** (`nat-verify.ts` wraps it). Confirmed on a
2024-06 作廢 invoice, its 2024-07 replacement, and a 2025-12 invoice transmitted
by a different value-added centre.

**List** `GET /api/btb411w/reportJob/xlsx?queryApplyDateStart=<ISO>&queryApplyDateEnd=<ISO>&showMessage=true&page=0&size=0`
→ `{ content: [ { token } ] }`. Each `token` is a JWT whose `data` (base64 JSON) decodes to
the job: `{ jobType, applyDate, ban, queryStartDate, queryEndDate, sellbuyType(1 進項),
fileType, status, seqNo, filePath, dataCount, companyName, … }`. **`status:"2"` = 處理完成**
(filePath + dataCount populated). Jobs completed near-instantly here (the "每2小時執行一次"
notice is worst-case). List query is by **apply date**, not invoice date.

**Download** `POST /api/btb411w/download/{jobType}` with body **`{ "token": "<the job's list
token>" }`** → XLSX binary (filename `<ban>_IN_<ts>.xlsx`, `IN` = 進項). So: create → poll
`GET /reportJob/xlsx` until the decoded `status==="2"` → POST that job's `token` to download.
(The offline list only fetches on demand — job-create or an explicit 查詢 triggers the list
GET; not on bare tab open.)

## 4. Other 營業人 endpoints seen

- `GET  btb/settings/api/btb002i/company/authorized` → `[{ ban, companyName, closed }]`
  (the 統編s this login may act for).
- `GET  btb/{settings,invoice,report}/api/com001i/statusCodes/{zh,en}` — code lookups.
- Left-nav 營業人功能選單 › 查詢與下載: 發票查詢/列印/下載 (btb411w), 折讓單查詢/列印/下載,
  媒體申報檔下載(非即時), 申報第7條第4款…查詢, 第7條第4款零稅率進/銷項發票, 漏上傳資料清冊,
  未依限或未據實上傳明細. (Other screens: btb401w/402w/403w/404w… = 發票/折讓 upload etc.)

## 5. Plan for a NAT client

Playwright-based (Cloudflare): `login()` (OCR captcha, one session) → keep the context →
`queryInvoices({from,to,invType})` via `context.request.get(...)` with the Bearer JWT →
for > 200 rows, submit an offline job and poll `非即時查詢` for the download. Decode each
result row's `token` (nested base64 JSON) into invoice fields. Reuse the OCR module
(`ocr.ts`) verbatim.

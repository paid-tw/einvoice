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
   → `200 { "redirectTo": "<sso/oauth2/auth?...&login_verifier=…>" }` on success. The SPA
   navigates at once, so the body is often unreadable by the time a listener gets it —
   treat any 2xx as accepted and confirm by the page leaving `/accounts/login`. A wrong
   captcha is `400` "Image verification code verification failed." (verified 2026-11-27).
4. **Complete OAuth:** navigate `redirectTo` → `consent/doConsent?consent_challenge=…`
   → `…&consent_verifier=…` → `code` → dashboard, and `sessionStorage.token` is set.

Automated end-to-end in `nat-session.ts` (`login()`; captcha solved by the OCR below).
Verified: logs in, extracts the JWT.

⚠️ **Failed password submits lock the account** ("此帳號將被鎖定15分鐘" — an earlier
version retried 8 times blindly and locked an account). `login()` reads each `doLogin`
response and retries **only** a captcha rejection (or a click that never submitted);
anything else — wrong credentials, a lock, an unrecognised message — stops at once with
a `NatLoginError` carrying the platform's message (`classifyDoLogin`). Never script a
login against an account whose credentials you have not just confirmed.

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

### 3.1 Online query ★ (verified 2026-11-27)

`GET service-m/btb/report/api/btb411w/invoice` with Bearer JWT. Param names below come
from the SPA's own generated API client (`btb411wQueryInvoice`), not from UI labels:

| param | meaning |
|-------|---------|
| `invoiceDateBegin` / `invoiceDateEnd` | **required**. Range ≤ 2 months (the SPA enforces it). See the date note below |
| `companyBan` | **required**. 營業人統編 |
| `queryInvType` | 1 = 進項, 2 = 銷項, 0 = 進銷項 |
| `queryBusinessType` | 資料類型: 0 = 全部, 1 = 有買受人統編 (B2B), 2 = 無買受人統編 (B2C). ⚠️ see below |
| `invStatus` | 發票狀態 (0 = 全部) |
| `invType` | 發票類別 (`00` = 全部) |
| `invoiceNumberBegin` / `invoiceNumberEnd` | number range, same 字軌. **Not** `invoiceNumberStart/End` (the UI model's names: those make the query 204) |
| `sellerBan`, `buyerBan`, `senderBan`, `cellphoneBarcode` | optional filters |
| `modifyDateBegin` / `modifyDateEnd` | 最後異動日期 range |
| `page`, `size`, `sort` | Spring paging. **Default size is 20.** The SPA offers 10/20/50/100/200 |
| `showMessage` | `true` |

**Dates: send the true UTC instants of Taipei calendar days**, as the SPA's date picker
does (`Date#toISOString()`): 2024-07-10 is `2024-07-09T16:00:00.000Z` ..
`2024-07-10T15:59:59.999Z` (`iso()` in `nat-client.ts`). The server converts to Taipei and
keeps only the **date**, so one day is the finest window. ⚠️ `<date>T00:00:00Z` ..
`<date>T23:59:59Z` covers **two** days. A one-day query returned 48 rows of that day plus
33 of the next. A one-day CSV job held 625 + 454 invoices. A month's query picked up the
next month's 1st. (Verified 2026-11-27. The client used that wrong form until then, so
exports taken before it include each range's following day; see §3.3.)

**Response: a Spring page**: `{ content, empty, first, last, number, numberOfElements,
size, totalElements, totalPages }`. The default size is 20, so read every page. A client
that reads only `content` silently truncates at 20 rows. `queryInvoices` pages with
`size=200` and checks the row count against `totalElements`.

⚠️⚠️ **Hard limit: 200 rows per query, and an over-limit result looks like "no data".**
Both answer **HTTP 204 with an empty body**. Only the `x-inv-alert` header tells them
apart (`x-inv-params` is a URL-encoded JSON array):

| `x-inv-alert` | `x-inv-params` | meaning |
|---|---|---|
| `INV-SELECT-0001-S` | `[]` | 200, rows in the body |
| `INV-SELECT-0001-W` | `[]` | 204, no rows |
| `BTB-BTB411W-0017-W` | `["200","339"]` | 204, **339 rows, over the limit of 200** |

This one behaviour explains every "never answers" symptom seen earlier. 銷項 with
`queryBusinessType=0` looked dead, but it works on any day under 200 rows; busy days are
over the limit. Some B2C invoices were missing from per-type scans because those days'
B2C results were over the limit too. `parseApiResponse` returns `null` for no-data and
throws `NatOverLimitError(limit, total)` for over-limit. `queryInvoices` splits an
over-limit request in this order: 進銷項 → 進項 + 銷項, then 全部 → B2B + B2C, then the date
range in halves. A single day of one type that is still over 200 cannot be read online
and throws. Use `exportInvoices` (the 非即時 CSV job) for that. A month of B2B sales took
10 requests (1,340 rows). One busy day had 577 B2C invoices, which only the job can
return.

A **parameter error is `200 text/plain` "Parameter validation failed."**, not a 4xx. So a
non-JSON 2xx must throw with its first bytes.

**Number lookup** (`findInvoicesByNumber`): set `invoiceNumberBegin = invoiceNumberEnd =
<number>`. The date params stay required, and with true-UTC dates the window is strict.
⚠️ **Search the whole bimonthly filing period (期別), or wider, never just a few days.**
An issuing system's own date can lag MoF's `invoiceDate` by weeks. One invoice was
recorded locally as 2022-06-29, but MoF holds it as 2022-06-09, 20 days earlier. A ±10-day
window around the local date missed it; only a scan of the full period found it
(reported 2026-11-27). A number filter keeps every result tiny, so a full period costs one
request per month.

**Rows are plain JSON objects**, not tokens. Fields seen: `invoiceNumber`, `invoiceDate`
(`yyyymmdd`), `invoiceTime`, `businessType`, `sellerId`, `sellerName`, `buyerId`,
`buyerName`, `salesAmount`, `taxAmount`, `totalAmount` (numbers), `zeroTaxSalesAmount`,
`freeTaxSalesAmount`, `taxType`, `invType`, `extStatus`, … plus a `token`. The `token` is
an opaque handle that the PDF/detail endpoints take. `businessType` is `1` for B2B. B2C
rows come back as `5`, whether they are queried as `2` or `0`.

**B2C (二聯式) amounts are tax-inclusive and not split:** `salesAmount === totalAmount` and
`taxAmount === 0`. Example: a B2C invoice reads 3780 / 0 / 3780, while a B2B one reads
9600 / 480 / 10080. A caller that needs net and tax for B2C must derive them (5%:
`tax = total − round(total / 1.05)`).

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

**Create body** (verified; success is a **bare `200` with an empty body**) — note `companyBan` is an **array** and `queryType:"I"` is fixed
(invoice; the 依期別/年月/日期 UI mode just resolves to `invStartDate`/`invEndDate`):
```json
{ "invStartDate":"2026-08-01T00:00:00.000Z", "invEndDate":"2026-08-31T23:59:59.999Z",
  "companyBan":["12345678"], "queryInvType":"1", "invStatus":"0", "invType":"00",
  "fileType":"EXCEL", "queryType":"I" }
```
`fileType` = `EXCEL` | `CSV`; `queryInvType` 1 進項 / 2 銷項; optional `invNoStart/End`,
`sellerBan`/`buyerBan`, `lastProcessDateStart/End` (最後異動日期). **Range ≤ 2 months**.

**List** `GET /api/btb411w/reportJob/xlsx?queryApplyDateStart=<ISO>&queryApplyDateEnd=<ISO>&processStatus=A&showMessage=true&page=0&size=200`
→ a Spring page `{ content: [ { token } ], totalElements, … }`; 204 = no jobs. The apply
dates and the create body's `invStartDate`/`invEndDate` follow the same true-UTC
convention as §3.1. ⚠️ A job created with `<date>T00:00:00Z..T23:59:59Z` exports one extra
day. Monthly archives made before 2026-11-27 include the next month's 1st; `exportInvoices`
dedupes exact overlaps, but a standalone month file does not. Match a decoded job to its
request by instant (`jobStartsOn`), not by string prefix: `queryStartDate` reads
`2024-06-30T16:00:00Z` for July.
⚠️ **`processStatus` is required.** Without it the answer is `200 text/plain` "Parameter
validation failed." for every `size` (an earlier `listJobs` broke on exactly this). `A`
is all statuses, the SPA default. The 折讓 list (`btb412w`) has the same signature. Each `token` is a JWT whose `data` (base64 JSON) decodes to
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

## 5. The NAT client (`nat-client.ts`)

Playwright-based (Cloudflare): `login()` (OCR captcha, one session) → data calls via an
in-page `fetch` with the Bearer JWT. `queryInvoices` does the online query. It reads all
pages and splits around the 200-row limit, throwing when a single day is still over it.
`findInvoicesByNumber` looks up by number. `exportInvoices` is the complete path: it runs
a 非即時 CSV job per month, polls, downloads and parses it. One month of 銷項 measured 15,459 invoices
in ~30 s (2026-11-27).

The M/D CSV has unquoted commas in free text. 買方名稱 is repaired on M rows. 品名 and
單一欄位備註 are repaired on D rows, where the platform also truncates 品名, so a split
piece can be empty. A row is repaired only when exactly one merge leaves the numeric
columns numeric; otherwise parsing throws rather than shift values.

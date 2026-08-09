# ezPay 電子發票 加值中心後台 — HTTP reverse-engineering reference

Verified against `https://inv.ezpay.com.tw` with a live 加值中心 account
(credentials from a 1Password item, name supplied via `$EZPAY_OP_ITEM`).

Goal: drive the ezPay **加值中心 (value-added center)** backend from a pure HTTP
client to do bulk work the official REST API does not expose — chiefly
**downloading a whole month of invoice detail as CSV** without manual clicking.

Everything below was confirmed end-to-end: fully-headless login (no human
captcha step) → a whole month of invoices exported as CSV in a single request
(thousands of rows, multiple MB, no pagination).

---

## 0. TL;DR — the whole pipeline

1. `GET  /main/Login_center/single_login`  → obtain a `PHPSESSID` cookie.
2. `GET  /main/Login_center/captcha_img_com` (same session) → fixes the session's captcha code.
3. `POST /main/Login_center/single_login_check` with a **dummy** captcha → the error
   message **leaks the correct code** (`圖形驗證碼錯誤 (正確應為：XXXXX)`).
4. `POST /main/Login_center/single_login_check` again with the leaked code → **302**,
   sets `inv_login_company_infoprod` cookie = authenticated.
5. `POST /Invoice_issue/search_invoice_by_csv` with a date range → CSV file of all
   invoices in that range (single request, all rows, no pagination).

No CSRF token. Password is sent in plaintext (TLS only). The captcha is only ever
needed once, at login, and step 3 removes even that need.

---

## 1. The core encoding: `send_data_` / `web_base_encode`

Almost every backend POST sends a **single form field** `send_data_`, which is the
whole real payload run through `web_base_encode`. There is no per-field POST body.

Source: `/js/general_function.js`.

```js
// general_function.js
web_base_encode(s) {
  const e = encodeURIComponent(s);          // 1) percent-encode
  let v = "";
  for (let i = 0; i < e.length; i++)
    v += e.charCodeAt(i).toString(16);       // 2) hex of each char code, concatenated
  return v;                                  //    (every char is ASCII 0x21-0x7e -> exactly 2 hex digits)
}
```

So `send_data_` = **hex( percent-encode( "key=value&key=value&..." ) )**.
Decode (server side / for debugging) = read hex pairs → chars → `decodeURIComponent`
→ parse as a query string. A Node/Bun mirror is in `lib.ts` (`webBaseEncode`,
`webBaseDecode`), verified byte-identical to the site's own function across ASCII,
spaces, punctuation and CJK.

Two builders, because the site builds the inner string two different ways:

- **`formWork(elements, url, target)`** (general_function.js): iterates a jQuery set,
  emits `name=encodeURIComponent(value)` per element in DOM order, joins with `&`,
  then `web_base_encode`s the lot, then submits a throwaway `<form>` with one hidden
  `send_data_` input. Used by the **CSV export**.
  → mirror: `formWorkEncode(pairs)` in `lib.ts`.
- **`$(form).serialize() + "&extra=..."`** then `web_base_encode`. Used by the
  **AJAX list** (`send_search_invoice`). `serialize()` only includes named fields.
  → mirror: `serializeEncode(query)` in `lib.ts`.

Both reduce to the same wire shape; the only nuance is field selection/order, which
the server does not appear to care about.

---

## 2. Login

Page: `GET https://inv.ezpay.com.tw/main/Login_center/single_login`
JS: `/js/login.js` (`login_company`) + `/js/general_function.js` (`formWork`).

### 2.1 The form (`#login_form`)

Real submit target is **NOT** the form's `action` — `login.js` overrides it to
`single_login_check`. Fields collected are the `.login_data` class, in DOM order:

| name        | id          | UI label / notes                          |
|-------------|-------------|-------------------------------------------|
| `LoginUBN`  | `PcComUbn`  | 會員帳號(統一編號), maxlength 8            |
| `Account`   | `PcComId`   | 管理者帳號, maxlength 20                   |
| `Password`  | `PcComPwd`  | 管理者密碼, plaintext, maxlength 20        |
| `backUrl`   | —           | hidden, empty                              |
| `CheckCode` | `PcComPatch`| 驗證碼, 5 chars, `[-_A-Za-z0-9]`           |

Submit builds `send_data_ = web_base_encode("LoginUBN=..&Account=..&Password=..&backUrl=&CheckCode=..")`.

### 2.2 Captcha

- Image: `GET /main/Login_center/captcha_img_com` — 58×20 PNG, ~600 bytes, 5
  alphanumeric chars, session-bound (keyed by `PHPSESSID`).
- Each GET of that URL **regenerates** the code and stores the new one in the
  session. The `.c_img` link refreshes it as `captcha_img_com?<random>`; the page
  also refreshes on `window.focus` and every 5 min.
- A **failed** `single_login_check` does **NOT** regenerate the session code — so a
  code stays valid across attempts until the image URL is fetched again.

### 2.3 Login check

`POST https://inv.ezpay.com.tw/main/Login_center/single_login_check`
Headers: `Content-Type: application/x-www-form-urlencoded`, `Cookie: PHPSESSID=…`.
Body: `send_data_=<encoded above>`.

Responses observed:

- **Wrong captcha** → `200`, body is an inline `<script>`:
  `alert("圖形驗證碼錯誤 (正確應為：<CODE>)"); location.href=".../single_login?postData=<hex>";`
  The `<CODE>` is the correct answer in cleartext (**captcha leak**). The `postData`
  hex is a `web_base_encode` of the echoed `inputUBN`/`inputAccount` used to refill
  the form (`login.js set_data`).
- **Success** → `302` to `/main/Login_notice/noticeCheck`, sets cookie
  `inv_login_company_infoprod` (Secure, HttpOnly, domain `.ezpay.com.tw`). Session is
  now authenticated; reuse `PHPSESSID` + `inv_login_company_infoprod` on all
  subsequent requests.

### 2.4 Fully-headless login (captcha-leak method)

Because a failed check leaks the code and does not rotate it:

```
GET single_login            # -> PHPSESSID
GET captcha_img_com         # -> fixes session code
POST single_login_check  send_data_=(...CheckCode=00000)   # -> parse 正確應為：<CODE>
POST single_login_check  send_data_=(...CheckCode=<CODE>)  # -> 302, authenticated
```

Implemented in `client.ts` (`EzpayBackendClient.login()`). Fallback if the leak is
ever patched: pass a `captchaSolver` (bytes → code) to the client — the captcha is
simple enough for OCR.

---

## 3. Authenticated area — controllers & endpoints

Base after login: `https://inv.ezpay.com.tw/`. Landing shell is `/main`; the
invoice tools live under `Invoice_issue*` / `Invoice_notice*`.

| Purpose                    | Method | Path                                                  | Payload | Response |
|----------------------------|--------|-------------------------------------------------------|---------|----------|
| Search page (HTML)         | GET    | `Invoice_issue/search_invoice`                        | —       | HTML form `#searchinvoice` |
| **Invoice list (AJAX)**    | POST   | `Invoice_issue_ajax/search_invoice_by_db`             | `send_data_` (serialize) | JSON list, paginated |
| **Invoice detail CSV**     | POST   | `Invoice_issue/search_invoice_by_csv`                 | `send_data_` (formWork) + `CsvType=CSV` | CSV file, all rows |
| Single-invoice detail      | POST   | `Invoice_issue_ajax/search_invoice_detail_by_db`      | `send_data_` = `Post_data=<row.post_data>` | JSON `result.Issue` + line items |
| Issue an invoice           | (page) | `Invoice_issue/create_invoice`                        | —       | HTML |
| Copy/re-issue              | JS     | via `copyInvoice(post_data)` → create_invoice         | —       | — |
| Notify list (AJAX)         | POST   | `Invoice_notice_ajax/get_invoice_notice_by_db`        | `send_data_` | JSON |
| Re-send notification       | POST   | `Invoice_notice_ajax/create_notice_by_db`             | `send_data_` | JSON |
| Merchant store create      | (page) | `main/Merchant_center/merchant_create`                | —       | HTML |
| Logout                     | GET    | `Invoice_index/logout`                                | —       | redirect |

Controller JS for the search page: `/js/search_invoice.js?v20240620`.

### 3.1 The search form `#searchinvoice`

POST target `Invoice_issue/search_invoice`. Named fields (all class `search_data`
unless noted) — these are the query filters shared by the AJAX list and the CSV:

| name           | type   | values / notes |
|----------------|--------|----------------|
| `WebType`      | hidden | usually empty |
| `NowPage`      | hidden | id `now_page`; **not** `search_data` (list-only pagination) |
| `InvoiceType`  | select | `""`=不限定, `1`=B2B, `2`=B2C |
| `CarruerType`  | select | `""`, `0`=手機條碼, `1`=自然人憑證, `2`=ezPay電子發票載具 |
| `SearchItem`   | select | field to match: `""`, `InvoiceNum`, `BuyerID`, `BuyerName`, `CustomNum`, `MerID`, `P2gNum`, `CarruerNum` |
| `SearchWord`   | hidden | the value for `SearchItem`; filled from the text box, or from the store dropdown when `SearchItem=MerID` |
| `InvDateType`  | select | `1`=開立日期, `2`=預約日期 |
| `StartInvDate` | text   | `YYYY-MM-DD` |
| `EndInvDate`   | text   | `YYYY-MM-DD` |
| `UploadStatus` | select | `""`, `0`未上傳, `1`已上傳, `2`上傳中, `3`上傳失敗, `4`上傳逾時 |
| `InvoiceStatus`| select | `""`, `0`待開立, `3`預約開立, `1`已開立, `2`已作廢 |

Not serialized (no `name`): `mySearchWord` (visible search box) and `merid_list`
(store dropdown). To filter to one store: set `SearchItem=MerID` and
`SearchWord=<MerID>`. The `merid_list` dropdown lists the merchant's registered
stores, but invoices exist under more `II_Merchant_ID`s than the dropdown shows,
so leaving the store filter empty returns all of them.

### 3.2 Invoice list — `search_invoice_by_db`

Build: `serialize(#searchinvoice) + "&NowPage=<n>"`, then `web_base_encode`, sent as
`send_data_`. (`send_search_invoice(NowPage)` in search_invoice.js.)

Response `Content-Type: text/html; charset=UTF-8`, body is JSON:

```json
{ "status": "SUCCESS", "message": "...",
  "result": { "InvoiceData": [ {...}, ... ], "InvoiceCount": 1234,
              "Page": <totalPages>, "NowPage": 1, "Limit": 10 } }
```

- Page size `Limit` = **10** rows; iterate `NowPage` 1..ceil(InvoiceCount/10) for the
  full set (or just use the CSV — see below).
- Each row carries a `post_data` (encrypted blob) used to open its detail.
- Row fields (60+): `II_Invoice_Number`, `II_Mer_Order_Num`, `II_Merchant_ID`,
  `II_Com_UBN`, `II_Com_Name`, `II_User_Name`, `II_User_UBN`, `II_User_Email`,
  `II_Type`, `II_Category` (B2B/B2C), `II_Tax_Type`, `II_Tax_Rate`, `II_Tax_Amt`,
  `II_Amt` (sales ex-tax), `II_Total_Amt`, `II_Allowance_Amt`, `II_Check_Num`,
  `II_Carruer_Type`, `II_Carruer_Num`, `II_Love_Code`, `II_Random_Num`,
  `II_Invoice_Status`, `II_Create_Date`, `II_Upload_Status`, `II_Upload_Date`,
  `II_Currency`, `II_Exchange_Rate`, … plus `post_data`. Amounts are strings with
  thousands separators (e.g. `"18,971"`).

### 3.3 Invoice detail CSV — `search_invoice_by_csv` ★ the bulk-download

Trigger in UI: run a search, then the `#download_invoice` ("下載查詢結果") link
appears; clicking it calls
`formWork($('.search_data') + {CsvType:'CSV'}, "Invoice_issue/search_invoice_by_csv", "_blank")`.

Pure HTTP:

```
POST https://inv.ezpay.com.tw/Invoice_issue/search_invoice_by_csv
Cookie: PHPSESSID=…; inv_login_company_infoprod=…
Content-Type: application/x-www-form-urlencoded

send_data_=<web_base_encode(
  "WebType=&InvoiceType=&CarruerType=&SearchItem=&SearchWord="
  + "&InvDateType=1&StartInvDate=2025-12-01&EndInvDate=2025-12-31"
  + "&UploadStatus=&InvoiceStatus=&CsvType=CSV" )>
```

Response:
- `200`, `Content-Type: text/x-csv;charset=UTF-8`
- `Content-Disposition: attachment; filename=ezPay_Invoice_<YYYYMMDDhhmmss>.csv`
- Body is **UTF-8** CSV (not Big5), **all matching rows in one response** — verified
  a full busy month (thousands of data rows, several MB) in one response, no pagination.
- **No-data case**: instead of just a header, ezPay appends a PHP `print_r` of an
  error array into the file, e.g. `Array ( [status] => INV10017 [message] => 查無資料 ... )`.
  So a valid export = header row followed by CSV rows; detect the `Array (` / `INV10017`
  marker to recognise an empty period.

CSV columns (header row, 27 cols):

```
商店代號, 商店中文名稱, ezPay電子發票開立序號, 商店自訂編號, 發票號碼,
買受人統編, 買受人名稱, 買受人E-mail, 買受人地址, 防偽隨機碼, 發票類別,
課稅別, 稅額, 銷售額(不含稅), 發票金額, 幣別, 發票備註, 開立發票時間,
上傳發票時間, 載具類別, 捐贈碼, 是否捐贈, 是否作廢, 是否折讓,
目前可折讓金額, 發票通知, IP位址
```

Example row shape (values redacted): store id + name, 開立序號, 自訂編號, 發票號碼,
買受人統編 (`-` when none), 名稱, E-mail, 地址, 隨機碼, `B2C`, `應稅`, 稅額, 銷售額,
發票金額, `TWD`, 備註, 開立時間, 上傳時間, `手機條碼`/`ezPay電子發票載具`, 捐贈碼,
`否`, `否`(作廢), `否`(折讓), 可折讓金額, 通知信箱, IP.

### 3.4 Single-invoice detail — `search_invoice_detail_by_db`

`send_data_ = web_base_encode("Post_data=" + row.post_data)` (the `post_data` blob
from a list row). Returns JSON with `result.Issue` (invoice header, same `II_*`
fields) and its line items (`II_Item_Detail` → `Invoice_Item_Detail_<year>` table).
Only needed for per-invoice line items; the CSV already covers header-level detail
for a whole month.

---

## 4. Operational limits & quirks

- **Query window ≤ 1 month.** A range spanning multiple months returns
  `status: INV20002`. Loop month-by-month.
- **Lookback limit ≈ current year + 2 prior years.** `INV20002` is *not* only
  "range too long" — a **single-month** query whose start date is before
  `Jan 1 of (currentYear − 2)` is also rejected with `INV20002`. Verified live
  2026-08: `2024-01` OK, all of `2023-xx` blocked. So the earliest queryable/
  exportable date rolls forward every Jan 1 — **older history becomes permanently
  unreachable via this backend**, export before year-end if you need it.
- **Empty period** returns `status: MOD10003` (查無資料) on the AJAX list;
  `INV10017` embedded in the CSV. (Distinct from `INV20002` = date not allowed.)
- **CSV is not paginated** — one request yields every row for the (≤1-month) range.
  Prefer it over paging `search_invoice_by_db` at `Limit=10`.
- Amounts in both JSON and CSV are thousands-separated strings; strip commas before
  arithmetic.
- Session cookies: `PHPSESSID` (session) + `inv_login_company_infoprod` (auth). The
  landing GET to `/main` deletes `inv_login_company_infoprod` if presented alone, so
  keep both from the 302 and send them together.

## 5. Observed status codes

| code       | meaning (observed)                          |
|------------|---------------------------------------------|
| `SUCCESS`  | ok                                          |
| `MOD10003` | 查無資料 (no data) — AJAX list, in-range     |
| `INV10017` | 查無資料 (no data) — embedded in empty CSV   |
| `INV20002` | date range not allowed — span > ~1 month **or** start before Jan 1 of (currentYear−2) |
| login alert| `圖形驗證碼錯誤 (正確應為：XXXXX)` — leaks captcha |

(These are the backend/portal codes, distinct from the ezPay **REST API** error
family — `INV*/KEY*/LIB*/IAI*` — mapped in `packages/einvoice-ezpay/src/client.ts`.)

## 6. Security findings (report to ezPay / handle with care)

1. **Captcha answer leaked in the error message** (`正確應為：…`) and the code is not
   rotated on a failed check → the image captcha provides no protection against
   scripted login.
2. **Password posted in cleartext** inside `send_data_` (only reversibly hex/URI
   "encoded", not encrypted) — relies solely on TLS.
3. **No CSRF token** on state-changing POSTs; auth is cookie-only.
4. Empty-period CSV leaks a **PHP `print_r` debug dump** into the downloaded file.

These make automation easy but are genuine weaknesses in ezPay's portal; they may be
patched at any time, so the client should fail loudly (and fall back to OCR for the
captcha) if the leak disappears.

## 7. Backend operations map (authenticated left-nav)

The full set of operations the account can drive, from the 加值中心 side menu. All
are cookie-authenticated and (unless noted) speak the `send_data_` protocol.

| 操作 | controller / path | notes |
|------|-------------------|-------|
| 開立發票 | `Invoice_issue/create_invoice` | issue (also reachable via REST API) |
| **銷項發票查詢** | `Invoice_issue/search_invoice` | list + detail + notify/resend + **CSV export** (§3) |
| 作廢發票 | `Invoice_invalid/create_invalid` | void |
| 折讓單通知作業 | `Invoice_allowance/create_allowance` | allowance |
| **列印電子發票** | `Invoice_search/invoice_print` | print / **PDF** the 證明聯 (§8.3) |
| 列印設定 | `Invoice_setting/printSetting` | print layout prefs |
| 發票章與LOGO設定 | `Invoice_setting/upload_invoice_logo` | stamp/logo upload |
| 中獎作業 | `Invoice_winning/search_invoice` | winning-number matching / prize print |
| 使用狀況 | `Invoice_contract/search_contract` | quota / contract usage |
| **媒體申報檔下載** | `Invoice_files/media_declare_file_page` | download the 財政部 media-declaration file for VAT filing (bulk, not yet detailed here) |
| 登出 | `Invoice_index/logout` | — |

Note the store dropdowns differ per page and neither is exhaustive — invoices exist
under more `II_Merchant_ID`s than either lists; an empty store filter returns all.

## 8. Playbook — "consumer didn't receive the invoice"

All three flows key off a list row's opaque `post_data` blob (from
`search_invoice_by_db`, §3.2). Verified live read-only 2026-08-08.

### 8.1 Look up the invoice + its codes (檢查碼 / 隨機碼 / 號碼)

`POST Invoice_issue_ajax/search_invoice_detail_by_db`
Body: `send_data_ = web_base_encode("Post_data=" + <row.post_data>)`

Response JSON `result`:
- `Issue` — 64 fields (the full `II_*` set), including **`II_Invoice_Number`
  (發票號碼)**, **`II_Random_Num` (隨機碼, 4-digit)**, **`II_Check_Num` (檢查碼)**,
  `II_Carruer_Type`/`II_Carruer_Num` (載具), `II_Love_Code` (愛心碼),
  `II_Print` (列印次數), `II_Winning` (中獎別), `II_Item_Detail` (a JSON **string** of
  line items: 品名/數量/單位/單價).
- `Notify` — array of notification records (see 9.2).
- `Allowance` / `Invalid` / `Allowance_Invalid` — related allowance/void records
  (`IA_*` / `IIV_*`), empty arrays/`""` when none.

The list row (§3.2) *already* carries `II_Invoice_Number`, `II_Check_Num`,
`II_Random_Num`, `II_Carruer_Num`, `II_Love_Code` — so for a plain
number/check/random lookup you don't even need the detail call.

### 8.2 Check notification history + **resend (補發通知)**

**History (read-only):** `POST Invoice_notice_ajax/get_invoice_notice_by_db`
Body: `send_data_ = web_base_encode("Post_data=" + <post_data>)`
Response `result`:
- `invoice` = `{ invoiceNumber, invoiceType, Post_data }`
- `notice[]` = records with `IN_Type` (1開立/2折讓/3作廢/4折讓作廢/5中獎/6其他/7待確認折讓單取消),
  `IN_Notice_Status` (0未通知/1已通知/2補發), `IN_Email`, `IN_Phone`, `IN_IP`,
  `IN_Create_Date`. This tells you whether ezPay ever emailed the buyer and where.

**Resend (state-changing — sends a real email; do NOT fire during exploration):**
`POST Invoice_notice_ajax/create_notice_by_db`
Body: `send_data_ = web_base_encode( serialize(#notify_again_form) + "&Post_data=" + <post_data> )`
i.e. `BuyerMail=<new email>[&BuyerMobile=<phone>]&Post_data=<blob>`. `BuyerMail` is
required, ≤300 chars. Response `{status:"SUCCESS", message}`; `status=KEY10008` means
the session expired (response body is the login URL to redirect to).

### 8.3 Print / download PDF of the 電子發票證明聯

Page `Invoice_search/invoice_print`, controller `/js/print_invoice.js`. The 證明聯 is a
**server-generated PDF (TCPDF)** — `invoice_addition/Invoice_print` responds with
`Content-Type: application/pdf` directly (the browser just opens it in a new tab). So
the whole thing is **pure HTTP, no rendering needed** (verified live on cinv:
`application/pdf`, ~119 KB, A4, with 隨機碼/總計/賣方 + `[交易明細]` line items and a
"Powered by TCPDF" footer). Three steps:

1. **List printable invoices:** `POST Invoice_search_ajax/invoice_print_by_db`,
   `send_data_ = web_base_encode(serialize(#print_search))`. Decoded body:
   `NowPage=1&Sort=desc&MerchantID=&InvoiceNumber=&StartInvDate=…&EndInvDate=…&PrintMark=&InvoiceType=&PageLimit=10`.
   Response `result.InvoiceData[]`, each row has the print-list `post_data` token
   (distinct from the search page's token — use this one) + `II_Print` (列印次數).
2. **Resolve selected → print token:** `POST Invoice_search_ajax/print_by_db`,
   `send_data_ = web_base_encode("Postdata[]=<token>[&Postdata[]=…]")` (MemPW is **not**
   needed here). Response `result` = `{ First[], FirstCount, Printed[], PrintedCount,
   PostData }` — `PostData` is the combined token for step 3.
3. **Get the PDF:** `POST invoice_addition/Invoice_print`,
   `send_data_ = web_base_encode("Post_data=<result.PostData>&printType=page&detail=YES&MemPW=<會員密碼>")`.
   `printType` ∈ page(單張)/letter(信封)/b2b/printer(熱感); `detail=YES` includes line
   items; add `&NoPrintMark=1` to **not** flip 已列印. Response body = the PDF bytes.

**MemPW = the login password.** The print step is gated by the 企業會員密碼, which (on
the accounts observed) is the same value used to log in. A wrong MemPW returns an
**HTML** page carrying `錯誤代碼：KEY10016` instead of a PDF — detect success by the
`%PDF-` magic bytes, not the HTTP status (both are 200).

State change: without `NoPrintMark=1`, printing marks the invoices 已列印 (increments
`II_Print`). Fetch the response as **binary** (`arrayBuffer`), never `.text()`, or the
PDF is corrupted.

## 9. Cross-checking with the official REST API

The `@paid-tw/einvoice-ezpay` adapter (this monorepo) covers issue/void/allowance/
query via the signed REST API (`EZPAY_MERCHANT_ID` / `HASH_KEY` / `HASH_IV`, stored
in your own 1Password item). Its `invoice_search` can confirm a single invoice's
status, but it does not offer month-range bulk export — which is exactly the gap
this backend CSV fills. Use the REST API for authoritative per-invoice lookups and
the backend CSV for bulk reconciliation.

# @paid-tw/einvoice-amego

## 0.3.1

### Patch Changes

- Fix CJS type resolution. Each package's `exports["."]` had a single `types`
  pointing at the ESM `index.d.ts`, so `require()` consumers resolved ESM-shaped
  declarations. Split the map into per-condition `import` / `require` blocks, each
  with its own `types` (`index.d.ts` for ESM, `index.d.cts` for CJS — both already
  emitted by tsup). No API or runtime change. Verified with publint + attw
  (node10 / node16 CJS / node16 ESM / bundler all green).
- Updated dependencies
  - @paid-tw/einvoice@0.3.1

## 0.3.0

### Minor Changes

- ee30cb1: Add a `FOREIGN_CURRENCY` capability for the `currency` + `exchangeRate`
  annotation. Amego declares it and maps the fields; ECPay and ezPay don't
  support a foreign-currency field, so they now reject a non-TWD `currency` with
  an `UNSUPPORTED` error instead of silently dropping it. The statutory amounts
  are still integer TWD. The top-level README gains a capability matrix.

### Patch Changes

- Updated dependencies [ee30cb1]
  - @paid-tw/einvoice@0.3.0

## 0.2.0

### Minor Changes

- 08b9648: Correct every Amego endpoint against the live-verified API contract: per-endpoint
  field casing (PascalCase vs snake_case), array payloads (`f0501`/`g0401`/`g0501`/
  `*_status`/`ban_query`), the `type` discriminator and nested `data` parsing for
  queries, B2B/B2C/mixed (TaxType 9) amount handling, tax-exclusive allowances with
  per-line tax, and the full set of issue fields (carrier id1/id2, member carrier
  `amego`, `DetailVat`, telephone, etc.). Adds opt-in clock sync (`syncTime`) and
  network retry (`retry`).
- 9adf03f: Support cross-border foreign-currency invoices. `IssueInvoiceInput` gains optional
  `currency` (ISO 4217) and `exchangeRate` fields (exchangeRate required when
  currency ≠ TWD). The statutory amount fields remain TWD — a MIG invariant — so
  these annotate the original transaction. The Amego adapter maps them to the
  `Currency` / `ExchangeRate` fields; verified live.
- 7ef9a70: Add per-field validation of the f0401 / f0401_custom payloads, run by default
  before sending (opt out with `validatePayload: false`). Rules are verified
  against the live sandbox and include ones Amego silently accepts — malformed
  email, bad `Currency`, non-numeric `ExchangeRate`, `PrinterLang`, `BuyerName`
  "0000" — plus the server-enforced ones (8-digit 統編, ≤256 品名, ≤6 單位, item
  TaxType 1–3, zero-rated requires CustomsClearanceMark + ZeroTaxRateReason,
  `DetailVat=0` only with 統編). Also fixes `invoice.issueCustom`, which must send
  an ARRAY payload (and validates the merchant-supplied InvoiceNumber/InvoiceDate
  YYYYMMDD/InvoiceTime hh:mm:ss), and maps the f0401_custom field error (code 99).
- 93e5e25: Add full per-field validation for `g0401` (開立折讓), closing the last gap (f0401
  already had it). `amegoAllowancePayloadSchema` validates AllowanceNumber (≤16),
  AllowanceDate/OriginalInvoiceDate (YYYYMMDD), AllowanceType (1/2), BuyerIdentifier
  (統編 checksum), BuyerName, and each ProductItem (OriginalInvoiceNumber,
  OriginalDescription ≤256, ≤7-decimal amounts, integer Tax, TaxType 1/2/3) —
  amounts may be strings or numbers, as the official example mixes both. The
  `allowance()` method validates before sending (opt out with validatePayload:false)
  and now defaults BuyerName to 消費者. Maps the `4040xxx` error family (field →
  VALIDATION, 原發票不存在 4040156 → NOT_FOUND, state conflicts 4040152-154/4040161-163
  → CONFLICT), all returned as string codes. Verified live.
- aa2b551: Initial release: provider-agnostic core (`@paid-tw/einvoice`) with unified types,
  `InvoiceProvider` interface, Zod validation, and `MockProvider`; plus the Amego
  adapter scaffold (`@paid-tw/einvoice-amego`).
- 56c8b2b: Expand `invoice.file` to the full spec (now an options object, matching
  `invoice.print`): look up by `invoiceNumber` or `orderId` (type discriminator),
  and `downloadStyle` gains `5` (QRcode_A4) alongside 0/1/2/3. Returns
  `data.file_url` (valid ~10 minutes). Verified live (order lookup + style 5).
- b038796: Expand `invoice.print` to the full spec (now an options object): look up by
  `invoiceNumber` or `orderId` (type discriminator), and pass `printInvoiceType`
  (1 正本 / 2 補印 / 3 單印明細) and `printInvoiceDetail` (0/1/2) — the previous
  positional signature couldn't express these. Returns `data.base64_data` (XML for
  printerType 1, ESC/POS for ≥2; a $0 invoice can't be printed). Map the print
  param errors 31–36 → VALIDATION. Verified live (real base64 output + order
  lookup).
- 9820aeb: Expand `invoice.query` to look up by `invoiceNumber` or `orderId` (options
  object, matching `invoice.print`/`file`; the unified `query()` already supported
  both). The unified `query()` now also maps each item's `taxType` and `remark`.
  The full nested response (`product_item[]`, `wait[]`, `allowance[]`,
  `detail_vat`/`detail_amount_round`, carrier/npoban, etc.) is available on `raw`,
  and its shape is covered by the captured fixture.
- 423cafe: Type the `track.all` (所有字軌資料) method: `track.all({ year, period? })` maps to
  PascalCase `Year`/`Period` (lowercase yields no data — verified live) and returns
  the nested 3-layer track tree (1 財政部 / 2 光貿 / 3 字軌列表; leaves carry
  category, TrackApiCode, source, status). Export `TRACK_LAYER`, `TRACK_CATEGORY`,
  and `TRACK_SOURCE` code maps. Completes the typed `track.*` namespace.
- 87516fb: Type the `track.get` (字軌取號) allocation method — `track.get({ year, period, book, trackApiCode? })`
  maps to PascalCase `Year`/`Period`/`Book` and returns `data: { code, start, end }`
  (allocating 50 numbers per book). Using it, the f0401_custom success path was
  captured live and now backs the fixture. Validation also learned that
  f0401_custom **requires `PrintMark`** (Y/N) and that `PrintMark=N` needs a
  carrier or donation — both verified live.
- 7eb1d5d: Type the `track.status` (字軌狀態) method: `track.status({ year, period?, trackApiCode? })`
  maps to the PascalCase `Year`/`Period`/`TrackApiCode` fields (a lowercase `year`
  silently returns an empty list — verified live). Export a `TRACK_STATUS` code map
  (1 使用 / 2 停用 / 3 過期 / 9 用畢) and cover the `data[]` response shape.
- 4fa0a22: Add 統一編號 (UBN — Unified Business Number) validation as a standalone, provider-
  agnostic primitive in core: `isValidUbn(input, { legacy? })` implements the
  財政部 checksum (post-2023 ÷5, plus the legacy ÷10 option and the 7th-digit special
  case). The unified model now uses the official term: `Buyer.taxId` → `Buyer.ubn`
  and `taxIdSchema` → `ubnSchema` (which now verifies the checksum, not just 8
  digits). 統一編號 is distinct from a 稅籍編號 (tax registration number); the
  misleading `taxId` naming is gone.

  The Amego adapter consumes the core validator (its `BuyerIdentifier` and
  `banQuery` both checksum-validate, matching Amego's server-side enforcement —
  3040122 / 99), and `AmegoConfig.sellerTaxId` is renamed to `sellerUbn`. Amego's
  `ban` wire field is kept only at the API boundary. All verified live.

### Patch Changes

- 7fb4506: Cover the `allowance_list` response shape (verified live): pagination
  (`page_total`/`page_now`/`data_total`) plus rows of `{ allowance_number,
invoice_type (D0401/D0501/B…), invoice_status, allowance_date, allowance_type,
buyer_*, tax_amount, total_amount (未稅), cancel_date, create_date, product_item[]
with original_invoice_number/date + per-line tax }`. The request shape
  (date_select/date_start/date_end/limit/page) was already correct.
- 921d2bc: Cover the `allowance_query` response shape (verified live): nested `data` with
  `invoice_type`, `invoice_status`, `allowance_type`, buyer fields, 未稅
  `total_amount` + `tax_amount`, `detail_vat`, `product_item[]`
  (original_invoice_number/date + per-line tax), and the `wait[]` pending-schedule
  array (e.g. a queued D0501 void). Request shape (`{ allowance_number }`) was
  already correct.
- 4030e61: Cover the `allowance_status` response and export an `UPLOAD_STATUS` code map
  (1 待處理 … 99 完成) shared by invoice/allowance status & query. The request is a
  PascalCase array `[{ AllowanceNumber }]` (note: `allowance_query` uses snake_case
  — Amego is inconsistent); the response is `data[]` of `{ allowance_number, type
(D0401/D0501/NOT_FOUND/TYPE_ERROR), status, tax_amount, total_amount (未稅) }`. A
  well-formed but unknown allowance returns `type: "NOT_FOUND"` with code 0 (not an
  error) — verified live.
- f2a64ac: Audit f0401_custom and g0401 for full field + error-code coverage (no gaps
  found). f0401_custom has all 8 self-numbering fields on top of the f0401 base;
  g0401 has all 11 top-level + 9 item fields. Tests now lock in the full g0401
  `4040xxx` family (VALIDATION / CONFLICT 4040152-154,4040161-163 / NOT_FOUND
  4040156, incl. string-code coercion) and the f0401_custom code 99.
- 05818c3: Map the remaining 通用/系統 error codes: `13` (status 未啟用), `19` (公司停權), and
  `22` (尚未申請 API 串接) → AUTH (alongside 11/12/14/15/16); `10` (維護中), `18`
  (無法建立資料庫連線), `21` (人數過多) → PROVIDER (transient, retry later). A test
  locks in the full common code family (10–23).
- 15ccbc2: Audit the full f0401 (開立發票) error-code family and refine two mappings:
  `3040191` (無法取得下一張發票) → NUMBER_EXHAUSTED (was VALIDATION) and `3040192`
  (取得發票列印格式錯誤) → PROVIDER (a system error, not caller input). A test now
  locks in that every documented f0401 code (3040111–3040193) is categorized. All
  33 f0401 request fields were already present in the validation schema.
- e539d15: Reconcile f0401 validation with the full auto-numbering spec (verified live):
  allow `PrinterLang` 3 (UTF-8) and any `PrinterType` model code (previously
  limited to 1/2, which wrongly rejected valid values); add `PrintDetail`,
  `TrackApiCode`, `BrandName`, and `TaxAdjustment` with its precondition rule
  (統編 + DetailVat=0 + SalesAmount ending in 10/30/50/70/90 — Amego silently
  accepts violations, so we reject them locally).
- ab284a2: Complete the `f0501` (作廢發票) error-code mapping: `3050111` (CancelInvoiceNumber
  錯誤) and `3050124` (發票類型錯誤) → VALIDATION; `3050126` (超過修改期限) and
  `3050131` (等待排程) → CONFLICT (alongside the already-mapped 3050112/3050121-123/
  3050125/3050141). The `void()` array shape was already correct. Verified live.
- 0ed8a29: Cover the PDF file endpoints, verified live. `invoice.file` ({ type:"invoice",
  invoice_number, download_style }) and `allowances.file` ({ allowance_number,
  download_style }) both return `data.file_url` (a link valid ~10 minutes) — their
  shapes were already correct (unlike the print endpoints). Tighten
  `allowances.file` `download_style` to the spec's `0 | 1 | 3` (A4 整張 / A4(地址+A5) / A5).
- 58fa321: Fix `invoice.list`/`allowances.list`, which silently returned no data because the
  date-range fields were wrong. Amego expects `date_select` + `date_start`/`date_end`
  (numeric YYYYMMDD) + `limit` + `page` (not `start_date`/`end_date`/`page_size`).
  Also support querying by `orderId` via `invoice_query`'s `type: "order"`. Both
  verified against the live sandbox; the list path is now covered by the live test.
- 84fd8c1: Reconcile `mapAmegoErrorCode` against the complete official error table
  (info_detail?mid=71 — 141 codes). Map the print/file/query operation-state codes
  51 (超過查詢期限), 52 (等待異動排程), 53 (載具/類型不可), 55 (不符合條件), 56 (0 元發票)
  → CONFLICT (were PROVIDER). Every documented code now resolves intentionally;
  only genuine system/transient errors (10/18/21/72/3040192) remain PROVIDER.
- dd3e98f: Fix the g0501 (作廢折讓) error-code mapping — 6 codes were falling through to
  PROVIDER (the 4040 range rule doesn't cover 4050xxx). `4050121`
  (CancelAllowanceNumber 錯誤) and `4050133` (折讓類型錯誤) → VALIDATION; `4050131`
  (折讓開立中), `4050132` (已存在作廢折讓), `4050135` (超過修改期限), `4050141` (等待排程)
  → CONFLICT (alongside 4050112 → VALIDATION and 4050134 → NOT_FOUND). g0401 (4040xxx)
  was already complete. A test locks in the full g0501 family (incl. string codes).
- a12eb30: Handle string error codes. `g0501` (作廢折讓) returns `code` as a STRING (e.g.
  `"4050112"`/`"4050134"`), unlike `f0501` which returns a number. The success
  check and `mapAmegoErrorCode` now coerce the code, so these are detected and
  mapped correctly: `4050112` (data 應為陣列) → VALIDATION, `4050134` (折讓單不存在)
  → NOT_FOUND. The `voidAllowance` request shape (array `[{CancelAllowanceNumber}]`)
  was already correct. Verified live.
- 916cbdc: Cover the `invoice_list` response shape with a full real captured row:
  pagination (`page_total`/`page_now`/`data_total`) plus rows with `invoice_type`
  (C0401/A0401/…), `invoice_status`, dates, buyer fields, the full amount block,
  carrier/npoban, `invoice_lottery`, `order_id`, etc. Request shape and the 31–36
  param error codes were already correct/mapped.
- 52b64dd: Cover the `invoice_status` response: a PascalCase array request `[{InvoiceNumber}]`
  returns `data[]` of `{ invoice_number, type (C0401/C0501/C0701/NOT_FOUND/TYPE_ERROR),
status (UPLOAD_STATUS), total_amount }`. A batch can mix real invoices and unknown
  ones (`type: "NOT_FOUND"`, code 0) — verified live. The 99 per-record error was
  already mapped.
- 73d2dba: Cover the `lottery.status` (中獎發票) response shape: `data[]` of
  `{ invoice_date (YYYYMMDD), invoice_number, type }` where `type` references the
  lottery_type prize definitions. The `{ Year, Period }` request and the empty
  envelope are verified live (the sandbox merchant has no winners); the winning-row
  shape is from the official spec.
- ca4f00e: Fix `lottery.type` (獎項定義), previously failing with code 16. No-data endpoints
  must send an EMPTY `data` string (signed over ""), not `"{}"` — Amego strips the
  data and verifies the signature against an empty string. `amegoRequest` now sends
  empty data when none is provided, and `lottery.type()` returns the prize-type
  list. Verified live.
- 3eb6b07: Add `isValidMobileBarcode` to core — a standalone 手機條碼 (載具 3J0002) format
  check ("/" + 7 of [0-9A-Z.+-]), now reused by `carrierSchema`. The Amego
  `barcodeQuery` validates the format locally first (fail-fast) and maps Amego's
  codes per the live-verified behaviour: 9000111/9000112 (empty/format) →
  VALIDATION, 9000113 (不存在) → NOT_FOUND.
- 14b4541: Fix `invoice.print` and `allowances.print`, which sent PascalCase fields Amego
  rejects. Verified live: `invoice_print` needs `{ type:"invoice", invoice_number,
printer_type, printer_lang? }` (PascalCase → "type 查詢類型不存在"), and
  `allowance_print` needs snake_case `{ allowance_number, printer_type, printer_lang? }`
  (PascalCase → "allowance_number 不可為空"). `printer_lang` is now optional (Amego
  uses the model's default when omitted). Both return `data.base64_data` for
  printer_type ≥ 2.
- ae230c9: Fix `time()` (伺服器時間): `/json/time` is a plain GET with no signing and its
  response has no `code` envelope, so routing it through the signed POST path
  threw against the real API (it only passed against mocks). It now does a GET via
  `fetchServerTime` and returns the full breakdown ({ timestamp, text, year, month,
  day, hour, minute, second }). The opt-in clock sync uses the same GET. Verified live.
- Updated dependencies [9adf03f]
- Updated dependencies [aa2b551]
- Updated dependencies [3eb6b07]
- Updated dependencies [4fa0a22]
  - @paid-tw/einvoice@0.2.0

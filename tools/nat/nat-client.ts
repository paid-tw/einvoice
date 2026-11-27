// NatClient — drive the 財政部 電子發票整合服務平台 營業人 (business) side headlessly.
// Login is automated (ONNX captcha OCR); data calls run inside the browser page
// (page.evaluate fetch) so they carry Cloudflare's cf_clearance + the Bearer JWT
// from sessionStorage — a bare fetch/curl is 403'd by Cloudflare.
import type { Browser, BrowserContext, Page } from "playwright";
import { login } from "./nat-session.ts";

const API = "https://service-m.einvoice.nat.gov.tw/btb/report";

export type InvType = "0" | "1" | "2"; // 0 = 進銷項 (both), 1 = 進項 (input), 2 = 銷項 (output)
export type FileType = "EXCEL" | "CSV";

/** A decoded 非即時 job (from a list token's nested base64 `data`). */
export interface ReportJob {
  token: string; // the list token — pass to downloadJob()
  jobType: string;
  status: string; // "2" = 處理完成
  seqNo: number;
  fileType: string;
  dataCount: string;
  filePath: string;
  applyDate: string;
  queryStartDate: string;
  queryEndDate: string;
  sellbuyType: string; // "1" 進項 / "2" 銷項
  companyName: string;
  ban: string; // the job's own 統編 (decoded from the token) — filter downloads to your company
}

/**
 * The platform's date params look like ISO-8601 UTC but are not: the server reads the
 * wall-clock part as Asia/Taipei time and ignores the `Z`. So a local calendar date is sent
 * as `<date>T00:00:00.000Z` .. `<date>T23:59:59.999Z`. Do NOT "fix" this to true UTC
 * (`2024-07-09T16:00:00.000Z`): that shifts the window by 8 hours (verified 2026-11-27: one
 * day's B2B sales dropped from 81 rows to 48).
 */
export const iso = (d: string, end = false) => `${d}T${end ? "23:59:59.999" : "00:00:00.000"}Z`;

/** One invoice (財政部 M row), keyed by the CSV headers, with its line items (D rows). */
export interface NatInvoice {
  items: Array<Record<string, string>>;
  [col: string]: string | Array<Record<string, string>>;
}

/**
 * Whether a month's output is final (skippable). A month is final only once it was
 * fetched AFTER it closed:
 *  - the current (still-open) month is never final — always re-fetch it;
 *  - an archive taken while the month was open (`.open` marker still present) is not
 *    final until one post-close refresh clears the marker;
 *  - otherwise exactly one of the data file / empty marker must be present (XOR). Both
 *    present — a crash between writing one and removing the other — is contradictory,
 *    so it is not final and the next run re-fetches to reconcile.
 */
export function isMonthFinal(opts: { hasData: boolean; hasEmpty: boolean; hasOpen: boolean; isCurrent: boolean }): boolean {
  if (opts.isCurrent) return false;
  if (opts.hasOpen) return false;
  return opts.hasData !== opts.hasEmpty;
}

/**
 * The [from, to] slice of one month chunk (`ym` = "YYYY-MM") intersected with a requested
 * "YYYY-MM-DD" range: the first chunk keeps the requested start and the last chunk the
 * requested end, while interior months span whole — so a mid-month range exports only the
 * requested interval, not the whole month. YYYY-MM-DD sorts chronologically, so plain
 * string min/max clamps correctly.
 */
export function monthChunkRange(ym: string, from: string, to: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  return { from: from > monthStart ? from : monthStart, to: to < monthEnd ? to : monthEnd };
}

/** Remove exact cross-month portal overlaps; reject a reused statutory key with conflicting content. */
export function dedupeNatInvoices(invoices: NatInvoice[]): NatInvoice[] {
  const unique = new Map<string, { invoice: NatInvoice; signature: string }>();
  for (const invoice of invoices) {
    const seller = (invoice["賣方統一編號"] as string) ?? "";
    const number = (invoice["發票號碼"] as string) ?? "";
    // 發票號碼 tracks (字軌) are reassigned per 期別, so the same number legitimately
    // recurs in a later period — key on 發票日期 too, or a later invoice looks like a conflict.
    const date = (invoice["發票日期"] as string) ?? "";
    const missing = [!seller && "賣方統一編號", !number && "發票號碼", !date && "發票日期"].filter(Boolean);
    if (missing.length) throw new Error(`NAT invoice is missing key component(s): ${missing.join(", ")}`);
    const key = `${seller}|${number}|${date}`;
    const signature = JSON.stringify(invoice);
    const previous = unique.get(key);
    if (previous) {
      // Same statutory key, different content: a silent keep-first would make totals
      // depend on input order and could retain pre-void/amendment data — fail loudly.
      if (previous.signature !== signature) throw new Error(`NAT duplicate invoice key has conflicting content: ${key}`);
      continue;
    }
    unique.set(key, { invoice, signature });
  }
  return [...unique.values()].map(({ invoice }) => invoice);
}

/** Inclusive list of "YYYY-MM" between two YYYY-MM-DD dates. */
function monthsBetween(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const out: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Parse complete CSV records, including quoted commas, quotes, and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  // An open quote at EOF means the stream ended mid-field \u2014 a truncated download that
  // still lined up its delimiters would otherwise archive silently with clipped content.
  if (q) throw new Error("NAT CSV ended inside a quoted field \u2014 download may be truncated");
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  if (rows[0]?.[0].startsWith("\uFEFF")) rows[0][0] = rows[0][0].slice(1);
  return rows;
}

/** Repair a NAT row where an unquoted comma in 買方名稱 shifted every later field. */
function normalizeMasterRow(row: string[], header: string[]): string[] {
  if (row.length !== header.length + 1) return row;
  const buyerName = header.indexOf("買方名稱");
  const sellerUbn = header.indexOf("賣方統一編號");
  const sentAt = header.indexOf("寄送日期");
  if (
    buyerName < 0 ||
    sellerUbn !== buyerName + 1 ||
    sentAt < 0 ||
    /^\d{8}$/.test(row[sellerUbn] ?? "") ||
    !/^\d{8}$/.test(row[sellerUbn + 1] ?? "") ||
    !/^\d{4}-\d{2}-\d{2}/.test(row[sentAt + 1] ?? "")
  ) return row;
  return [...row.slice(0, buyerName), `${row[buyerName]},${row[buyerName + 1]}`, ...row.slice(buyerName + 2)];
}

/** A Spring Data page — the shape of every paged list response. */
export interface NatPage<T> {
  content: T[];
  empty: boolean;
  first: boolean;
  last: boolean;
  number: number; // 0-based page index
  numberOfElements: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

/**
 * One online-query (btb411w) row. Plain JSON fields — the `token` is only an opaque handle
 * for the PDF/detail endpoints. Dates are `yyyymmdd`. **B2C (二聯式) rows carry
 * `salesAmount === totalAmount` and `taxAmount === 0`**: the invoice is tax-inclusive, so
 * MoF does not split the tax; a caller wanting net/tax for B2C must derive it.
 */
export interface NatInvoiceRow {
  invoiceNumber: string;
  invoiceDate: string; // yyyymmdd
  invoiceTime?: string;
  businessType: string | number; // 1 = 有買受人統編 (B2B); B2C rows were seen as 5
  sellerId: string;
  sellerName?: string;
  buyerId: string;
  buyerName?: string;
  salesAmount: number | string;
  taxAmount: number | string;
  totalAmount: number | string;
  token: string;
  [field: string]: unknown;
}

/** Online-query 資料類型: 0 = 全部, 1 = 有買受人統編 (B2B), 2 = 無買受人統編 (B2C). */
export type BusinessType = "0" | "1" | "2";

/** One (queryInvType, queryBusinessType) request slice of an online query, and what it returned. */
export interface QuerySlice {
  invType: "1" | "2";
  businessType: BusinessType;
  /** `"no-content"` = HTTP 204, the platform's "nothing for these params". */
  result: "rows" | "no-content";
  totalElements: number;
}

/**
 * The (invType, businessType) slices that cover a direction. 銷項 does not answer
 * businessType 0 (全部) — 204 even on days with sales — so it is queried as B2B (1) +
 * B2C (2) and merged. 進項 answers 0. 進銷項 (0) is split into 進項 + 銷項. An explicit
 * businessType is passed through.
 */
export function querySlices(invType: InvType, businessType?: BusinessType): Array<{ invType: "1" | "2"; businessType: BusinessType }> {
  const sales: Array<{ invType: "1" | "2"; businessType: BusinessType }> =
    businessType && businessType !== "0"
      ? [{ invType: "2", businessType }]
      : [
          { invType: "2", businessType: "1" },
          { invType: "2", businessType: "2" },
        ];
  const purchases: Array<{ invType: "1" | "2"; businessType: BusinessType }> = [{ invType: "1", businessType: businessType ?? "0" }];
  if (invType === "1") return purchases;
  if (invType === "2") return sales;
  return [...purchases, ...sales];
}

/** Raw in-page fetch result. */
export interface RawResponse {
  status: number;
  contentType: string;
  text: string;
}

/**
 * Turn a raw response into JSON. **HTTP 204 → `null`**: the platform answers "nothing for
 * these params" with an empty 204, which must not read as a successful empty result (that
 * silently hid the businessType-0 problem). A 2xx that isn't JSON throws: parameter errors
 * come back as `200 text/plain "Parameter validation failed."`, not as a 4xx.
 */
export function parseApiResponse<T>(method: string, url: string, r: RawResponse, opts: { allowEmpty?: boolean } = {}): T | null {
  const where = `NAT ${method} ${url.split("?")[0]}`;
  const snip = r.text.slice(0, 200);
  const ct = r.contentType || "no content-type";
  if (r.status < 200 || r.status >= 300) throw new Error(`${where} → HTTP ${r.status} (${ct}): ${snip}`);
  if (r.status === 204) return null;
  if (!r.text) {
    // Job-create POSTs answer a bare 200 on success; everywhere else an empty 200 is anomalous.
    if (opts.allowEmpty) return null;
    throw new Error(`${where} → HTTP ${r.status} with an empty body (expected JSON, or 204 for no data)`);
  }
  try {
    return JSON.parse(r.text) as T;
  } catch {
    throw new Error(`${where} → HTTP ${r.status} non-JSON body (${ct}): ${snip}`);
  }
}

/** Fetch every page of a paged endpoint; checks the row count against totalElements. */
export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<NatPage<T> | null>,
  what: string,
): Promise<{ rows: T[]; noContent: boolean }> {
  const rows: T[] = [];
  for (let page = 0; ; page++) {
    const p = await fetchPage(page);
    if (!p) {
      if (page === 0) return { rows, noContent: true };
      throw new Error(`${what}: page ${page} answered 204 after earlier pages had rows`);
    }
    rows.push(...(p.content ?? []));
    if (p.last || !p.content?.length || page + 1 >= p.totalPages) {
      if (rows.length !== p.totalElements) throw new Error(`${what}: got ${rows.length} row(s) but totalElements is ${p.totalElements}`);
      return { rows, noContent: false };
    }
  }
}

/** Largest page size the SPA offers (10/20/50/100/200); the API's default is 20. */
const PAGE_SIZE = 200;

/**
 * Repair a NAT D row where unquoted commas in a free-text column (seen live in 品名, e.g.
 * "…(原價 7,360)") split it into extra cells. Each free-text column is tried as the merge
 * site; the repair is accepted only if exactly one choice leaves 數量/單價/金額 numeric —
 * otherwise the row is returned as-is and the caller's width check rejects it.
 */
function normalizeDetailRow(row: string[], header: string[]): string[] {
  const extra = row.length - header.length;
  if (extra < 1 || extra > 8) return row;
  const numeric = ["數量", "單價", "金額"].map((h) => header.indexOf(h));
  if (numeric.some((i) => i < 0)) return row;
  const isNum = (v: string | undefined) => /^-?\d+(\.\d+)?$/.test(v ?? "");
  const candidates = ["品名", "單一欄位備註"]
    .map((h) => header.indexOf(h))
    .filter((i) => i >= 0)
    .map((i) => [...row.slice(0, i), row.slice(i, i + extra + 1).join(","), ...row.slice(i + extra + 1)])
    .filter((r) => numeric.every((i) => isNum(r[i])));
  return candidates.length === 1 ? candidates[0] : row;
}

export class NatClient {
  private constructor(
    readonly browser: Browser,
    readonly ctx: BrowserContext,
    readonly page: Page,
    readonly loginBan: string,
  ) {}

  /** @internal Wrap an already-authenticated page (tests pass a fake `evaluate`). */
  static fromPage(page: Pick<Page, "evaluate">, loginBan: string): NatClient {
    return new NatClient(null as unknown as Browser, null as unknown as BrowserContext, page as Page, loginBan);
  }

  /** Log in (automated captcha) and return a ready client. */
  static async login(): Promise<NatClient> {
    const s = await login();
    return new NatClient(s.browser, s.ctx, s.page, s.ban);
  }

  /** In-page fetch → JSON, or `null` for HTTP 204 (see parseApiResponse). Reads the Bearer token from sessionStorage each call. */
  private async apiJson<T>(method: "GET" | "POST", url: string, body?: unknown, opts: { allowEmpty?: boolean } = {}): Promise<T | null> {
    const r = await this.page.evaluate(
      async ({ method, url, body }) => {
        const headers: Record<string, string> = { Authorization: `Bearer ${sessionStorage.getItem("token")}` };
        if (body !== undefined) headers["Content-Type"] = "application/json";
        const res = await fetch(url, { method, headers, credentials: "include", body: body !== undefined ? JSON.stringify(body) : undefined });
        return { status: res.status, contentType: res.headers.get("content-type") || "", text: await res.text() };
      },
      { method, url, body },
    );
    return parseApiResponse<T>(method, url, r, opts);
  }

  /** In-page fetch → binary (base64 across the boundary). */
  private async apiBinary(method: "GET" | "POST", url: string, body?: unknown): Promise<Uint8Array> {
    const r = await this.page.evaluate(
      async ({ method, url, body }) => {
        const headers: Record<string, string> = { Authorization: `Bearer ${sessionStorage.getItem("token")}`, Accept: "application/octet-stream, */*" };
        if (body !== undefined) headers["Content-Type"] = "application/json";
        const res = await fetch(url, { method, headers, credentials: "include", body: body !== undefined ? JSON.stringify(body) : undefined });
        const buf = new Uint8Array(await res.arrayBuffer());
        // Bytes → binary string in 32 KB chunks; per-byte concatenation is quadratic and
        // the spread has an argument-count ceiling, both of which bite on multi-MB exports.
        let s = "";
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return { status: res.status, ct: res.headers.get("content-type") || "", b64: btoa(s) };
      },
      { method, url, body },
    );
    if (r.status < 200 || r.status >= 300) {
      const snip = Buffer.from(r.b64, "base64").toString("utf8").slice(0, 240);
      throw new Error(`NAT ${method} ${url} → ${r.status} (${r.ct}): ${snip}`);
    }
    return new Uint8Array(Buffer.from(r.b64, "base64"));
  }

  /** 統編s this login can act for. */
  async authorizedCompanies(): Promise<Array<{ ban: string; companyName: string; closed: boolean }>> {
    type Company = { ban: string; companyName: string; closed: boolean };
    return (await this.apiJson<Company[]>("GET", "https://service-m.einvoice.nat.gov.tw/btb/settings/api/btb002i/company/authorized")) ?? [];
  }

  /** Resolve the credential's 統編 against the companies this login may access. */
  async authorizedCompany(ban = this.loginBan): Promise<{ ban: string; companyName: string; closed: boolean }> {
    const companies = await this.authorizedCompanies();
    const company = companies.find((candidate) => candidate.ban === ban);
    if (!company) throw new Error(`NAT credential UBN ${ban} is not among this login's ${companies.length} authorized company record(s)`);
    return company;
  }

  /**
   * One page of the online invoice query (即時) for a single (invType, businessType) slice.
   * Returns `null` on HTTP 204 (no rows for these params). Prefer queryInvoices().
   */
  queryInvoicePage(opts: {
    ban: string;
    from: string; // YYYY-MM-DD (range ≤ 2 months)
    to: string;
    invType: InvType;
    businessType: BusinessType;
    invoiceNumberBegin?: string;
    invoiceNumberEnd?: string;
    page?: number;
    size?: number;
  }): Promise<NatPage<NatInvoiceRow> | null> {
    const qs = new URLSearchParams({
      invoiceDateBegin: iso(opts.from),
      invoiceDateEnd: iso(opts.to, true),
      companyBan: opts.ban,
      queryInvType: opts.invType,
      queryBusinessType: opts.businessType,
      invStatus: "0",
      invType: "00",
      showMessage: "true",
      page: String(opts.page ?? 0),
      size: String(opts.size ?? PAGE_SIZE),
    });
    // The SPA's own names (from its generated API client) are invoiceNumberBegin/End;
    // invoiceNumberStart/End (the UI model's names) make the query 204.
    if (opts.invoiceNumberBegin) qs.set("invoiceNumberBegin", opts.invoiceNumberBegin);
    if (opts.invoiceNumberEnd) qs.set("invoiceNumberEnd", opts.invoiceNumberEnd);
    return this.apiJson<NatPage<NatInvoiceRow>>("GET", `${API}/api/btb411w/invoice?${qs}`);
  }

  /**
   * Online invoice query (即時): every row in [from, to] (range ≤ 2 months), all pages, with
   * the business-type slices `invType` needs merged (see querySlices — 銷項 is queried as
   * B2B + B2C). `onSlice` reports each slice, including any that answered 204.
   * Optional `invoiceNumberBegin`/`End` filter by number (same 字軌, 10 chars each).
   */
  async queryInvoices(opts: {
    ban: string;
    from: string;
    to: string;
    invType: InvType;
    businessType?: BusinessType;
    invoiceNumberBegin?: string;
    invoiceNumberEnd?: string;
    onSlice?: (slice: QuerySlice) => void;
  }): Promise<NatInvoiceRow[]> {
    const out = new Map<string, NatInvoiceRow>();
    for (const slice of querySlices(opts.invType, opts.businessType)) {
      const { rows, noContent } = await fetchAllPages(
        (page) => this.queryInvoicePage({ ...opts, ...slice, page }),
        `NAT invoice query ${slice.invType}/${slice.businessType} ${opts.from}..${opts.to}`,
      );
      opts.onSlice?.({ ...slice, result: noContent ? "no-content" : "rows", totalElements: rows.length });
      for (const row of rows) out.set(`${row.sellerId}|${row.buyerId}|${row.invoiceNumber}|${row.invoiceDate}`, row);
    }
    return [...out.values()];
  }

  /**
   * Find invoices by number within [from, to] (any length; queried in ≤1-month windows).
   * A number can legitimately recur in a later 期別, hence an array.
   */
  async findInvoicesByNumber(opts: { ban: string; invoiceNumber: string; from: string; to: string; invType?: InvType }): Promise<NatInvoiceRow[]> {
    if (!/^[A-Z]{2}\d{8}$/.test(opts.invoiceNumber)) throw new Error(`not an invoice number: ${opts.invoiceNumber}`);
    // With a number filter the server does not confine hits to the date window (a 2022-07-01
    // invoice also came back for a 2022-06-28..30 window), so de-duplicate across windows.
    const found = new Map<string, NatInvoiceRow>();
    for (const ym of monthsBetween(opts.from, opts.to)) {
      const { from, to } = monthChunkRange(ym, opts.from, opts.to);
      const rows = await this.queryInvoices({
        ban: opts.ban,
        from,
        to,
        invType: opts.invType ?? "2",
        invoiceNumberBegin: opts.invoiceNumber,
        invoiceNumberEnd: opts.invoiceNumber,
      });
      for (const r of rows) if (r.invoiceNumber === opts.invoiceNumber) found.set(`${r.sellerId}|${r.buyerId}|${r.invoiceDate}`, r);
    }
    return [...found.values()];
  }

  /** Create a 非即時 (async) report job. Range ≤ 2 months. Returns the raw response. */
  createReportJob(opts: { ban: string; from: string; to: string; invType: InvType; fileType?: FileType }): Promise<unknown> {
    return this.apiJson("POST", `${API}/api/btb411w/reportJob/apply/xlsx`, {
      invStartDate: iso(opts.from),
      invEndDate: iso(opts.to, true),
      companyBan: [opts.ban],
      queryInvType: opts.invType,
      invStatus: "0",
      invType: "00",
      fileType: opts.fileType ?? "EXCEL",
      queryType: "I",
    }, { allowEmpty: true }); // success is a bare 200 (verified 2026-11-27)
  }

  /** List report jobs applied within [applyFrom, applyTo] (defaults: today). Decodes each token. */
  async listJobs(opts: { applyFrom?: string; applyTo?: string } = {}): Promise<ReportJob[]> {
    const today = (await this.page.evaluate(() => new Date().toISOString().slice(0, 10))) as string;
    return this.listReportJobs("btb411w", opts.applyFrom ?? today, opts.applyTo ?? today);
  }

  /**
   * List one screen's 非即時 jobs applied in [applyFrom, applyTo]: all pages, tokens decoded,
   * 204 = no jobs. `processStatus` is required — without it the API answers
   * `200 text/plain "Parameter validation failed."`; `A` = all statuses (the SPA default).
   */
  private async listReportJobs(screen: "btb411w" | "btb412w", applyFrom: string, applyTo: string): Promise<ReportJob[]> {
    const { rows } = await fetchAllPages((page) => {
      const qs = new URLSearchParams({
        queryApplyDateStart: iso(applyFrom),
        queryApplyDateEnd: iso(applyTo, true),
        processStatus: "A",
        showMessage: "true",
        page: String(page),
        size: String(PAGE_SIZE),
      });
      return this.apiJson<NatPage<{ token: string }>>("GET", `${API}/api/${screen}/reportJob/xlsx?${qs}`);
    }, `NAT ${screen} job list`);
    // spread decoded fields first, then the raw list token last (decoded has token:null)
    return rows.map((c) => ({ ...NatClient.decodeJobToken(c.token), token: c.token }) as ReportJob);
  }

  /** Download a completed job's file (XLSX/CSV bytes). Pass a job from listJobs(). */
  downloadJob(job: Pick<ReportJob, "token" | "jobType">): Promise<Uint8Array> {
    return this.apiBinary("POST", `${API}/api/btb411w/download/${job.jobType}`, { token: job.token });
  }

  /**
   * High-level: export every invoice in [from, to] as unified rows, regardless of
   * count. Splits the range into ≤1-month chunks, runs a 非即時 CSV job per chunk,
   * polls until done, downloads + parses the 財政部 M/D CSV. Returns one object per
   * invoice (M row, keyed by the Chinese headers) with its line items (`items`, D rows).
   * `onProgress(month, count)` fires per chunk.
   */
  async exportInvoices(opts: {
    ban: string;
    from: string; // YYYY-MM-DD
    to: string;
    invType: InvType;
    onProgress?: (month: string, invoiceCount: number) => void;
  }): Promise<NatInvoice[]> {
    const months = monthsBetween(opts.from, opts.to);
    const all: NatInvoice[] = [];
    for (const ym of months) {
      // Clamp each chunk to the requested interval so a mid-month range doesn't over-export.
      const { from, to } = monthChunkRange(ym, opts.from, opts.to);
      const stamp = Date.now();
      await this.createReportJob({ ban: opts.ban, from, to, invType: opts.invType, fileType: "CSV" });
      let job: ReportJob | undefined;
      for (let i = 0; i < 20 && !job; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const jobs = await this.listJobs();
        job = jobs
          .filter(
            (j) =>
              j.ban === opts.ban &&
              j.sellbuyType === opts.invType &&
              j.fileType === "CSV" &&
              j.status === "2" &&
              j.queryStartDate?.startsWith(ym) &&
              Date.parse(j.applyDate) >= stamp - 60_000,
          )
          .sort((a, b) => b.seqNo - a.seqNo)[0];
      }
      if (!job) throw new Error(`export: ${ym} job did not complete`);
      const invoices = Number(job.dataCount) > 0 ? NatClient.parseNatCsv(await this.downloadJob(job)) : [];
      // tag 進/銷 direction from the statutory 買方/賣方統編 (no explicit flag column exists):
      // 買方統編 == our ban → 進項 (we bought); 賣方統編 == our ban → 銷項 (we issued).
      for (const inv of invoices) {
        inv.direction = inv["買方統一編號"] === opts.ban ? "進項" : inv["賣方統一編號"] === opts.ban ? "銷項" : "其他";
      }
      const merged = dedupeNatInvoices([...all, ...invoices]);
      opts.onProgress?.(ym, merged.length - all.length);
      all.splice(0, all.length, ...merged);
    }
    return all;
  }

  /** Parse a 財政部 M/D-format CSV (UTF-8) into invoices (M) + their line items (D). */
  static parseNatCsv(bytes: Uint8Array): NatInvoice[] {
    const rows = parseCsv(new TextDecoder("utf-8").decode(bytes)).filter((row) => row.some((cell) => cell.length));
    const mHead = rows.find((r) => r[0] === "M");
    const dHead = rows.find((r) => r[0] === "D");
    if (!mHead) return [];
    const invoices: NatInvoice[] = [];
    let seenMHead = false;
    let seenDHead = false;
    for (const r of rows) {
      if (r[0] === "M") {
        if (!seenMHead) {
          seenMHead = true;
          continue;
        } // skip header
        const normalized = normalizeMasterRow(r, mHead);
        // A width we can't reconcile to the header means an unrecognized delimiter
        // corruption; mapping it would silently shift values into the wrong columns
        // (and misattribute the following D rows), so refuse rather than corrupt the archive.
        if (normalized.length !== mHead.length) {
          throw new Error(`NAT M row has ${normalized.length} columns, expected ${mHead.length} — unrecognized delimiter corruption`);
        }
        const inv: NatInvoice = { items: [] };
        for (let i = 1; i < mHead.length; i++) inv[mHead[i]] = normalized[i] ?? "";
        invoices.push(inv);
      } else if (r[0] === "D" && dHead) {
        if (!seenDHead) {
          seenDHead = true;
          continue;
        } // skip header
        // Same strict-width policy as M rows: a D row that doesn't line up with its
        // header would silently shift line-item values, so refuse rather than corrupt it.
        const d = normalizeDetailRow(r, dHead);
        if (d.length !== dHead.length) {
          throw new Error(`NAT D row has ${d.length} columns, expected ${dHead.length} — unrecognized delimiter corruption`);
        }
        const item: Record<string, string> = {};
        for (let i = 1; i < dHead.length; i++) item[dHead[i]] = d[i] ?? "";
        invoices[invoices.length - 1]?.items.push(item);
      }
    }
    return invoices;
  }

  // ---- 折讓單 (btb412w) — same job mechanics as invoices, allowance-dated ----

  /** Create a 非即時 折讓單 report job. `invType` 0=進銷/1=進/2=銷. Range ≤ 2 months. */
  createAllowanceJob(opts: { ban: string; from: string; to: string; invType: InvType; fileType?: FileType }): Promise<unknown> {
    return this.apiJson("POST", `${API}/api/btb412w/reportJob/apply/xlsx`, {
      allowanceStartDate: iso(opts.from),
      allowanceEndDate: iso(opts.to, true),
      companyBan: [opts.ban],
      queryInvType: opts.invType,
      alwStatus: "0",
      fileType: opts.fileType ?? "EXCEL",
      queryType: "A",
    }, { allowEmpty: true });
  }

  /** List 折讓 report jobs applied within [applyFrom, applyTo] (defaults today); decodes tokens. */
  async listAllowanceJobs(opts: { applyFrom?: string; applyTo?: string } = {}): Promise<ReportJob[]> {
    const today = (await this.page.evaluate(() => new Date().toISOString().slice(0, 10))) as string;
    return this.listReportJobs("btb412w", opts.applyFrom ?? today, opts.applyTo ?? today);
  }

  /** Download a completed 折讓 job's file. */
  downloadAllowanceJob(job: Pick<ReportJob, "token" | "jobType">): Promise<Uint8Array> {
    return this.apiBinary("POST", `${API}/api/btb412w/download/${job.jobType}`, { token: job.token });
  }

  /** Decode a job list token (JWT → base64 `data` → JSON). */
  static decodeJobToken(token: string): Omit<ReportJob, "token"> {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"));
    return JSON.parse(Buffer.from(payload.data, "base64").toString("utf8"));
  }

  close(): Promise<void> {
    return this.browser.close();
  }
}

// Demo CLI: bun run nat-client.ts [YYYY-MM]  (online 進項 count for a month)
if (import.meta.main) {
  const ym = process.argv[2] ?? "2026-08";
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const c = await NatClient.login();
  try {
    const company = await c.authorizedCompany();
    const ban = company.ban;
    console.log("logged in; company:", company.companyName, ban);
    const rows = await c.queryInvoices({ ban, from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}`, invType: "1" });
    console.log(`進項 ${ym}: ${rows.length} row(s) (online, all pages)`);
  } finally {
    await c.close();
  }
}

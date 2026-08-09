// Runtime-agnostic HTTP client for the ezPay 電子發票 加值中心 backend.
// Speaks the reverse-engineered `send_data_` protocol; no Bun/Node-only APIs, so
// it runs under Node (vitest + msw), Bun, or the browser. See EZPAY-BACKEND.md.
import {
  PROD_BASE,
  ezpayUrls,
  buildSendData,
  webBaseEncode,
  serializeEncode,
  formWorkEncode,
  invoiceQueryPairs,
  invoiceListQuery,
  printListQuery,
  monthRange,
  enumerateMonths,
  type InvoiceQuery,
  type PrintQuery,
} from "./lib.ts";

export class EzpayBackendError extends Error {
  constructor(
    message: string,
    readonly status: string,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = "EzpayBackendError";
  }
}

export interface EzpayBackendConfig {
  /** "https://inv.ezpay.com.tw/" (prod) or "https://cinv.ezpay.com.tw/" (test). */
  baseUrl?: string;
  ubn: string;
  account: string;
  password: string;
  /** Injected for tests / custom transports; defaults to global fetch. */
  fetch?: typeof fetch;
  /**
   * Optional captcha solver (bytes -> code). When omitted, login uses the
   * error-message leak: submit a dummy code, read `正確應為：XXXXX`, resubmit.
   */
  captchaSolver?: (png: Uint8Array) => Promise<string> | string;
}

export interface InvoiceListResult {
  status: string;
  count: number;
  page: number;
  nowPage: number;
  limit: number;
  rows: Array<Record<string, unknown>>;
}

export interface CsvResult {
  filename?: string;
  csv: string;
  empty: boolean;
}

export interface InvoiceDetail {
  issue: Record<string, unknown>;
  notify: Array<Record<string, unknown>>;
  allowance: Array<Record<string, unknown>>;
  invalid: Record<string, unknown> | "";
  raw: Record<string, unknown>;
}

export interface NotifyHistory {
  invoice: { invoiceNumber?: string; invoiceType?: string; Post_data?: string };
  notice: Array<Record<string, unknown>>;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function getSetCookies(res: Response): string[] {
  const h = res.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const one = res.headers.get("set-cookie");
  return one ? [one] : [];
}

export class EzpayBackendClient {
  private readonly urls: ReturnType<typeof ezpayUrls>;
  private readonly doFetch: typeof fetch;
  private readonly jar = new Map<string, string>();
  loggedIn = false;

  constructor(private readonly cfg: EzpayBackendConfig) {
    this.urls = ezpayUrls(cfg.baseUrl ?? PROD_BASE);
    this.doFetch = cfg.fetch ?? fetch;
  }

  /** Current cookie jar as a `Cookie:` header value. */
  cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /** Cookie jar as `[name, value]` pairs (e.g. to hand to Playwright). */
  cookiePairs(): Array<[string, string]> {
    return [...this.jar];
  }

  private absorb(res: Response): void {
    for (const c of getSetCookies(res)) {
      const m = c.match(/^([^=]+)=([^;]+)/);
      if (!m) continue;
      if (/expires=Thu, 01-Jan-1970/i.test(c) || /Max-Age=0/i.test(c)) this.jar.delete(m[1]);
      else this.jar.set(m[1], m[2]);
    }
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      "User-Agent": UA,
      Cookie: this.cookieHeader(),
      Referer: this.urls.loginPage,
      Origin: this.urls.origin,
      ...extra,
    };
  }

  /** POST `send_data_=<value>` form-urlencoded, absorbing cookies. */
  private async postSendData(url: string, sendData: string, extra?: Record<string, string>): Promise<Response> {
    const res = await this.doFetch(url, {
      method: "POST",
      redirect: "manual",
      headers: this.headers({ "Content-Type": "application/x-www-form-urlencoded", ...extra }),
      body: `send_data_=${sendData}`,
    });
    this.absorb(res);
    return res;
  }

  private async postJson(url: string, sendData: string): Promise<Record<string, unknown>> {
    const res = await this.postSendData(url, sendData, { "X-Requested-With": "XMLHttpRequest" });
    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new EzpayBackendError("non-JSON response", String(res.status), text.slice(0, 200));
    }
    if (json.status === "KEY10008") {
      this.loggedIn = false;
      throw new EzpayBackendError("session expired (KEY10008)", "KEY10008", json);
    }
    return json;
  }

  /** Fully-headless login (captcha-leak by default, or via `captchaSolver`). */
  async login(): Promise<void> {
    // 1) session cookie
    this.absorb(await this.doFetch(this.urls.loginPage, { headers: { "User-Agent": UA }, redirect: "manual" }));
    // 2) captcha (fixes the session code)
    const capRes = await this.doFetch(this.urls.captcha, { headers: this.headers() });
    this.absorb(capRes);

    const send = (code: string) =>
      buildSendData({
        LoginUBN: this.cfg.ubn,
        Account: this.cfg.account,
        Password: this.cfg.password,
        backUrl: "",
        CheckCode: code,
      });

    let code: string;
    if (this.cfg.captchaSolver) {
      code = await this.cfg.captchaSolver(new Uint8Array(await capRes.arrayBuffer()));
    } else {
      const probe = await this.postSendData(this.urls.loginCheck, send("00000"));
      const leak = (await probe.text()).match(/正確應為：([-_A-Za-z0-9]+)/);
      if (!leak) throw new EzpayBackendError("captcha not solved (no leak; provide captchaSolver)", "CAPTCHA");
      code = leak[1];
    }

    const res = await this.postSendData(this.urls.loginCheck, send(code));
    // Node/undici surfaces the real 302 (with Set-Cookie); a browser fetch with
    // redirect:"manual" surfaces an opaqueredirect (status 0). Accept both.
    const redirected = res.status === 302 || res.status === 303 || res.type === "opaqueredirect";
    if (!redirected) {
      const body = await res.text();
      const alert = body.match(/alert\("([^"]+)"/);
      throw new EzpayBackendError(alert ? alert[1] : `login failed (HTTP ${res.status})`, "LOGIN", body.slice(0, 200));
    }
    this.loggedIn = true;
  }

  /** One page of the invoice list. MOD10003 (查無資料) yields an empty result. */
  async searchInvoices(query: InvoiceQuery, nowPage = 1): Promise<InvoiceListResult> {
    const json = await this.postJson(this.urls.searchByDb, serializeEncode(invoiceListQuery(query, nowPage)));
    const status = String(json.status);
    if (status === "MOD10003") return { status, count: 0, page: 0, nowPage, limit: 0, rows: [] };
    if (status !== "SUCCESS") throw new EzpayBackendError(String(json.message ?? status), status, json);
    const r = (json.result ?? {}) as Record<string, unknown>;
    return {
      status,
      count: Number(r.InvoiceCount ?? 0),
      page: Number(r.Page ?? 0),
      nowPage: Number(r.NowPage ?? nowPage),
      limit: Number(r.Limit ?? 0),
      rows: (r.InvoiceData as Array<Record<string, unknown>>) ?? [],
    };
  }

  /** InvoiceCount for a (≤ 1 month) range, without pulling the rows. */
  async countInvoices(query: InvoiceQuery): Promise<number> {
    return (await this.searchInvoices(query, 1)).count;
  }

  /**
   * Per-month invoice counts from `fromYm` to `toYm` (inclusive, "YYYY-MM").
   * One request per month (the query window is capped at ~1 month). Each entry's
   * `status` is SUCCESS / MOD10003 (查無資料 → count 0) / the backend error code
   * (e.g. a lookback-limit rejection) — errors are recorded, not thrown, so a
   * long historical scan never aborts mid-way.
   */
  async monthlyStats(
    fromYm: string,
    toYm: string,
    opts: { invoiceStatus?: InvoiceQuery["invoiceStatus"]; onMonth?: (e: { month: string; count: number; status: string }) => void } = {},
  ): Promise<Array<{ month: string; count: number; status: string }>> {
    const out: Array<{ month: string; count: number; status: string }> = [];
    for (const ym of enumerateMonths(fromYm, toYm)) {
      const [start, end] = monthRange(ym);
      let entry: { month: string; count: number; status: string };
      try {
        const r = await this.searchInvoices({ startInvDate: start, endInvDate: end, invoiceStatus: opts.invoiceStatus }, 1);
        entry = { month: ym, count: r.count, status: r.status };
      } catch (e) {
        entry = { month: ym, count: 0, status: e instanceof EzpayBackendError ? e.status : "ERROR" };
      }
      out.push(entry);
      opts.onMonth?.(entry);
    }
    return out;
  }

  /** Every row of the list for a (≤ 1 month) range, following pagination. */
  async searchAllInvoices(query: InvoiceQuery): Promise<Array<Record<string, unknown>>> {
    const first = await this.searchInvoices(query, 1);
    const rows = [...first.rows];
    const pages = first.page || (first.limit ? Math.ceil(first.count / first.limit) : 1);
    for (let p = 2; p <= pages; p++) rows.push(...(await this.searchInvoices(query, p)).rows);
    return rows;
  }

  /** Bulk detail CSV for a (≤ 1 month) range — all rows in one response. */
  async exportCsv(query: InvoiceQuery): Promise<CsvResult> {
    const send = formWorkEncode([...invoiceQueryPairs(query), ["CsvType", "CSV"]]);
    const res = await this.postSendData(this.urls.searchCsv, send);
    const csv = new TextDecoder("utf-8").decode(new Uint8Array(await res.arrayBuffer()));
    const cd = res.headers.get("content-disposition") ?? "";
    const filename = cd.match(/filename=([^;]+)/)?.[1];
    const empty = /INV10017|Array\s*\(/.test(csv) || csv.split(/\r?\n/).filter((l) => l.trim()).length <= 1;
    return { filename, csv, empty };
  }

  /** Full detail for one invoice (Issue + Notify + Allowance + Invalid). */
  async getInvoiceDetail(postData: string): Promise<InvoiceDetail> {
    const json = await this.postJson(this.urls.detailByDb, webBaseEncode(`Post_data=${postData}`));
    if (json.status !== "SUCCESS") throw new EzpayBackendError(String(json.message ?? json.status), String(json.status), json);
    const r = (json.result ?? {}) as Record<string, unknown>;
    return {
      issue: (r.Issue as Record<string, unknown>) ?? {},
      notify: (r.Notify as Array<Record<string, unknown>>) ?? [],
      allowance: (r.Allowance as Array<Record<string, unknown>>) ?? [],
      invalid: (r.Invalid as Record<string, unknown>) ?? "",
      raw: r,
    };
  }

  /** Notification history for one invoice (did we email the buyer, and where). */
  async getNotifyHistory(postData: string): Promise<NotifyHistory> {
    const json = await this.postJson(this.urls.noticeByDb, webBaseEncode(`Post_data=${postData}`));
    if (json.status !== "SUCCESS") throw new EzpayBackendError(String(json.message ?? json.status), String(json.status), json);
    const r = (json.result ?? {}) as Record<string, unknown>;
    return {
      invoice: (r.invoice as NotifyHistory["invoice"]) ?? {},
      notice: (r.notice as Array<Record<string, unknown>>) ?? [],
    };
  }

  /** List printable invoices (列印電子發票 list, `invoice_print_by_db`). */
  async listPrintableInvoices(query: PrintQuery): Promise<{ count: number; page: number; rows: Array<Record<string, unknown>> }> {
    const json = await this.postJson(this.urls.printListByDb, serializeEncode(printListQuery(query)));
    const status = String(json.status);
    if (status === "MOD10003") return { count: 0, page: 0, rows: [] };
    if (status !== "SUCCESS") throw new EzpayBackendError(String(json.message ?? status), status, json);
    const r = (json.result ?? {}) as Record<string, unknown>;
    return { count: Number(r.InvoiceCount ?? 0), page: Number(r.Page ?? 0), rows: (r.InvoiceData as Array<Record<string, unknown>>) ?? [] };
  }

  /**
   * Download the 電子發票證明聯 as a **server-generated PDF** (TCPDF) for one or
   * more invoices, identified by their print-list `post_data` tokens (from
   * {@link listPrintableInvoices}). `memPw` (企業會員密碼) defaults to the login
   * password. Returns the raw PDF bytes.
   *
   * NOTE: printing marks the invoices 已列印 unless `noPrintMark` is set.
   */
  async printInvoicePdf(opts: {
    postDataTokens: string[];
    memPw?: string;
    printType?: "page" | "letter" | "b2b" | "printer";
    detail?: boolean;
    noPrintMark?: boolean;
  }): Promise<Uint8Array> {
    if (opts.postDataTokens.length === 0) throw new EzpayBackendError("no invoices to print", "VALIDATION");
    // 1) resolve the selected list tokens into a combined print token
    const selQuery = opts.postDataTokens.map((t) => `Postdata[]=${encodeURIComponent(t)}`).join("&");
    const resolved = await this.postJson(this.urls.printByDb, serializeEncode(selQuery));
    if (resolved.status !== "SUCCESS") throw new EzpayBackendError(String(resolved.message ?? resolved.status), String(resolved.status), resolved);
    const postData = String((resolved.result as Record<string, unknown>)?.PostData ?? "");
    if (!postData) throw new EzpayBackendError("print_by_db returned no PostData", "PROVIDER", resolved);

    // 2) generate the PDF (Post_data + printType + [detail] + [NoPrintMark] + MemPW)
    const form =
      `Post_data=${encodeURIComponent(postData)}` +
      `&printType=${opts.printType ?? "page"}` +
      (opts.detail === false ? "" : "&detail=YES") +
      (opts.noPrintMark ? "&NoPrintMark=1" : "") +
      `&MemPW=${encodeURIComponent(opts.memPw ?? this.cfg.password)}`;
    const res = await this.postSendData(this.urls.invoicePrint, webBaseEncode(form));
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A wrong MemPW returns an HTML error page (KEY10016) instead of a PDF.
    if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      const text = new TextDecoder("utf-8").decode(bytes);
      const code = text.match(/錯誤代碼：(KEY\d+)/)?.[1];
      throw new EzpayBackendError(code === "KEY10016" ? "wrong 企業會員密碼 (MemPW)" : "print did not return a PDF", code ?? "PRINT", text.slice(0, 200));
    }
    return bytes;
  }

  /**
   * Resend the invoice notification email (補發通知). STATE-CHANGING: this sends a
   * real email. `email` required (≤300 chars); `mobile` optional.
   */
  async resendNotification(postData: string, opts: { email: string; mobile?: string }): Promise<{ message: string }> {
    if (!opts.email) throw new EzpayBackendError("email required", "VALIDATION");
    if (opts.email.length > 300) throw new EzpayBackendError("email too long (>300)", "VALIDATION");
    const form =
      `BuyerMail=${encodeURIComponent(opts.email)}` +
      (opts.mobile ? `&BuyerMobile=${encodeURIComponent(opts.mobile)}` : "") +
      `&Post_data=${postData}`;
    const json = await this.postJson(this.urls.createNotice, webBaseEncode(form));
    if (json.status !== "SUCCESS") throw new EzpayBackendError(String(json.message ?? json.status), String(json.status), json);
    return { message: String(json.message ?? "") };
  }
}

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

const iso = (d: string, end = false) => `${d}T${end ? "23:59:59.999" : "00:00:00.000"}Z`;

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

export class NatClient {
  private constructor(
    readonly browser: Browser,
    readonly ctx: BrowserContext,
    readonly page: Page,
    readonly loginBan: string,
  ) {}

  /** Log in (automated captcha) and return a ready client. */
  static async login(): Promise<NatClient> {
    const s = await login();
    return new NatClient(s.browser, s.ctx, s.page, s.ban);
  }

  /** In-page fetch → JSON. Reads the Bearer token from sessionStorage each call. */
  private async apiJson<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
    const r = await this.page.evaluate(
      async ({ method, url, body }) => {
        const headers: Record<string, string> = { Authorization: `Bearer ${sessionStorage.getItem("token")}` };
        if (body !== undefined) headers["Content-Type"] = "application/json";
        const res = await fetch(url, { method, headers, credentials: "include", body: body !== undefined ? JSON.stringify(body) : undefined });
        return { status: res.status, text: await res.text() };
      },
      { method, url, body },
    );
    if (r.status < 200 || r.status >= 300) throw new Error(`NAT ${method} ${url} → ${r.status}: ${r.text.slice(0, 200)}`);
    return (r.text ? JSON.parse(r.text) : {}) as T;
  }

  /** In-page fetch → binary (base64 across the boundary). */
  private async apiBinary(method: "GET" | "POST", url: string, body?: unknown): Promise<Uint8Array> {
    const r = await this.page.evaluate(
      async ({ method, url, body }) => {
        const headers: Record<string, string> = { Authorization: `Bearer ${sessionStorage.getItem("token")}`, Accept: "application/octet-stream, */*" };
        if (body !== undefined) headers["Content-Type"] = "application/json";
        const res = await fetch(url, { method, headers, credentials: "include", body: body !== undefined ? JSON.stringify(body) : undefined });
        const buf = new Uint8Array(await res.arrayBuffer());
        let s = "";
        for (const b of buf) s += String.fromCharCode(b);
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
  authorizedCompanies(): Promise<Array<{ ban: string; companyName: string; closed: boolean }>> {
    return this.apiJson("GET", "https://service-m.einvoice.nat.gov.tw/btb/settings/api/btb002i/company/authorized");
  }

  /** Resolve the credential's 統編 against the companies this login may access. */
  async authorizedCompany(ban = this.loginBan): Promise<{ ban: string; companyName: string; closed: boolean }> {
    const companies = await this.authorizedCompanies();
    const company = companies.find((candidate) => candidate.ban === ban);
    if (!company) throw new Error(`NAT credential UBN ${ban} is not among this login's ${companies.length} authorized company record(s)`);
    return company;
  }

  /**
   * Online invoice query (即時). Returns up to **200** rows; throws none for empty.
   * Use a ≤1-month range so 進項 stays under 200; otherwise use the offline job.
   */
  async queryInvoices(opts: { ban: string; from: string; to: string; invType: InvType }): Promise<Array<Record<string, unknown>>> {
    const qs = new URLSearchParams({
      invoiceDateBegin: iso(opts.from),
      invoiceDateEnd: iso(opts.to, true),
      companyBan: opts.ban,
      queryInvType: opts.invType,
      queryBusinessType: "0",
      invStatus: "0",
      invType: "00",
      showMessage: "true",
    });
    const r = await this.apiJson<{ content?: Array<Record<string, unknown>> }>("GET", `${API}/api/btb411w/invoice?${qs}`);
    return r.content ?? [];
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
    });
  }

  /** List report jobs applied within [applyFrom, applyTo] (defaults: today). Decodes each token. */
  async listJobs(opts: { applyFrom?: string; applyTo?: string } = {}): Promise<ReportJob[]> {
    const today = (await this.page.evaluate(() => new Date().toISOString().slice(0, 10))) as string;
    const qs = new URLSearchParams({
      queryApplyDateStart: iso(opts.applyFrom ?? today),
      queryApplyDateEnd: iso(opts.applyTo ?? today, true),
      showMessage: "true",
      page: "0",
      size: "500",
    });
    const r = await this.apiJson<{ content?: Array<{ token: string }> }>("GET", `${API}/api/btb411w/reportJob/xlsx?${qs}`);
    // spread decoded fields first, then the raw list token last (decoded has token:null)
    return (r.content ?? []).map((c) => ({ ...NatClient.decodeJobToken(c.token), token: c.token }) as ReportJob);
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
      const [y, m] = ym.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const from = `${ym}-01`;
      const to = `${ym}-${String(last).padStart(2, "0")}`;
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
        if (r.length !== dHead.length) {
          throw new Error(`NAT D row has ${r.length} columns, expected ${dHead.length} — unrecognized delimiter corruption`);
        }
        const item: Record<string, string> = {};
        for (let i = 1; i < dHead.length; i++) item[dHead[i]] = r[i] ?? "";
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
    });
  }

  /** List 折讓 report jobs applied within [applyFrom, applyTo] (defaults today); decodes tokens. */
  async listAllowanceJobs(opts: { applyFrom?: string; applyTo?: string } = {}): Promise<ReportJob[]> {
    const today = (await this.page.evaluate(() => new Date().toISOString().slice(0, 10))) as string;
    const qs = new URLSearchParams({
      queryApplyDateStart: iso(opts.applyFrom ?? today),
      queryApplyDateEnd: iso(opts.applyTo ?? today, true),
      showMessage: "true",
      page: "0",
      size: "500", // return all of today's jobs, not just page 1 (else a completed job can be hidden)
    });
    const r = await this.apiJson<{ content?: Array<{ token: string }> }>("GET", `${API}/api/btb412w/reportJob/xlsx?${qs}`);
    return (r.content ?? []).map((c) => ({ ...NatClient.decodeJobToken(c.token), token: c.token }) as ReportJob);
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
    console.log(`進項 ${ym}: ${rows.length} row(s) (online, ≤200)`);
  } finally {
    await c.close();
  }
}

// Reverse-engineered ezPay backend login helpers.
// Source: https://inv.ezpay.com.tw/js/general_function.js (formWork + web_base_encode)
// and /js/login.js (login_company).

export const PROD_BASE = "https://inv.ezpay.com.tw/";
export const CINV_BASE = "https://cinv.ezpay.com.tw/";

// Back-compat prod constants (used by the standalone explore/live scripts).
export const BASE = PROD_BASE;
export const LOGIN_PAGE = `${BASE}main/Login_center/single_login`;
export const LOGIN_CHECK = `${BASE}main/Login_center/single_login_check`;
export const CAPTCHA = `${BASE}main/Login_center/captcha_img_com`;

/** All backend URLs for a given base (prod `inv.` or test `cinv.`). */
export function ezpayUrls(base: string) {
  const b = base.endsWith("/") ? base : base + "/";
  return {
    base: b,
    origin: b.slice(0, -1),
    loginPage: `${b}main/Login_center/single_login`,
    loginCheck: `${b}main/Login_center/single_login_check`,
    captcha: `${b}main/Login_center/captcha_img_com`,
    searchByDb: `${b}Invoice_issue_ajax/search_invoice_by_db`,
    searchCsv: `${b}Invoice_issue/search_invoice_by_csv`,
    detailByDb: `${b}Invoice_issue_ajax/search_invoice_detail_by_db`,
    noticeByDb: `${b}Invoice_notice_ajax/get_invoice_notice_by_db`,
    createNotice: `${b}Invoice_notice_ajax/create_notice_by_db`,
    printListByDb: `${b}Invoice_search_ajax/invoice_print_by_db`,
    printByDb: `${b}Invoice_search_ajax/print_by_db`,
    invoicePrint: `${b}invoice_addition/Invoice_print`,
  };
}

/** Filters for the 列印電子發票 list (`invoice_print_by_db`). */
export interface PrintQuery {
  startInvDate: string;
  endInvDate: string;
  merchantId?: string;
  invoiceNumber?: string;
  invoiceType?: "" | "B2B" | "B2C";
  printMark?: "" | "0" | "1"; // ""=any, 0=未列印, 1=已列印
  pageLimit?: "10" | "50" | "100";
  nowPage?: number;
  sort?: "desc" | "asc";
}

/** `serialize(#print_search)`-equivalent query string for `invoice_print_by_db`. */
export function printListQuery(q: PrintQuery): string {
  const pairs: Array<[string, string]> = [
    ["NowPage", String(q.nowPage ?? 1)],
    ["Sort", q.sort ?? "desc"],
    ["MerchantID", q.merchantId ?? ""],
    ["InvoiceNumber", q.invoiceNumber ?? ""],
    ["StartInvDate", q.startInvDate],
    ["EndInvDate", q.endInvDate],
    ["PrintMark", q.printMark ?? ""],
    ["InvoiceType", q.invoiceType ?? ""],
    ["PageLimit", q.pageLimit ?? "10"],
  ];
  return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

/** The 10 `.search_data` filters shared by the AJAX list and the CSV export. */
export interface InvoiceQuery {
  webType?: string;
  invoiceType?: "" | "1" | "2"; // ""=any, 1=B2B, 2=B2C
  carruerType?: "" | "0" | "1" | "2";
  searchItem?: "" | "InvoiceNum" | "BuyerID" | "BuyerName" | "CustomNum" | "MerID" | "P2gNum" | "CarruerNum";
  searchWord?: string;
  invDateType?: "1" | "2"; // 1=開立日期, 2=預約日期
  startInvDate: string; // YYYY-MM-DD
  endInvDate: string;
  uploadStatus?: "" | "0" | "1" | "2" | "3" | "4";
  invoiceStatus?: "" | "0" | "1" | "2" | "3";
}

/** Field/value pairs in DOM order for the `.search_data` set (no CsvType). */
export function invoiceQueryPairs(q: InvoiceQuery): Array<[string, string]> {
  return [
    ["WebType", q.webType ?? ""],
    ["InvoiceType", q.invoiceType ?? ""],
    ["CarruerType", q.carruerType ?? ""],
    ["SearchItem", q.searchItem ?? ""],
    ["SearchWord", q.searchWord ?? ""],
    ["InvDateType", q.invDateType ?? "1"],
    ["StartInvDate", q.startInvDate],
    ["EndInvDate", q.endInvDate],
    ["UploadStatus", q.uploadStatus ?? ""],
    ["InvoiceStatus", q.invoiceStatus ?? ""],
  ];
}

/** jQuery-`serialize()`-equivalent query string for the AJAX list (adds NowPage). */
export function invoiceListQuery(q: InvoiceQuery, nowPage: number): string {
  const pairs = invoiceQueryPairs(q);
  // The page serializes the whole #searchinvoice form: a leading empty NowPage
  // hidden field, then the filters, then send_search_invoice appends &NowPage=n.
  const body = [["WebType", pairs[0][1]], ["NowPage", ""], ...pairs.slice(1)]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `${body}&NowPage=${nowPage}`;
}

/**
 * Mirror of general_function.js `web_base_encode`:
 *   e = encodeURIComponent(s); for each char -> charCodeAt().toString(16) concatenated.
 * All post-encodeURIComponent chars are ASCII printable (0x21-0x7e), so every char
 * yields exactly 2 hex digits. We DO NOT zero-pad because the source doesn't; it is
 * safe here only because no char code is < 0x10.
 */
export function webBaseEncode(s: string): string {
  const e = encodeURIComponent(s);
  let v = "";
  for (let i = 0; i < e.length; i++) {
    v += e.charCodeAt(i).toString(16);
  }
  return v;
}

/** Inverse, for sanity-checking round-trips. */
export function webBaseDecode(hex: string): string {
  let s = "";
  for (let i = 0; i < hex.length; i += 2) {
    s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return decodeURIComponent(s);
}

/**
 * Build the `send_data_` value exactly as formWork does for the `.login_data`
 * fields, in DOM order: LoginUBN, Account, Password, backUrl, CheckCode.
 * Each value is individually encodeURIComponent'd, joined with `&` as
 * `name=value`, then the whole string is web_base_encode'd.
 */
export function buildSendData(f: {
  LoginUBN: string;
  Account: string;
  Password: string;
  backUrl?: string;
  CheckCode: string;
}): string {
  const enc = (v: string) => encodeURIComponent(v);
  const str =
    `LoginUBN=${enc(f.LoginUBN)}` +
    `&Account=${enc(f.Account)}` +
    `&Password=${enc(f.Password)}` +
    `&backUrl=${enc(f.backUrl ?? "")}` +
    `&CheckCode=${enc(f.CheckCode)}`;
  return webBaseEncode(str);
}

/**
 * Replicate general_function.js `formWork`'s payload construction for a set of
 * name/value pairs (DOM order): join `name=encodeURIComponent(value)` with `&`,
 * then web_base_encode the whole string. Returns the `send_data_` value.
 * Used by the CSV export (`search_invoice_by_csv`) and any formWork-based POST.
 */
export function formWorkEncode(pairs: Array<[string, string]>): string {
  const str = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return webBaseEncode(str);
}

/**
 * Replicate the `$(form).serialize()`-based encoding used by
 * `send_search_invoice`: the caller passes an already url-encoded query string
 * (as jQuery.serialize produces), which is then web_base_encode'd wholesale.
 */
export function serializeEncode(query: string): string {
  return webBaseEncode(query);
}

/** `"YYYY-MM"` → `["YYYY-MM-01", "YYYY-MM-<lastday>"]` (a whole-month range). */
export function monthRange(ym: string): [string, string] {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, "0")}`];
}

/** Inclusive list of `"YYYY-MM"` from `fromYm` to `toYm` (ascending). */
export function enumerateMonths(fromYm: string, toYm: string): string[] {
  const [fy, fm] = fromYm.split("-").map(Number);
  const [ty, tm] = toYm.split("-").map(Number);
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

/** Extract the PHPSESSID value from an array of Set-Cookie header strings. */
export function extractPhpSessId(setCookies: string[]): string | undefined {
  for (const c of setCookies) {
    const m = c.match(/PHPSESSID=([^;]+)/);
    if (m) return m[1];
  }
  return undefined;
}

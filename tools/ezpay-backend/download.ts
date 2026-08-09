// Bulk monthly invoice-detail CSV downloader for the ezPay backend.
//
//   bun run download.ts 2025-12                 # one month
//   bun run download.ts 2025-01 2025-12         # inclusive month range
//   bun run download.ts 2025-12 --mer 10000001  # filter to one store (MerID)
//   bun run download.ts 2025-12 --out ./out     # choose the output dir
//
// Logs in once (headless, captcha-leak), then exports search_invoice_by_csv per
// month via the runtime-agnostic client. Writes ./out/ezpay_<UBN>_<YYYY-MM>.csv,
// skips empty months, prints a summary. Credentials come from 1Password (item
// $EZPAY_OP_ITEM, via `op`) or the EZPAY_UBN / EZPAY_ACCOUNT / EZPAY_PASSWORD env.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { PROD_BASE, enumerateMonths, monthRange } from "./lib.ts";
import { EzpayBackendClient } from "./client.ts";
import { getCreds, PROD } from "./creds.ts";

const args = process.argv.slice(2);
const merIdx = args.indexOf("--mer");
const merId = merIdx >= 0 ? args[merIdx + 1] : "";
const outIdx = args.indexOf("--out");
const outArg = outIdx >= 0 ? args[outIdx + 1] : "";
const months = args.filter((a) => /^\d{4}-\d{2}$/.test(a));
if (months.length === 0) {
  console.error("usage: bun run download.ts <YYYY-MM> [YYYY-MM] [--mer <MerID>] [--out <dir>]");
  process.exit(1);
}
const list = months.length === 1 ? months : enumerateMonths(months[0], months[months.length - 1]);

// Prefer explicit env; only fall back to 1Password (`op`) if a field is missing,
// so a fully-env run needs neither `op` nor a cached secrets.json.
const env = process.env;
const creds =
  env.EZPAY_UBN && env.EZPAY_ACCOUNT && env.EZPAY_PASSWORD
    ? { ubn: env.EZPAY_UBN, account: env.EZPAY_ACCOUNT, password: env.EZPAY_PASSWORD }
    : getCreds(PROD);
const ubn = env.EZPAY_UBN || creds.ubn;
const client = new EzpayBackendClient({
  baseUrl: PROD_BASE,
  ubn,
  account: env.EZPAY_ACCOUNT || creds.account,
  password: env.EZPAY_PASSWORD || creds.password,
});
await client.login();

const OUT = outArg ? (outArg.endsWith("/") ? outArg : outArg + "/") : new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
console.log(`logged in UBN ${ubn}; ${list.length} month(s)${merId ? `, store ${merId}` : ""}\n`);

const summary: Array<{ month: string; rows: number; bytes: number }> = [];
function writePrivateAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, path);
}
for (const ym of list) {
  const [start, end] = monthRange(ym);
  const { csv, empty } = await client.exportCsv({
    startInvDate: start,
    endInvDate: end,
    searchItem: merId ? "MerID" : "",
    searchWord: merId,
  });
  if (empty) {
    console.log(`${ym}  — no data`);
    summary.push({ month: ym, rows: 0, bytes: 0 });
    continue;
  }
  const rows = csv.split(/\r?\n/).filter((l) => l.trim().length > 0).length - 1; // minus header
  const file = `${OUT}ezpay_${ubn}${merId ? `_${merId}` : ""}_${ym}.csv`;
  writePrivateAtomic(file, csv);
  console.log(`${ym}  ${rows} rows  ${(csv.length / 1024).toFixed(0)} KB  -> ${file}`);
  summary.push({ month: ym, rows, bytes: csv.length });
}

const total = summary.reduce((s, r) => s + r.rows, 0);
console.log(`\ntotal ${total} rows across ${summary.filter((r) => r.rows).length}/${list.length} month(s)`);

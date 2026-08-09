// nat-verify — spot-verify individual invoices against the 財政部 platform (the
// statutory source of truth), so a gateway export / local DB row can be checked
// against what the MoF actually holds (status, amounts, parties, transmitter).
//
// Uses a 非即時 CSV job per invoice with invNoStart==invNoEnd==發票號碼 — the online
// (即時) query only serves the current month, but the offline job reaches any
// archived month and its invNo filter is verified live.
//
// Usage:
//   bun run nat-verify.ts <range> <發票號碼...> [--in] [--json]
//   <range> = YYYY-MM | YYYY-MM..YYYY-MM   發票日期 window to search (chunked ≤2 months)
//   --in    = the invoices are 進項 (we are the buyer); default is 銷項
//
// Example (the case class that motivated this tool — a gateway export that kept a
// stale un-voided state while the MoF shows 作廢已確認, plus its replacement):
//   bun run nat-verify.ts 2024-06..2024-07 AB12345678 CD23456789
import { NatClient, type InvType, type NatInvoice, type ReportJob } from "./nat-client.ts";

const SUMMARY_KEYS = ["發票狀態", "發票日期", "總計", "買方統一編號", "買方名稱", "賣方統一編號", "傳送方名稱", "最後異動時間"] as const;

export function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

function monthsBetween(fromYm: string, toYm: string): string[] {
  const [fy, fm] = fromYm.split("-").map(Number);
  const [ty, tm] = toYm.split("-").map(Number);
  const out: string[] = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? ((m = 1), y++) : m++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

/** ≤2-month [from,to] chunks covering the range (the job API's range limit). */
export function chunkRange(arg: string): Array<{ from: string; to: string }> {
  const m = arg.match(/^(\d{4}-\d{2})(?:\.\.(\d{4}-\d{2}))?$/);
  if (!m) throw new Error(`bad range "${arg}" — expected YYYY-MM or YYYY-MM..YYYY-MM`);
  const [fromYm, toYm] = [m[1], m[2] ?? m[1]];
  // Guard against silent empties: a month out of 01-12 or a reversed range would
  // yield zero chunks and make every invoice read as "not found on the platform".
  for (const ym of [fromYm, toYm]) {
    const month = Number(ym.slice(5));
    if (month < 1 || month > 12) throw new Error(`bad range "${arg}" — month ${ym} is not 01-12`);
  }
  if (toYm < fromYm) throw new Error(`bad range "${arg}" — start ${fromYm} is after end ${toYm}`);
  const months = monthsBetween(fromYm, toYm);
  const chunks: Array<{ from: string; to: string }> = [];
  for (let i = 0; i < months.length; i += 2) {
    const last = months[Math.min(i + 1, months.length - 1)];
    chunks.push({ from: `${months[i]}-01`, to: monthEnd(last) });
  }
  return chunks;
}

/**
 * Run one single-invoice job and return its parsed M/D invoices (empty when absent).
 * `minSeqNo` fences off earlier jobs from the same run: consecutive jobs can share
 * month + applyDate window, and seqNo is the only strictly increasing discriminator.
 */
async function runInvoiceJob(
  client: NatClient,
  opts: { ban: string; from: string; to: string; invType: InvType; invNo: string; minSeqNo: number },
): Promise<{ invoices: NatInvoice[]; seqNo: number }> {
  const stamp = Date.now();
  await client.createReportJob({ ...opts, fileType: "CSV", invNoStart: opts.invNo, invNoEnd: opts.invNo });
  let job: ReportJob | undefined;
  for (let i = 0; i < 40 && !job; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const jobs = await client.listJobs();
    job = jobs
      .filter(
        (j) =>
          j.ban === opts.ban &&
          j.sellbuyType === opts.invType &&
          j.fileType === "CSV" &&
          j.status === "2" &&
          j.seqNo > opts.minSeqNo &&
          j.queryStartDate?.startsWith(opts.from.slice(0, 7)) &&
          j.queryEndDate?.startsWith(opts.to.slice(0, 7)) &&
          Date.parse(j.applyDate) >= stamp - 60_000,
      )
      .sort((a, b) => b.seqNo - a.seqNo)[0];
  }
  if (!job) throw new Error(`verify job for ${opts.invNo} (${opts.from}..${opts.to}) did not complete`);
  const invoices = Number(job.dataCount) > 0 ? NatClient.parseNatCsv(await client.downloadJob(job)) : [];
  return { invoices, seqNo: job.seqNo };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const invType: InvType = args.includes("--in") ? "1" : "2";
  const [range, ...invNos] = args.filter((a) => !a.startsWith("--"));
  if (!range || !invNos.length) {
    console.error("usage: bun run nat-verify.ts <YYYY-MM[..YYYY-MM]> <發票號碼...> [--in] [--json]");
    process.exit(2);
  }
  const chunks = chunkRange(range);
  const client = await NatClient.login();
  try {
    const { ban } = await client.authorizedCompany();
    let missing = 0;
    let minSeqNo = 0;
    for (const invNo of invNos) {
      const hits: NatInvoice[] = [];
      for (const { from, to } of chunks) {
        const r = await runInvoiceJob(client, { ban, from, to, invType, invNo, minSeqNo });
        minSeqNo = Math.max(minSeqNo, r.seqNo);
        hits.push(...r.invoices);
      }
      if (!hits.length) {
        missing++;
        console.log(`✗ ${invNo}: not found on the MoF platform in ${range} (${invType === "1" ? "進項" : "銷項"})`);
        continue;
      }
      for (const hit of hits) {
        if (json) {
          console.log(JSON.stringify({ query: invNo, ...hit }));
        } else {
          const parts = SUMMARY_KEYS.map((k) => (hit[k] ? `${k}=${hit[k]}` : null)).filter(Boolean);
          console.log(`✓ ${invNo}: ${parts.join("  ")}  品項=${hit.items.length}`);
        }
      }
    }
    process.exit(missing ? 1 : 0);
  } finally {
    await client.close();
  }
}

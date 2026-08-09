// Export the full reachable NAT history (進+銷, queryInvType=0) as the government's
// native CSV, one file per month, resumable. Range defaults to 2020-02 → current month.
//   NAT_OP_ITEM='<your 1Password item>' bun run nat-export-history.ts [fromYm] [toYm]
//   OUTDIR=/path/to/dir  overrides the output directory (default ./out/nat-history).
import { mkdirSync, writeFileSync, existsSync, statSync, renameSync, rmSync, chmodSync } from "node:fs";
import { NatClient, isMonthFinal } from "./nat-client.ts";

const fromYm = process.argv[2] ?? "2020-02";
// Resolve "current month" in Asia/Taipei (the portal's zone), not the host's, so a
// non-Taipei runner near a month boundary doesn't target the wrong month.
const currentYm = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }).slice(0, 7);
const toYm = process.argv[3] ?? currentYm;
const OUTDIR = process.env.OUTDIR ?? "./out/nat-history";
mkdirSync(OUTDIR, { recursive: true });

if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fromYm) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(toYm) || fromYm > toYm || toYm > currentYm) {
  throw new Error(`invalid month range: ${fromYm}..${toYm} (current month is ${currentYm})`);
}

function writePrivateAtomic(path: string, data: string | Uint8Array): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, path);
}

// Clear the provisional `.open` marker once a month has been refreshed after it closed.
// (The marker is written up-front, before a current-month fetch, so a crash mid-fetch
// can't leave the archive looking final.) Only ever removed for a closed month.
function finalizeOpenMarker(openPath: string, isCurrent: boolean): void {
  if (!isCurrent && existsSync(openPath)) rmSync(openPath);
}

function months(a: string, b: string): string[] {
  const [fy, fm] = a.split("-").map(Number); const [ty, tm] = b.split("-").map(Number);
  const r: string[] = []; let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) { r.push(`${y}-${String(m).padStart(2, "0")}`); if (++m > 12) { m = 1; y++; } }
  return r;
}

const client = await NatClient.login();
try {
  const ban = (await client.authorizedCompany()).ban;
  console.log(`logged in ${ban}; exporting native CSV ${fromYm}..${toYm} → ${OUTDIR}\n`);
  let done = 0, skipped = 0, failed = 0;
  for (const ym of months(fromYm, toYm)) {
    const out = `${OUTDIR}/nat_${ban}_${ym}.csv`;
    const empty = `${out}.empty`;
    const open = `${out}.open`;
    if (existsSync(out)) chmodSync(out, 0o600); // tighten perms on files left by an earlier (pre-0600) run
    // Final only once fetched after the month closed; the current month and any archive
    // taken while the month was open are always re-fetched (see isMonthFinal).
    const hasData = existsSync(out) && statSync(out).size > 0;
    if (isMonthFinal({ hasData, hasEmpty: existsSync(empty), hasOpen: existsSync(open), isCurrent: ym === currentYm })) { console.log(`${ym}  (skip, final)`); skipped++; continue; }
    if (ym === currentYm) writePrivateAtomic(open, "open\n"); // provisional up-front: a crash mid-fetch must not look final
    const [y, m] = ym.split("-").map(Number);
    const to = `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    const stamp = Date.now();
    try {
      await client.createReportJob({ ban, from: `${ym}-01`, to, invType: "0", fileType: "CSV" });
      let job;
      for (let i = 0; i < 60 && !job; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        job = (await client.listJobs())
          .filter((j) => j.ban === ban && j.fileType === "CSV" && j.status === "2" && j.sellbuyType === "0" && j.queryStartDate?.startsWith(ym) && Date.parse(j.applyDate) >= stamp - 120_000)
          .sort((a, b) => b.seqNo - a.seqNo)[0];
      }
      if (!job) { console.log(`${ym}  ⚠️ job not ready (timeout)`); failed++; continue; }
      if (Number(job.dataCount) === 0) {
        writePrivateAtomic(empty, `no invoices for ${ym}\n`);
        if (existsSync(out)) rmSync(out); // drop a stale data file if this month is now empty
        finalizeOpenMarker(open, ym === currentYm);
        console.log(`${ym}  (empty)`);
        done++;
        continue;
      }
      const bytes = await client.downloadJob(job);
      if (bytes.length === 0) throw new Error("download returned an empty file");
      writePrivateAtomic(out, bytes);
      if (existsSync(empty)) rmSync(empty); // month now has data — drop the stale empty marker
      finalizeOpenMarker(open, ym === currentYm);
      console.log(`${ym}  M+D=${job.dataCount}  ${(bytes.length / 1024).toFixed(0)}KB  -> ${out.split("/").pop()}`);
      done++;
    } catch (e) {
      console.log(`${ym}  ERROR ${(e as Error).message?.slice(0, 90)}`);
      failed++;
    }
  }
  console.log(`\nDONE: ${done} downloaded, ${skipped} skipped, ${failed} failed. Dir: ${OUTDIR}`);
  if (failed > 0) process.exitCode = 1; // surface partial failure to unattended/scheduled callers
} finally {
  await client.close();
}

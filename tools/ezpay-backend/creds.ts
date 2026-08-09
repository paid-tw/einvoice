// Bun-only helper: fetch backend login credentials from 1Password via `op`.
// Not imported by client.ts (which stays runtime-agnostic) — only by live scripts.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

export interface Creds {
  ubn: string;
  account: string;
  password: string;
}

interface OpItem {
  item: string;
  ubnLabel: string; // prod: "ubn"; cinv: "LoginUBN"
  cacheFile: string;
}

// 1Password item names are site-specific — set them via env so no real item name
// is baked into the source. `ubnLabel` is the field holding the 統一編號.
export const PROD: OpItem = { item: process.env.EZPAY_OP_ITEM || "ezpay-backend", ubnLabel: "ubn", cacheFile: "secrets.json" };
export const CINV: OpItem = { item: process.env.EZPAY_CINV_OP_ITEM || "ezpay-backend-test", ubnLabel: "LoginUBN", cacheFile: "secrets.cinv.json" };

export function getCreds(target: OpItem = PROD): Creds {
  const cache = new URL(`./${target.cacheFile}`, import.meta.url).pathname;
  if (existsSync(cache)) {
    chmodSync(cache, 0o600);
    const creds = JSON.parse(readFileSync(cache, "utf8")) as Creds;
    if (!creds.ubn || !creds.account || !creds.password) throw new Error(`${cache} is missing a credential field`);
    return creds;
  }
  const p = Bun.spawnSync([
    "op",
    "item",
    "get",
    target.item,
    "--fields",
    `label=${target.ubnLabel},label=username,label=password`,
    "--reveal",
    "--format",
    "json",
  ]);
  if (p.exitCode !== 0) throw new Error(`op failed: ${p.stderr.toString()}`);
  const fields = JSON.parse(p.stdout.toString()) as Array<{ label: string; value: string }>;
  const get = (l: string) => fields.find((f) => f.label === l)?.value ?? "";
  const creds = { ubn: get(target.ubnLabel), account: get("username"), password: get("password") };
  if (!creds.ubn || !creds.account || !creds.password) throw new Error("missing a credential field");
  writeFileSync(cache, JSON.stringify(creds), { mode: 0o600 }); // cache (gitignored) to avoid repeat biometric prompts
  return creds;
}

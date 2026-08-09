// Reusable NAT business login → returns an authenticated Playwright page.
// Captcha solved headlessly (onnxruntime-web + jimp + ddddocr); retries on reject.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { Jimp } from "jimp";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { classify } from "./ocr.ts";
import { digitsOnly } from "./lib/captcha.ts";

const DASH = "https://www.einvoice.nat.gov.tw/dashboard/btb/btb411w/online";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Which 1Password item to read (fields: 統一編號, user_id, user_password).
// Set NAT_OP_ITEM to your own item; override it to switch between accounts.
const OP_ITEM = process.env.NAT_OP_ITEM || "nat-einvoice";

export interface NatCredentials {
  ban: string;
  customId: string;
  password: string;
}

function assertCreds(creds: NatCredentials, source: string): NatCredentials {
  const missing = Object.entries(creds).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`${source} is missing credential field(s): ${missing.join(", ")}`);
  return creds;
}

export function natCreds(): NatCredentials {
  const env = {
    ban: process.env.NAT_UBN ?? "",
    customId: process.env.NAT_USER_ID ?? "",
    password: process.env.NAT_PASSWORD ?? "",
  };
  const envCount = Object.values(env).filter(Boolean).length;
  if (envCount === 3) return env;
  if (envCount > 0) return assertCreds(env, "NAT environment");

  const slug = OP_ITEM.replace(/[^A-Za-z0-9]+/g, "-").slice(-24);
  const cache = new URL(`./secrets.nat-${slug}.json`, import.meta.url).pathname;
  if (existsSync(cache)) {
    chmodSync(cache, 0o600);
    return assertCreds(JSON.parse(readFileSync(cache, "utf8")) as NatCredentials, cache);
  }
  const p = Bun.spawnSync(["op", "item", "get", OP_ITEM, "--fields", "label=統一編號,label=user_id,label=user_password", "--reveal", "--format", "json"]);
  if (p.exitCode !== 0) throw new Error("op failed: " + p.stderr.toString());
  const f = JSON.parse(p.stdout.toString()) as Array<{ label: string; value: string }>;
  const g = (l: string) => f.find((x) => x.label === l)?.value ?? "";
  const c = assertCreds({ ban: g("統一編號"), customId: g("user_id"), password: g("user_password") }, `1Password item ${OP_ITEM}`);
  writeFileSync(cache, JSON.stringify(c), { mode: 0o600 });
  return c;
}

async function ocrBase64(image: string): Promise<string> {
  const img = await Jimp.read(Buffer.from(image, "base64"));
  const bg = new Jimp({ width: img.width, height: img.height, color: 0xffffffff });
  bg.composite(img, 0, 0);
  return digitsOnly(await classify(await bg.getBuffer("image/png")));
}

export interface NatSession {
  browser: Browser;
  ctx: BrowserContext;
  page: Page;
  jwt: string;
  ban: string;
}

export async function login(): Promise<NatSession> {
  const creds = natCreds();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();

  let latestCaptcha: { token: string; image: string } | null = null;
  page.on("response", async (r) => {
    if (/act\/login\/api\/act002i\/captcha$/.test(r.url())) {
      try {
        latestCaptcha = (await r.json()) as { token: string; image: string };
      } catch {}
    }
  });

  await page.goto(DASH, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.getByText("營業人").first().click({ timeout: 10000 });
  await page.waitForTimeout(2000);
  await page.fill("#ban", creds.ban);
  await page.fill("#user_id", creds.customId);
  await page.fill("#user_password", creds.password);

  const onLogin = () => /\/accounts\/login/.test(page.url());
  let ok = false;
  for (let attempt = 1; attempt <= 8 && !ok; attempt++) {
    if (!onLogin()) { ok = true; break; } // already navigated off the login page → success
    if (!(await page.locator("#captcha").count().catch(() => 0))) { ok = true; break; }
    let code = latestCaptcha ? await ocrBase64(latestCaptcha.image) : "";
    let refresh = 0;
    while (code.length !== 5 && refresh < 5) {
      await page.locator(".btn-refresh, img[alt='圖形驗證碼']").first().click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(900);
      code = latestCaptcha ? await ocrBase64(latestCaptcha.image) : "";
      refresh++;
    }
    await page.fill("#captcha", code).catch(() => {});
    await page.getByRole("button", { name: /^登入$/ }).first().click({ timeout: 8000 }).catch(() => {});
    // wait for the OAuth redirect to actually leave the login page (up to 15s),
    // instead of a fixed sleep that races the consent navigation
    await page.waitForURL((url) => !/\/accounts\/login/.test(String(url)), { timeout: 15000 }).catch(() => {});
    if (!onLogin()) ok = true;
  }
  if (!ok) {
    await browser.close();
    throw new Error("NAT login failed after retries");
  }
  await page.goto(DASH, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  // The SPA writes the JWT to sessionStorage a moment after the dashboard loads, so poll
  // for it (up to ~20s) rather than reading once after a fixed wait — a single-shot check
  // was hard-failing slow-but-successful logins where the token just wasn't written yet.
  let jwt = "";
  for (let i = 0; i < 20 && !jwt; i++) {
    jwt = ((await page.evaluate(() => sessionStorage.getItem("token")).catch(() => "")) as string) ?? "";
    if (!jwt) await page.waitForTimeout(1000);
  }
  if (!jwt) {
    await browser.close();
    throw new Error("NAT login completed without an authentication token");
  }
  return { browser, ctx, page, jwt, ban: creds.ban };
}

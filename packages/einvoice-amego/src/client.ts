import { createHash } from "node:crypto";
import { InvoiceError, InvoiceErrorCode } from "@paid-tw/einvoice";
import { type AmegoConfig, resolveBaseUrl, resolveRetry } from "./config.js";

/**
 * Amego signs every request with `md5(data + time + appKey)` and posts it as
 * form-urlencoded fields (`invoice`, `data`, `time`, `sign`). Verified against
 * the live sandbox.
 */
export function sign(dataJson: string, time: number, appKey: string): string {
  return createHash("md5")
    .update(dataJson + time + appKey)
    .digest("hex");
}

/** Amego returns `code: 0` on success; any non-zero code is an error. */
export interface AmegoResponse {
  code: number;
  msg?: string;
  [key: string]: unknown;
}

/** Response of `/json/time` — note there is NO `code` field. */
export interface AmegoTimeResponse {
  timestamp: number;
  text: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * 伺服器時間. A plain GET — no `invoice`/`data`/`time`/`sign`, and the response
 * carries no `code` envelope — so it bypasses {@link amegoRequest}.
 */
export async function fetchServerTime(config: AmegoConfig): Promise<AmegoTimeResponse> {
  const baseUrl = resolveBaseUrl(config);
  const doFetch = config.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${baseUrl}/json/time`, {
      method: "GET",
      signal: config.timeoutMs ? AbortSignal.timeout(config.timeoutMs) : undefined,
    });
  } catch (cause) {
    throw new InvoiceError("Amego time request failed", {
      provider: "amego",
      code: InvoiceErrorCode.NETWORK,
      cause,
    });
  }
  return (await res.json()) as AmegoTimeResponse;
}

/** Cached server-clock offset (seconds) per base URL, 5 min TTL. */
const timeOffsetCache = new Map<string, { offset: number; at: number }>();
const TIME_TTL_MS = 5 * 60 * 1000;

/** Clear the time-sync cache (for tests / forced resync). */
export function clearTimeSyncCache(): void {
  timeOffsetCache.clear();
}

async function getTimestamp(config: AmegoConfig, now: number): Promise<number> {
  if (!config.syncTime) return now;
  const baseUrl = resolveBaseUrl(config);
  const cached = timeOffsetCache.get(baseUrl);
  if (cached && Date.now() - cached.at < TIME_TTL_MS) return now + cached.offset;

  try {
    const { timestamp } = await fetchServerTime(config);
    if (typeof timestamp === "number") {
      timeOffsetCache.set(baseUrl, { offset: timestamp - now, at: Date.now() });
      return timestamp;
    }
  } catch {
    // fall through to local time on sync failure
  }
  return now;
}

async function doRequest(
  config: AmegoConfig,
  path: string,
  data: unknown,
  now: number,
): Promise<AmegoResponse> {
  const baseUrl = resolveBaseUrl(config);
  const doFetch = config.fetch ?? fetch;
  // No-data endpoints (e.g. lottery_type) need an EMPTY data string, not "{}":
  // Amego strips data and verifies the sign over "", so "{}" → code 16.
  const dataJson = data == null ? "" : JSON.stringify(data);
  const time = await getTimestamp(config, now);

  const body = new URLSearchParams({
    invoice: config.sellerUbn,
    data: dataJson,
    time: String(time),
    sign: sign(dataJson, time, config.appKey),
  });

  let res: Response;
  try {
    res = await doFetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: config.timeoutMs ? AbortSignal.timeout(config.timeoutMs) : undefined,
    });
  } catch (cause) {
    throw new InvoiceError("Amego request failed", {
      provider: "amego",
      code: InvoiceErrorCode.NETWORK,
      cause,
    });
  }

  let json: AmegoResponse;
  try {
    json = (await res.json()) as AmegoResponse;
  } catch (cause) {
    throw new InvoiceError("Amego returned a non-JSON response", {
      provider: "amego",
      code: InvoiceErrorCode.PROVIDER,
      rawCode: String(res.status),
      cause,
    });
  }

  // Some endpoints (e.g. g0501) return `code` as a STRING — normalize it.
  if (Number(json.code) !== 0) {
    throw new InvoiceError(json.msg || "Amego returned an error", {
      provider: "amego",
      code: mapAmegoErrorCode(json.code),
      rawCode: String(json.code),
      rawMessage: json.msg,
      raw: json,
    });
  }

  return json;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function amegoRequest(
  config: AmegoConfig,
  path: string,
  data: unknown,
  now: number = Math.floor(Date.now() / 1000),
): Promise<AmegoResponse> {
  const retry = resolveRetry(config);
  if (!retry) return doRequest(config, path, data, now);

  let attempt = 0;
  for (;;) {
    try {
      return await doRequest(config, path, data, now);
    } catch (err) {
      // Only transient transport failures are retried — never business errors.
      const retryable = err instanceof InvoiceError && err.code === InvoiceErrorCode.NETWORK;
      if (!retryable || attempt >= retry.maxRetries) throw err;
      const delay = Math.min(retry.baseDelayMs * 2 ** attempt, retry.maxDelayMs);
      await sleep(delay);
      attempt++;
    }
  }
}

/**
 * Map Amego error codes onto normalized {@link InvoiceErrorCode}s.
 * Source: https://invoice.amego.tw/info_detail?mid=71 + live sandbox.
 */
export function mapAmegoErrorCode(rawCode: number | string): InvoiceErrorCode {
  // Some endpoints return `code` as a string — normalize to a number.
  const code = Number(rawCode);
  if (!Number.isFinite(code)) return InvoiceErrorCode.PROVIDER;

  // Account / auth / signature (通用錯誤): 11 統編空, 12 統編錯, 13 status未啟用,
  // 14 IP錯, 15 Time錯, 16 簽名錯, 19 公司停權, 22 尚未申請 API 串接.
  if ([11, 12, 13, 14, 15, 16, 19, 22].includes(code)) return InvoiceErrorCode.AUTH;

  // Transient provider-side (通用錯誤): 10 維護中, 18 無法建立資料庫連線, 21 人數過多.
  if (code === 10 || code === 18 || code === 21) return InvoiceErrorCode.PROVIDER;

  // print/file/query operation not allowed for the invoice's state/condition:
  // 51 超過查詢期限, 52 等待異動排程, 53 載具/類型不可, 55 不符合條件, 56 0元發票.
  if (code === 51 || code === 52 || code === 53 || code === 55 || code === 56)
    return InvoiceErrorCode.CONFLICT;

  // No data / does not exist (invoice 3050125, g0401 原發票 4040156, allowance
  // 4050134, 手機條碼 9000113)
  if (code === 71 || code === 3050125 || code === 4040156 || code === 4050134 || code === 9000113)
    return InvoiceErrorCode.NOT_FOUND;

  // Number track (字軌) exhausted / no next invoice number available
  if (code === 3040111 || code === 3040191) return InvoiceErrorCode.NUMBER_EXHAUSTED;

  // System-side print-format generation failure (not caller input)
  if (code === 3040192) return InvoiceErrorCode.PROVIDER;

  // Duplicate OrderId / invoice state conflict / already has an allowance
  if (code === 3040171) return InvoiceErrorCode.CONFLICT;
  if (code === 3050141) return InvoiceErrorCode.CONFLICT; // 已存在折讓單
  if (code >= 3050121 && code <= 3050123) return InvoiceErrorCode.CONFLICT; // 開立中/已作廢/已註銷
  if (code === 3050126 || code === 3050131) return InvoiceErrorCode.CONFLICT; // 超過修改期限 / 等待排程
  // g0401 original-invoice / allowance-number state conflicts (開立中 / 已作廢 / 已註銷 / 已存在折讓)
  if (code >= 4040152 && code <= 4040154) return InvoiceErrorCode.CONFLICT;
  if (code >= 4040161 && code <= 4040163) return InvoiceErrorCode.CONFLICT;
  // g0501 allowance-void state conflicts (折讓開立中 / 已作廢 / 超過修改期限 / 等待排程)
  if (code === 4050131 || code === 4050132 || code === 4050135 || code === 4050141)
    return InvoiceErrorCode.CONFLICT;

  // Payload shape / query-param errors: "data 應為陣列字串" (23/3050112/4050112),
  // print/query type & param errors (31–36 — verified live).
  if (
    code === 23 ||
    (code >= 31 && code <= 36) ||
    code === 3050111 || // f0501 CancelInvoiceNumber 錯誤
    code === 3050112 ||
    code === 3050124 || // 發票類型錯誤
    code === 4050112 || // g0501 data 應為陣列
    code === 4050121 || // g0501 CancelAllowanceNumber 錯誤
    code === 4050133 // g0501 折讓類型錯誤
  )
    return InvoiceErrorCode.VALIDATION;

  // f0401_custom per-record field errors are returned as code 99 (verified live).
  if (code === 99) return InvoiceErrorCode.VALIDATION;

  // Empty data / malformed JSON / field & amount validation (30401xx, 30402xx…)
  if (code === 17 || code === 20) return InvoiceErrorCode.VALIDATION;
  if (code >= 3040100 && code < 3050000) return InvoiceErrorCode.VALIDATION;
  // g0401 field/amount errors (4040112, 4040121–142, 4040151/155, 4040171/173) —
  // the state conflicts and 原發票不存在 are handled above.
  if (code >= 4040100 && code < 4050000) return InvoiceErrorCode.VALIDATION;
  if (code >= 9000000) return InvoiceErrorCode.VALIDATION; // barcode/carrier field errors

  return InvoiceErrorCode.PROVIDER;
}

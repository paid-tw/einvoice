import { createHash } from "node:crypto";
import { InvoiceError, InvoiceErrorCode } from "@paid-tw/einvoice";
import { type AmegoConfig, resolveBaseUrl } from "./config.js";

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

export async function amegoRequest(
  config: AmegoConfig,
  path: string,
  data: unknown,
  now: number = Math.floor(Date.now() / 1000),
): Promise<AmegoResponse> {
  const baseUrl = resolveBaseUrl(config);
  const doFetch = config.fetch ?? fetch;
  const dataJson = JSON.stringify(data ?? {});

  const body = new URLSearchParams({
    invoice: config.sellerTaxId,
    data: dataJson,
    time: String(now),
    sign: sign(dataJson, now, config.appKey),
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

  if (json.code !== 0) {
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

/**
 * Map Amego error codes onto normalized {@link InvoiceErrorCode}s.
 * Source: https://invoice.amego.tw/info_detail?mid=71.
 */
export function mapAmegoErrorCode(code: number): InvoiceErrorCode {
  // Auth / signature / time / IP
  if (code === 14 || code === 15 || code === 16) return InvoiceErrorCode.AUTH;
  // 統編 missing/invalid — credential-level
  if (code === 11 || code === 12) return InvoiceErrorCode.AUTH;

  // No data / invoice does not exist
  if (code === 71 || code === 3050125) return InvoiceErrorCode.NOT_FOUND;

  // Number track (字軌) exhausted
  if (code === 3040111) return InvoiceErrorCode.NUMBER_EXHAUSTED;

  // Duplicate OrderId / invoice already in a terminal state / allowance conflict
  if (code === 3040171) return InvoiceErrorCode.CONFLICT;
  if (code >= 3050121 && code <= 3050123) return InvoiceErrorCode.CONFLICT;
  if (code >= 4040161 && code <= 4040162) return InvoiceErrorCode.CONFLICT;

  // Empty data / malformed JSON / field & amount validation (30401xx, 30402xx…)
  if (code === 17 || code === 20) return InvoiceErrorCode.VALIDATION;
  if (code >= 3040100 && code < 3050000) return InvoiceErrorCode.VALIDATION;

  return InvoiceErrorCode.PROVIDER;
}

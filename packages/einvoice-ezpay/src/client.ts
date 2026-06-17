import { InvoiceError, InvoiceErrorCode } from "@paid-tw/einvoice";
import { type EzpayConfig, resolveBaseUrl } from "./config.js";
import { decryptPostData, encryptPostData, makeCheckValue } from "./crypto.js";

/** Raw ezPay response envelope (RespondType=JSON). */
export interface EzpayResponse {
  /** "SUCCESS" on success; otherwise an error code (e.g. "INV10013"). */
  Status: string;
  Message: string;
  /** A JSON string (parsed by the client) on success. */
  Result?: string | Record<string, unknown>;
}

export interface EzpayResult {
  status: string;
  message: string;
  /** Parsed `Result` object. */
  result: Record<string, unknown>;
  raw: EzpayResponse;
}

/** Unix timestamp (seconds) for the `TimeStamp` field. */
export function ezpayTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Send a PostData_ params object to an ezPay endpoint: AES-encrypt it, POST
 * `{ MerchantID_, PostData_ }` as form-urlencoded, and parse the JSON envelope.
 * Throws an {@link InvoiceError} when `Status !== "SUCCESS"`.
 */
export async function ezpayRequest(
  config: EzpayConfig,
  path: string,
  postData: Record<string, string | number | undefined>,
): Promise<EzpayResult> {
  const baseUrl = resolveBaseUrl(config);
  const doFetch = config.fetch ?? fetch;
  const body = new URLSearchParams({
    MerchantID_: config.merchantId,
    PostData_: encryptPostData(postData, config.hashKey, config.hashIV),
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
    throw new InvoiceError("ezPay request failed", {
      provider: "ezpay",
      code: InvoiceErrorCode.NETWORK,
      cause,
    });
  }

  let json: EzpayResponse;
  try {
    json = (await res.json()) as EzpayResponse;
  } catch (cause) {
    throw new InvoiceError("ezPay returned a non-JSON response", {
      provider: "ezpay",
      code: InvoiceErrorCode.PROVIDER,
      rawCode: String(res.status),
      cause,
    });
  }

  if (json.Status !== "SUCCESS") {
    throw new InvoiceError(json.Message || "ezPay returned an error", {
      provider: "ezpay",
      code: mapEzpayError(json.Status),
      rawCode: json.Status,
      rawMessage: json.Message,
      raw: json,
    });
  }

  const result =
    typeof json.Result === "string"
      ? (JSON.parse(json.Result || "{}") as Record<string, unknown>)
      : ((json.Result ?? {}) as Record<string, unknown>);

  return { status: json.Status, message: json.Message, result, raw: json };
}

export interface CarrierCheckResult {
  /** Whether the barcode / love code exists (財政部 `IsExist=Y`). */
  exists: boolean;
  /** The decrypted Result fields, keyed verbatim (echoed code casing varies). */
  fields: Record<string, string>;
  raw: EzpayResponse;
}

/**
 * Call a 手機條碼/愛心碼驗證 endpoint (`/Api_inv_application/...`). Unlike the
 * invoice API these take top-level `Version`/`RespondType`/`CheckValue` form
 * fields and return an **AES-encrypted** `Result` (a `&`-joined query string,
 * not JSON). Throws an {@link InvoiceError} when `Status !== "SUCCESS"`.
 */
export async function ezpayCarrierCheck(
  config: EzpayConfig,
  path: string,
  fields: Record<string, string | number>,
): Promise<CarrierCheckResult> {
  const baseUrl = resolveBaseUrl(config);
  const doFetch = config.fetch ?? fetch;
  const postData = encryptPostData(
    { TimeStamp: Math.floor(Date.now() / 1000), ...fields },
    config.hashKey,
    config.hashIV,
  );
  const body = new URLSearchParams({
    MerchantID_: config.merchantId,
    Version: "1.0",
    RespondType: config.respondType ?? "JSON",
    PostData_: postData,
    CheckValue: makeCheckValue(postData, config.hashKey, config.hashIV),
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
    throw new InvoiceError("ezPay carrier-check request failed", {
      provider: "ezpay",
      code: InvoiceErrorCode.NETWORK,
      cause,
    });
  }

  let json: EzpayResponse;
  try {
    json = (await res.json()) as EzpayResponse;
  } catch (cause) {
    throw new InvoiceError("ezPay returned a non-JSON response", {
      provider: "ezpay",
      code: InvoiceErrorCode.PROVIDER,
      rawCode: String(res.status),
      cause,
    });
  }

  if (json.Status !== "SUCCESS") {
    throw new InvoiceError(json.Message || "ezPay returned an error", {
      provider: "ezpay",
      code: mapEzpayError(json.Status),
      rawCode: json.Status,
      rawMessage: json.Message,
      raw: json,
    });
  }

  // Result is AES-encrypted; decrypt then parse the `&`-joined key=value pairs.
  const decrypted = decryptPostData(String(json.Result ?? ""), config.hashKey, config.hashIV);
  const fieldsOut = Object.fromEntries(new URLSearchParams(decrypted)) as Record<string, string>;
  // IsExist casing is stable, but the echoed code key varies (LoveCode vs
  // Lovecode), so read IsExist case-insensitively to be safe.
  const isExist = Object.entries(fieldsOut).find(([k]) => k.toLowerCase() === "isexist")?.[1];
  return { exists: isExist === "Y", fields: fieldsOut, raw: json };
}

/**
 * Map an ezPay error code onto a normalized {@link InvoiceErrorCode}.
 * Source: the ezPay 技術串接手冊 §九 錯誤代碼.
 */
export function mapEzpayError(code: string): InvoiceErrorCode {
  switch (code) {
    // 查無發票 / 折讓查詢失敗
    case "INV20006":
    case "IAI10002":
      return InvoiceErrorCode.NOT_FOUND;
    // 可開立張數已用罄
    case "INV90006":
      return InvoiceErrorCode.NUMBER_EXHAUSTED;
    // 網路異常 / TimeOut
    case "NOR10001":
    case "KEY10014":
      return InvoiceErrorCode.NETWORK;
    // 解密錯誤(金鑰不符) / 未申請 / 未簽合約或到期 / 頁面停留超過30分(時間戳)
    case "KEY10002":
    case "KEY10006":
    case "INV90005":
    case "KEY10007":
      return InvoiceErrorCode.AUTH;
    // 自訂編號重覆 / 已作廢過 / 無法作廢(已折讓) / 超過作廢期限 / 未上傳無法作廢 / 上傳失敗不得作廢
    case "LIB10003":
    case "LIB10005":
    case "LIB10007":
    case "LIB10008":
    case "LIB10009":
    case "INV70002":
      return InvoiceErrorCode.CONFLICT;
    // 暫停使用 / 異常終止 / 折讓更新·新增·異常
    case "INV10020":
    case "INV10021":
    case "IAI10003":
    case "IAI10005":
    case "IAI10006":
      return InvoiceErrorCode.PROVIDER;
    // 手機條碼/愛心碼驗證 API: 查詢失敗 (查無此條碼/愛心碼)
    case "API10002":
      return InvoiceErrorCode.NOT_FOUND;
    // 手機條碼/愛心碼驗證 API: 財政部大平台異常終止
    case "CBC10003":
      return InvoiceErrorCode.PROVIDER;
    // 手機條碼/愛心碼驗證 API: 財政部大平台網路連線異常
    case "CBC10004":
      return InvoiceErrorCode.NETWORK;
  }
  // Field / data / amount validation families. KEY/INV/IAI/LIB cover invoice,
  // allowance and void; API/CBC cover the 手機條碼/愛心碼驗證 API.
  if (/^(KEY|INV|IAI|LIB|API|CBC)\d+$/.test(code)) return InvoiceErrorCode.VALIDATION;
  return InvoiceErrorCode.PROVIDER;
}

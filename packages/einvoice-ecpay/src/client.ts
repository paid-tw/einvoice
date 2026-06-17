import { InvoiceError, InvoiceErrorCode } from "@paid-tw/einvoice";
import { type EcpayConfig, resolveBaseUrl } from "./config.js";
import { decryptData, encryptData } from "./crypto.js";

/** The outer (transport) response envelope. `Data` is AES-encrypted. */
interface EcpayEnvelope {
  MerchantID: string;
  RpHeader?: { Timestamp: number };
  TransCode: number;
  TransMsg: string;
  Data?: string;
}

/** The decrypted business response — `RtnCode === 1` means success. */
export interface EcpayResult extends Record<string, unknown> {
  RtnCode: number;
  RtnMsg: string;
}

/** Unix timestamp (seconds) for the `RqHeader.Timestamp` field. */
export function ecpayTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Send a Data payload to a B2C endpoint: wrap it as
 * `{ MerchantID, RqHeader: { Timestamp }, Data: <encrypted> }`, POST JSON, then
 * unwrap — verifying the transport `TransCode` and the business `RtnCode`.
 * Throws an {@link InvoiceError} on either failure.
 */
export interface EcpayRequestOptions {
  /**
   * Business `RtnCode`s to treat as success besides `1`. Needed for TriggerIssue,
   * whose "開立發票成功" replies use 4000003/4000004 (live-verified).
   */
  successCodes?: number[];
}

export async function ecpayRequest(
  config: EcpayConfig,
  path: string,
  data: Record<string, unknown>,
  options: EcpayRequestOptions = {},
): Promise<EcpayResult> {
  const baseUrl = resolveBaseUrl(config);
  const doFetch = config.fetch ?? fetch;
  const body = JSON.stringify({
    MerchantID: config.merchantId,
    RqHeader: { Timestamp: ecpayTimestamp() },
    Data: encryptData({ MerchantID: config.merchantId, ...data }, config.hashKey, config.hashIV),
  });

  let res: Response;
  try {
    res = await doFetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: config.timeoutMs ? AbortSignal.timeout(config.timeoutMs) : undefined,
    });
  } catch (cause) {
    throw new InvoiceError("ECPay request failed", {
      provider: "ecpay",
      code: InvoiceErrorCode.NETWORK,
      cause,
    });
  }

  let envelope: EcpayEnvelope;
  try {
    envelope = (await res.json()) as EcpayEnvelope;
  } catch (cause) {
    throw new InvoiceError("ECPay returned a non-JSON response", {
      provider: "ecpay",
      code: InvoiceErrorCode.PROVIDER,
      rawCode: String(res.status),
      cause,
    });
  }

  // TransCode is the transport/decryption result (1 = OK).
  if (Number(envelope.TransCode) !== 1 || !envelope.Data) {
    throw new InvoiceError(envelope.TransMsg || "ECPay transport error", {
      provider: "ecpay",
      code: InvoiceErrorCode.PROVIDER,
      rawCode: String(envelope.TransCode),
      rawMessage: envelope.TransMsg,
      raw: envelope,
    });
  }

  const result = decryptData<EcpayResult>(envelope.Data, config.hashKey, config.hashIV);

  // RtnCode is the business result (1 = success, plus any opted-in extras).
  const ok = new Set([1, ...(options.successCodes ?? [])]);
  if (!ok.has(Number(result.RtnCode))) {
    throw new InvoiceError(result.RtnMsg || "ECPay returned an error", {
      provider: "ecpay",
      code: mapEcpayError(Number(result.RtnCode), result.RtnMsg),
      rawCode: String(result.RtnCode),
      rawMessage: result.RtnMsg,
      raw: result,
    });
  }

  return result;
}

/**
 * Map an ECPay invoice error onto a normalized {@link InvoiceErrorCode}. ECPay's
 * B2C `RtnCode`s span inconsistent ranges (2, 1600003, 5000022 …, verified
 * live), so the Chinese `RtnMsg` is the reliable signal; everything unmatched is
 * treated as field/business validation (the common case).
 */
export function mapEcpayError(rtnCode: number, rtnMsg = ""): InvoiceErrorCode {
  // 9000001 = 呼叫財政部API失敗 (財政部 maintenance) — transient, retryable, NOT
  // an input error. Surface it as NETWORK so callers don't reject a valid value.
  if (rtnCode === 9000001 || /財政部.*(失敗|維護)|呼叫.*API失敗/.test(rtnMsg))
    return InvoiceErrorCode.NETWORK;
  if (/特店.*不存在|平台商.*不存在|金鑰|簽章|未授權/.test(rtnMsg)) return InvoiceErrorCode.AUTH;
  if (/字軌.*(用罄|用完|不足|已滿)|號碼.*(用罄|用完)/.test(rtnMsg))
    return InvoiceErrorCode.NUMBER_EXHAUSTED;
  if (/已作廢|已開立|已存在|已折讓|折讓過|重複|不可重複/.test(rtnMsg)) return InvoiceErrorCode.CONFLICT;
  // AUTH already claimed 特店/平台商 不存在 above, so a bare 不存在 here is a
  // missing record (e.g. 4000001 不存在此交易單號 for an unknown Tsr).
  if (/查無|查不到|無.*資料|不存在/.test(rtnMsg)) return InvoiceErrorCode.NOT_FOUND;
  if (/系統(錯誤|異常|忙碌)|請稍後/.test(rtnMsg)) return InvoiceErrorCode.PROVIDER;
  return InvoiceErrorCode.VALIDATION;
}

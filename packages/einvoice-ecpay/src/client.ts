import { InvoiceError, InvoiceErrorCode, InvoiceErrorReason, tracedFetch } from "@paid-tw/einvoice";
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
  /**
   * The response `Data` is an unencrypted JSON object (not the usual AES base64
   * string). Used by GetIssueList (live-verified — the doc's "AES解密" is wrong).
   */
  plainData?: boolean;
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
    // RqHeader.Revision is omitted: the doc marks it required, but the API
    // accepts requests without it (live-verified on stage, 2026-08-15).
    RqHeader: { Timestamp: ecpayTimestamp() },
    Data: encryptData({ MerchantID: config.merchantId, ...data }, config.hashKey, config.hashIV),
  });

  let res: Response;
  try {
    res = await tracedFetch(
      { provider: "ecpay", debug: config.debug, fetch: doFetch },
      `${baseUrl}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: config.timeoutMs ? AbortSignal.timeout(config.timeoutMs) : undefined,
      },
    );
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
    const { code, reason } = mapEcpayTransportError(Number(envelope.TransCode));
    throw new InvoiceError(envelope.TransMsg || "ECPay transport error", {
      provider: "ecpay",
      code,
      reason,
      rawCode: String(envelope.TransCode),
      rawMessage: envelope.TransMsg,
      raw: envelope,
    });
  }

  const result = options.plainData
    ? (envelope.Data as unknown as EcpayResult)
    : decryptData<EcpayResult>(envelope.Data, config.hashKey, config.hashIV);

  // RtnCode is the business result (1 = success, plus any opted-in extras).
  const ok = new Set([1, ...(options.successCodes ?? [])]);
  if (!ok.has(Number(result.RtnCode))) {
    throw new InvoiceError(result.RtnMsg || "ECPay returned an error", {
      provider: "ecpay",
      code: mapEcpayError(Number(result.RtnCode), result.RtnMsg),
      reason: ecpayErrorReason(result.RtnMsg, Number(result.RtnCode)),
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
 * live), so the Chinese `RtnMsg` is the reliable signal for most codes; a few
 * stable codes are pinned in {@link ECPAY_ERROR_TABLE} because their message
 * keywords are ambiguous. Everything unmatched is treated as field/business
 * validation (the common case).
 */
export function mapEcpayError(rtnCode: number, rtnMsg = ""): InvoiceErrorCode {
  const known = ECPAY_ERROR_TABLE[rtnCode];
  if (known) return known.code;
  // 9000001 = 呼叫財政部API失敗 (財政部 maintenance) — transient, retryable, NOT
  // an input error. Surface it as NETWORK so callers don't reject a valid value.
  if (rtnCode === 9000001 || /財政部.*(失敗|維護)|呼叫.*API失敗/.test(rtnMsg))
    return InvoiceErrorCode.NETWORK;
  if (/特店.*不存在|平台商.*不存在|金鑰|簽章|未授權/.test(rtnMsg)) return InvoiceErrorCode.AUTH;
  if (/字軌.*(用罄|用完|不足|已滿)|號碼.*(用罄|用完)/.test(rtnMsg))
    return InvoiceErrorCode.NUMBER_EXHAUSTED;
  // 已被作廢過 / 已被折讓過 / 自訂編號重覆(覆) — note 覆 and 複 are both used live.
  if (/已(被)?作廢|作廢過|已開立|已存在|已(被)?折讓|折讓過|同意|重[複覆]|不可重[複覆]/.test(rtnMsg))
    return InvoiceErrorCode.CONFLICT;
  // AUTH already claimed 特店/平台商 不存在 above, so a bare 不存在 here is a
  // missing record (e.g. 4000001 不存在此交易單號 for an unknown Tsr).
  if (/查無|查不到|無.*資料|不存在/.test(rtnMsg)) return InvoiceErrorCode.NOT_FOUND;
  if (/系統(錯誤|異常|忙碌)|請稍後/.test(rtnMsg)) return InvoiceErrorCode.PROVIDER;
  return InvoiceErrorCode.VALIDATION;
}

/**
 * Map an ECPay error onto a normalized {@link InvoiceErrorReason}. Prefers the
 * stable-`RtnCode` table (pass `rtnCode`), then falls back to `RtnMsg` keyword
 * matching. The keyword branches are ordered specific → general: a void-blocked
 * message ("該發票已被折讓過…請確認…折讓單是否全部已作廢") contains BOTH 折讓 and
 * 作廢, so `void_blocked_by_allowance` must be tested before `already_voided` or
 * the trailing 作廢 misclassifies it. Returns `undefined` when no distinct
 * consumer action applies.
 */
export function ecpayErrorReason(rtnMsg = "", rtnCode?: number): InvoiceErrorReason | undefined {
  if (rtnCode !== undefined) {
    const known = ECPAY_ERROR_TABLE[rtnCode];
    if (known?.reason) return known.reason;
  }
  if (/金鑰|簽章|未授權/.test(rtnMsg)) return InvoiceErrorReason.CREDENTIALS_INVALID;
  if (/特店.*不存在|平台商.*不存在/.test(rtnMsg)) return InvoiceErrorReason.NOT_ENROLLED;
  // Specific first: a void blocked by an allowance mentions 折讓 (and, confusingly,
  // 作廢 too) — match it before the bare already-voided check below.
  if (/已(被)?折讓過|已折讓|已開立折讓/.test(rtnMsg))
    return InvoiceErrorReason.VOID_BLOCKED_BY_ALLOWANCE;
  if (/已(被)?作廢過|已作廢/.test(rtnMsg)) return InvoiceErrorReason.ALREADY_VOIDED;
  if (/重[複覆]|不可重[複覆]/.test(rtnMsg)) return InvoiceErrorReason.DUPLICATE_ORDER;
  if (/系統忙碌|請稍後/.test(rtnMsg)) return InvoiceErrorReason.RATE_LIMITED;
  return undefined;
}

/**
 * Stable ECPay B2C `RtnCode`s with a definitive `(code, reason)` — verified live
 * against `einvoice-stage.ecpay.com.tw` (2026-08-01). These take precedence over
 * `RtnMsg` keyword matching because their live messages defeat it: 5070357 uses
 * 重覆 (not 重複); 5070453's 該發票已被作廢過 isn't matched by a bare 已作廢; and
 * 5070450's message contains both 折讓 and 作廢 (see {@link ecpayErrorReason}).
 */
const ECPAY_ERROR_TABLE: Record<number, { code: InvoiceErrorCode; reason?: InvoiceErrorReason }> = {
  // 開立: 自訂編號重覆 — an ambiguous-timeout resend of an issue. CONFLICT (retryable
  // via QUERY_BY_ORDER_ID: look the existing invoice up by RelateNumber and claim it),
  // matching Amego 3040171 / ezPay LIB10003.
  5070357: { code: InvoiceErrorCode.CONFLICT, reason: InvoiceErrorReason.DUPLICATE_ORDER },
  // 作廢: 該發票已被折讓過，無法直接作廢 — must void the allowance(s) first.
  5070450: {
    code: InvoiceErrorCode.CONFLICT,
    reason: InvoiceErrorReason.VOID_BLOCKED_BY_ALLOWANCE,
  },
  // 作廢: 該發票已被作廢過 — the target state is already reached (idempotent no-op).
  5070453: { code: InvoiceErrorCode.CONFLICT, reason: InvoiceErrorReason.ALREADY_VOIDED },
};

/**
 * Map a transport-level `TransCode` (the envelope layer, before any business
 * `RtnCode` exists) onto a normalized `(code, reason)`. Live-verified against
 * `einvoice-stage.ecpay.com.tw` (2026-08-15): a wrong HashKey/HashIV fails
 * HERE — TransCode 110, never a business-layer 金鑰 message — so without this
 * mapping a credentials mistake surfaces as a PROVIDER outage. Unlisted codes
 * (e.g. 111 empty Data, which this SDK can't produce) fall back to PROVIDER.
 */
export function mapEcpayTransportError(transCode: number): {
  code: InvoiceErrorCode;
  reason?: InvoiceErrorReason;
} {
  return ECPAY_TRANSPORT_TABLE[transCode] ?? { code: InvoiceErrorCode.PROVIDER };
}

const ECPAY_TRANSPORT_TABLE: Record<
  number,
  { code: InvoiceErrorCode; reason?: InvoiceErrorReason }
> = {
  // "Timestamp is over 10 minutes than it just produced." — the caller's clock
  // is skewed; matches Amego 15 / ezPay KEY10007 (AUTH / stale_timestamp).
  104: { code: InvoiceErrorCode.AUTH, reason: InvoiceErrorReason.STALE_TIMESTAMP },
  // "The parameter [Data] decrypt fail." — wrong HashKey/HashIV.
  110: { code: InvoiceErrorCode.AUTH, reason: InvoiceErrorReason.CREDENTIALS_INVALID },
  // "B2C/B2B功能尚未開通，請聯繫所屬業務" — unknown MerchantID, or e-invoice not
  // enabled for the merchant.
  115: { code: InvoiceErrorCode.AUTH, reason: InvoiceErrorReason.NOT_ENROLLED },
};

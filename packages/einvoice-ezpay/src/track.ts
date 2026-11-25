import { InvoiceError, InvoiceErrorCode, isInvoiceError, tracedFetch } from "@paid-tw/einvoice";
import { type EzpayResponse, ezpayErrorReason, ezpayTimestamp, mapEzpayError } from "./client.js";
import { type EzpayConfig, resolveBaseUrl } from "./config.js";
import { encryptPostData, makeTrackCheckCode } from "./crypto.js";
import { ENDPOINTS } from "./endpoints.js";

/**
 * ezPay 字軌管理 API (EZP_Track_1.0.0): add a 字軌 range, change its status, and
 * list the ranges of a period. Unlike the invoice API these endpoints are keyed
 * by the platform **member** (`CompanyID_`, 會員編號), not the store
 * (`MerchantID_`), and use the member's API HashKey/HashIV — see
 * {@link EzpayConfig.companyId}.
 */

/** 字軌使用狀態 (`Flag`): 0 暫停 / 1 啟用 / 2 停用 (停用 is final). */
export type EzpayTrackStatus = "PAUSED" | "ACTIVE" | "DISABLED";

const STATUS_TO_FLAG: Record<EzpayTrackStatus, string> = {
  PAUSED: "0",
  ACTIVE: "1",
  DISABLED: "2",
};
/**
 * `Flag` → status. `3` is not in the manual's table, but its own search example
 * shows it on a used-up range, and live on cinv (2026-11-24) every `Flag=3`
 * range had `LastNumber=0` and `UsedNumber` equal to `EndNumber`: 用畢.
 */
const FLAG_TO_STATUS: Record<string, EzpayTrackStatus | "EXHAUSTED"> = {
  "0": "PAUSED",
  "1": "ACTIVE",
  "2": "DISABLED",
  "3": "EXHAUSTED",
};

/** One 字軌 range as ezPay reports it. */
export interface EzpayTrack {
  /** 字軌管理編號 — ezPay's id for this range; pass it to `setStatus`. */
  managementNo: string;
  /** 發票年度, 民國年 (e.g. 115). */
  year: number;
  /** 發票期別 1–6 (1 = 一、二月 … 6 = 十一、十二月). */
  term: number;
  /** 字軌英文代碼, two uppercase letters. */
  letters: string;
  /** 發票起始號碼, 8 digits (leading zeros kept). */
  startNumber: string;
  /**
   * 發票結束號碼, 8 digits. Once a range is DISABLED, ezPay reports it equal
   * to `startNumber` (verified live on cinv 2026-11-24).
   */
  endNumber: string;
  /**
   * 使用中的發票號碼 — only `search` reports it, and only once the range has
   * issued a number (an untouched range answers an empty string).
   */
  usedNumber?: string;
  /** 發票類別: `07` 一般稅額 / `08` 特種稅額. */
  type: string;
  /** 字軌建立時間. */
  createdAt?: Date;
  /** 剩餘張數. */
  remaining: number;
  /**
   * The status. `EXHAUSTED` (`Flag=3`, 用畢) is set by ezPay when the range runs
   * out and cannot be requested through `setStatus`; `UNKNOWN` covers any other
   * undocumented `Flag`, kept verbatim in {@link EzpayTrack.flag}.
   */
  status: EzpayTrackStatus | "EXHAUSTED" | "UNKNOWN";
  /** Raw `Flag`. */
  flag: string;
  /** The untouched Result entry. */
  raw: Record<string, unknown>;
}

/** Input for `provider.track.create` (新增字軌). */
export interface CreateTrackInput {
  /** 發票年度, 民國年 (e.g. 115). ezPay accepts only this year and next. */
  year: number;
  /** 發票期別 1–6. ezPay rejects a period before the current one. */
  term: number;
  /** 字軌英文代碼, two uppercase letters (e.g. "AB"). */
  letters: string;
  /** 發票起始號碼 (number or 8-digit string). */
  startNumber: number | string;
  /** 發票結束號碼 (number or 8-digit string). */
  endNumber: number | string;
  /** 發票類別: `07` 一般稅額 (default) / `08` 特種稅額. */
  type?: "07" | "08";
}

/** Input for `provider.track.setStatus` (字軌資料管理). */
export interface SetTrackStatusInput {
  managementNo: string;
  /** 發票年度, 民國年. ezPay accepts only this year and next. */
  year: number;
  /** `DISABLED` (停用) cannot be undone. */
  status: EzpayTrackStatus;
}

/** Input for `provider.track.search` (字軌資料查詢). */
export interface SearchTracksInput {
  /** 發票年度, 民國年. ezPay accepts the previous two years through next year. */
  year: number;
  /** 發票期別 1–6. */
  term: number;
  /** Narrow to one range. */
  managementNo?: string;
  /** Narrow to one status. */
  status?: EzpayTrackStatus;
}

// --- validation ------------------------------------------------------------

function invalid(message: string): InvoiceError {
  return new InvoiceError(message, {
    provider: "ezpay",
    code: InvoiceErrorCode.VALIDATION,
    rawMessage: message,
  });
}

function rocYear(year: number): number {
  if (!Number.isInteger(year) || year < 1 || year > 999) {
    throw invalid(
      `ezPay 字軌 year is a 民國年 (e.g. 115 for 2026), got ${year}` +
        (year > 1911 ? ` — did you mean ${year - 1911}?` : ""),
    );
  }
  return year;
}

function term(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw invalid(`ezPay 字軌 term must be 1–6 (1 = 一、二月 … 6 = 十一、十二月), got ${value}`);
  }
  return value;
}

function invoiceNo(value: number | string, field: string): string {
  const s = typeof value === "number" ? String(value) : value;
  if (!/^\d{1,8}$/.test(s)) throw invalid(`ezPay 字軌 ${field} must be up to 8 digits, got ${s}`);
  return s.padStart(8, "0");
}

// --- wire --------------------------------------------------------------------

/** Track-specific credentials: the member id plus its keys (default: the store's). */
function trackCredentials(config: EzpayConfig) {
  if (!config.companyId) {
    throw new InvoiceError(
      "ezPay 字軌 API needs config.companyId (會員編號, the CompanyID_ field)",
      { provider: "ezpay", code: InvoiceErrorCode.VALIDATION },
    );
  }
  return {
    companyId: config.companyId,
    hashKey: config.companyHashKey ?? config.hashKey,
    hashIV: config.companyHashIV ?? config.hashIV,
  };
}

/**
 * Map a 字軌 API error code onto an {@link InvoiceErrorCode}. The codes come from
 * the 字軌 manual §七; some reuse an invoice-API code with a different meaning
 * (`LIB10001` is 查無資料 here, `LIB10007` 資料已存在), so they are matched
 * first and only the shared KEY/NOR codes fall through to {@link mapEzpayError}.
 */
export function mapEzpayTrackError(code: string, message?: string): InvoiceErrorCode {
  // An empty search answers INM10002 (listed as 查詢失敗) with the message
  // 查無資料 — verified live on cinv 2026-11-24 — so the message decides.
  if (message && /查無資料/.test(message)) return InvoiceErrorCode.NOT_FOUND;
  switch (code) {
    // 查無資料
    case "LIB10001":
    case "MOD10003":
      return InvoiceErrorCode.NOT_FOUND;
    // 字軌已存在或在範圍內 / 資料已存在 / 相同的字軌已存在 / 無法變更
    case "LIB10004":
    case "LIB10007":
    case "LIB10016":
    case "SET10006":
      return InvoiceErrorCode.CONFLICT;
    // 缺少參數 / 參數錯誤 / 輸入數值超過許可範圍
    case "INM10001":
    case "INM10004":
    case "LIB10013":
      return InvoiceErrorCode.VALIDATION;
    // 查詢·更新·新增失敗 / 異常終止
    case "INM10002":
    case "INM10003":
    case "INM10005":
    case "INM10006":
    case "MOD10001":
    case "MOD10006":
    case "LIB10010":
    case "LIB10011":
      return InvoiceErrorCode.PROVIDER;
    // CompanyID_ / PostData_ 欄位空白 — a client-side wiring mistake
    case "KEY10010":
    case "KEY10011":
      return InvoiceErrorCode.VALIDATION;
  }
  return mapEzpayError(code);
}

/** POST an encrypted PostData_ to a 字軌 endpoint and return the parsed Result. */
async function trackRequest(
  config: EzpayConfig,
  endpoint: { path: string; version: string },
  fields: Record<string, string | number | undefined>,
): Promise<{ result: unknown; raw: EzpayResponse }> {
  const creds = trackCredentials(config);
  const postData = {
    RespondType: "JSON",
    Version: endpoint.version,
    TimeStamp: ezpayTimestamp(),
    ...fields,
  };
  const body = new URLSearchParams({
    CompanyID_: creds.companyId,
    PostData_: encryptPostData(postData, creds.hashKey, creds.hashIV),
  });

  let res: Response;
  try {
    res = await tracedFetch(
      { provider: "ezpay", debug: config.debug, fetch: config.fetch ?? fetch },
      `${resolveBaseUrl(config)}${endpoint.path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: config.timeoutMs ? AbortSignal.timeout(config.timeoutMs) : undefined,
      },
    );
  } catch (cause) {
    throw new InvoiceError("ezPay 字軌 request failed", {
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
      code: mapEzpayTrackError(json.Status, json.Message),
      // Only the shared KEY codes carry the same meaning as in the invoice API.
      reason: json.Status.startsWith("KEY") ? ezpayErrorReason(json.Status) : undefined,
      rawCode: json.Status,
      rawMessage: json.Message,
      raw: json,
    });
  }

  const result =
    typeof json.Result === "string" ? (JSON.parse(json.Result || "null") as unknown) : json.Result;
  return { result, raw: json };
}

/** Normalize one Result entry, verifying its CheckCode unless disabled. */
function toTrack(config: EzpayConfig, entry: Record<string, unknown>): EzpayTrack {
  const str = (k: string) => (entry[k] === undefined || entry[k] === null ? "" : String(entry[k]));
  // The manual spells it `AphabeticLetter` (sic); accept the correct spelling too.
  const letters = str("AphabeticLetter") || str("AlphabeticLetter");

  // Every live 字軌 response carries a CheckCode (create, manage and each search
  // entry; cinv 2026-11-24), so a missing one is a mismatch, not a pass.
  if (config.verifyCheckCode !== false) {
    const creds = trackCredentials(config);
    const expected = makeTrackCheckCode(
      {
        AphabeticLetter: letters,
        CompanyId: creds.companyId,
        EndNumber: str("EndNumber"),
        ManagementNo: str("ManagementNo"),
        StartNumber: str("StartNumber"),
      },
      creds.hashKey,
      creds.hashIV,
    );
    if (expected !== str("CheckCode").toUpperCase()) {
      throw new InvoiceError("ezPay 字軌 response CheckCode mismatch — possible tampering", {
        provider: "ezpay",
        code: InvoiceErrorCode.PROVIDER,
        rawCode: "CHECKCODE_MISMATCH",
        raw: entry,
      });
    }
  }

  const flag = str("Flag");
  return {
    managementNo: str("ManagementNo"),
    year: Number(str("Year")),
    term: Number(str("Term")),
    letters,
    startNumber: str("StartNumber"),
    endNumber: str("EndNumber"),
    usedNumber: str("UsedNumber") || undefined,
    type: str("Type"),
    createdAt: parseTrackDate(str("CreateDatetime")),
    remaining: Number(str("LastNumber") || 0),
    status: FLAG_TO_STATUS[flag] ?? "UNKNOWN",
    flag,
    raw: entry,
  };
}

/**
 * `CreateDatetime` → Date (Asia/Taipei). The manual shows both
 * `2018-04-20 16:53:27` and `20161102 10:30:22`; accept either.
 */
function parseTrackDate(value: string): Date | undefined {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!m) return undefined;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`);
}

function single(config: EzpayConfig, result: unknown): EzpayTrack {
  const entry = Array.isArray(result) ? result[0] : result;
  if (!entry || typeof entry !== "object") {
    throw new InvoiceError("ezPay 字軌 response carried no Result", {
      provider: "ezpay",
      code: InvoiceErrorCode.PROVIDER,
      raw: result,
    });
  }
  return toTrack(config, entry as Record<string, unknown>);
}

// --- operations --------------------------------------------------------------

/** 新增字軌 — register a 字軌 range the merchant obtained from 財政部. */
export async function createTrack(
  config: EzpayConfig,
  input: CreateTrackInput,
): Promise<EzpayTrack> {
  if (!/^[A-Z]{2}$/.test(input.letters)) {
    throw invalid(`ezPay 字軌 letters must be two uppercase letters, got ${input.letters}`);
  }
  const start = invoiceNo(input.startNumber, "startNumber");
  const end = invoiceNo(input.endNumber, "endNumber");
  if (Number(end) < Number(start)) {
    throw invalid(`ezPay 字軌 endNumber ${end} is before startNumber ${start}`);
  }
  const { result } = await trackRequest(config, ENDPOINTS.trackCreate, {
    Year: rocYear(input.year),
    Term: term(input.term),
    AphabeticLetter: input.letters,
    StartNumber: start,
    EndNumber: end,
    Type: input.type ?? "07",
  });
  return single(config, result);
}

/** 字軌資料管理 — pause, activate or (irreversibly) disable a 字軌 range. */
export async function setTrackStatus(
  config: EzpayConfig,
  input: SetTrackStatusInput,
): Promise<EzpayTrack> {
  if (!input.managementNo) throw invalid("ezPay 字軌 managementNo is required");
  const flag = STATUS_TO_FLAG[input.status];
  if (!flag) throw invalid(`ezPay 字軌 status must be PAUSED/ACTIVE/DISABLED, got ${input.status}`);
  const { result } = await trackRequest(config, ENDPOINTS.trackManage, {
    ManagementNo: input.managementNo,
    Year: rocYear(input.year),
    Flag: flag,
  });
  return single(config, result);
}

/**
 * 字軌資料查詢 — list the 字軌 ranges of a period. Resolves `[]` when ezPay
 * answers 查無資料 (live: `INM10002` with `Result: []`) rather than rejecting.
 */
export async function searchTracks(
  config: EzpayConfig,
  input: SearchTracksInput,
): Promise<EzpayTrack[]> {
  const flag = input.status === undefined ? undefined : STATUS_TO_FLAG[input.status];
  if (input.status !== undefined && !flag) {
    throw invalid(`ezPay 字軌 status must be PAUSED/ACTIVE/DISABLED, got ${input.status}`);
  }
  let result: unknown;
  try {
    ({ result } = await trackRequest(config, ENDPOINTS.trackSearch, {
      Year: rocYear(input.year),
      Term: term(input.term),
      ManagementNo: input.managementNo,
      Flag: flag,
    }));
  } catch (e) {
    if (isInvoiceError(e) && e.code === InvoiceErrorCode.NOT_FOUND) return [];
    throw e;
  }
  const entries = Array.isArray(result) ? result : result ? [result] : [];
  return entries.map((entry) => toTrack(config, entry as Record<string, unknown>));
}

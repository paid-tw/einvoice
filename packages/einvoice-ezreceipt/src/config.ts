import type { BaseProviderConfig } from "@paid-tw/einvoice";

/**
 * ezReceipt 易發票 (COIMOTION API) config. Every request carries the application
 * headers `x-deva-appcode` + `x-deva-appkey`; privileged operations also need an
 * `x-deva-token` obtained by logging in (accName + sha1-hashed password). The
 * client logs in lazily, caches the token, and re-logs in on `-3 Invalid token`.
 */
export interface EzreceiptConfig extends BaseProviderConfig {
  /** `x-deva-appcode` — the application code (usually the company 統一編號). */
  appCode: string;
  /** `x-deva-appkey` — the application key paired with `appCode`. */
  appKey: string;
  /** Login account name (a DEDICATED API account — see notes). */
  accName: string;
  /**
   * Plaintext login password. Hashed locally as `sha1(sha1(accName)+password)`
   * before it is sent — the plaintext never leaves the process. Optional when a
   * pre-obtained {@link token} is supplied.
   */
  password?: string;
  /** A pre-obtained access token, to skip the login round-trip. */
  token?: string;
  /**
   * Store id for partner/合作廠商 access (a URL path / `x-deva-stid` value used to
   * act on a specific store). Normal single-store accounts can omit it.
   */
  stID?: string | number;
  /** Validate the issue payload locally before sending (default `true`). */
  validatePayload?: boolean;
}

/**
 * ezReceipt API hosts. The environment is the host, not the credentials.
 */
export const EZRECEIPT_BASE_URL = {
  TEST: "https://tryapi.ezreceipt.cc",
  PRODUCTION: "https://api.ezreceipt.cc",
} as const;

export function resolveBaseUrl(config: EzreceiptConfig): string {
  if (config.baseUrl) return config.baseUrl;
  return config.mode === "PRODUCTION" ? EZRECEIPT_BASE_URL.PRODUCTION : EZRECEIPT_BASE_URL.TEST;
}

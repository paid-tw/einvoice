import type { BaseProviderConfig } from "@paid-tw/einvoice";

export interface AmegoRetryOptions {
  /** Max retry attempts (network/timeout only). Default 3. */
  maxRetries?: number;
  /** Base backoff delay in ms. Default 500. */
  baseDelayMs?: number;
  /** Max backoff delay in ms. Default 10_000. */
  maxDelayMs?: number;
}

export interface AmegoConfig extends BaseProviderConfig {
  /** 賣方統一編號 — the seller's tax id registered with Amego (the `invoice` field). */
  sellerUbn: string;
  /** App key used to sign requests. Keep server-side only. */
  appKey: string;
  /**
   * Sync the request timestamp against the server clock (`/json/time`, cached
   * 5 min) to avoid error 15 「Time 錯誤」 on machines with clock skew.
   * Default false.
   */
  syncTime?: boolean;
  /**
   * Auto-retry transient network/timeout failures with exponential backoff.
   * `true` uses defaults; pass options to tune; omit/`false` to disable.
   */
  retry?: boolean | AmegoRetryOptions;
  /**
   * Validate the built f0401 payload locally before sending (default `true`).
   * Catches field errors — including ones Amego silently accepts (bad email,
   * malformed Currency, etc.) — with a clear message. Set `false` to bypass.
   */
  validatePayload?: boolean;
}

/**
 * Amego uses a single host for both test and production; the environment is
 * selected by the credentials (`sellerUbn` + `appKey`), not the URL.
 * See https://invoice.amego.tw/api_doc/.
 */
export const AMEGO_BASE_URL = "https://invoice-api.amego.tw";

export function resolveBaseUrl(config: AmegoConfig): string {
  return config.baseUrl ?? AMEGO_BASE_URL;
}

export function resolveRetry(config: AmegoConfig): Required<AmegoRetryOptions> | null {
  if (!config.retry) return null;
  const opts = config.retry === true ? {} : config.retry;
  return {
    maxRetries: opts.maxRetries ?? 3,
    baseDelayMs: opts.baseDelayMs ?? 500,
    maxDelayMs: opts.maxDelayMs ?? 10_000,
  };
}

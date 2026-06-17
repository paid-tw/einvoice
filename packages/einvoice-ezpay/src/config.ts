import type { BaseProviderConfig } from "@paid-tw/einvoice";

export interface EzpayConfig extends BaseProviderConfig {
  /** 商店代號 — the ezPay merchant id (`MerchantID_`). */
  merchantId: string;
  /** 32-char AES HashKey. Keep server-side only. */
  hashKey: string;
  /** 16-char AES HashIV. Keep server-side only. */
  hashIV: string;
  /** Response format. Default `"JSON"`. */
  respondType?: "JSON" | "String";
  /** Validate the built issue payload locally before sending (default `true`). */
  validatePayload?: boolean;
}

/**
 * ezPay hosts: test `cinv`, production `inv`. The environment is selected by the
 * host, not the credentials. See the ezPay 電子發票技術串接手冊.
 */
export const EZPAY_BASE_URL = {
  TEST: "https://cinv.ezpay.com.tw",
  PRODUCTION: "https://inv.ezpay.com.tw",
} as const;

export function resolveBaseUrl(config: EzpayConfig): string {
  if (config.baseUrl) return config.baseUrl;
  return config.mode === "PRODUCTION" ? EZPAY_BASE_URL.PRODUCTION : EZPAY_BASE_URL.TEST;
}

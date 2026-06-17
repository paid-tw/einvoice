import type { BaseProviderConfig } from "@paid-tw/einvoice";

export interface EcpayConfig extends BaseProviderConfig {
  /** 特店編號 (MerchantID). */
  merchantId: string;
  /** 16-byte AES HashKey. Keep server-side only. */
  hashKey: string;
  /** 16-byte AES HashIV. Keep server-side only. */
  hashIV: string;
  /** Validate the built payload locally before sending (default `true`). */
  validatePayload?: boolean;
}

/**
 * ECPay's public shared **sandbox** credentials for the B2C e-invoice API,
 * published for testing. Use them to try the SDK without an account:
 * `createEcpayProvider(ECPAY_SANDBOX)`. Never use these in production.
 */
export const ECPAY_SANDBOX = {
  merchantId: "2000132",
  hashKey: "ejCk326UnaZWKisg",
  hashIV: "q9jcZX8Ib9LM8wYk",
} as const;

/** B2C 電子發票 hosts: stage vs production (selected by `mode`). */
export const ECPAY_BASE_URL = {
  TEST: "https://einvoice-stage.ecpay.com.tw",
  PRODUCTION: "https://einvoice.ecpay.com.tw",
} as const;

export function resolveBaseUrl(config: EcpayConfig): string {
  if (config.baseUrl) return config.baseUrl;
  return config.mode === "PRODUCTION" ? ECPAY_BASE_URL.PRODUCTION : ECPAY_BASE_URL.TEST;
}

import type { BaseProviderConfig } from "@paid-tw/einvoice";

export interface AmegoConfig extends BaseProviderConfig {
  /** 賣方統一編號 — the seller's tax id registered with Amego (the `invoice` field). */
  sellerTaxId: string;
  /** App key used to sign requests. Keep server-side only. */
  appKey: string;
}

/**
 * Amego uses a single host for both test and production; the environment is
 * selected by the credentials (`sellerTaxId` + `appKey`), not the URL.
 * See https://invoice.amego.tw/api_doc/.
 */
export const AMEGO_BASE_URL = "https://invoice-api.amego.tw";

export function resolveBaseUrl(config: AmegoConfig): string {
  return config.baseUrl ?? AMEGO_BASE_URL;
}

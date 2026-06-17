import { InvoiceError, InvoiceErrorCode } from "./errors.js";
import type { InvoiceProvider } from "./provider.js";

/**
 * Feature flags a provider may or may not support. Every adapter declares its
 * own set so callers can feature-detect at runtime instead of discovering a
 * gap only when a request fails.
 *
 * The five core operations are listed so a degraded/partial adapter can be
 * honest about what it omits; the rest cover optional behaviour that genuinely
 * differs between value-added centers.
 */
export const Capability = {
  /** 開立發票. */
  ISSUE: "ISSUE",
  /** 作廢發票. */
  VOID: "VOID",
  /** 開立折讓. */
  ALLOWANCE: "ALLOWANCE",
  /** 作廢折讓. */
  VOID_ALLOWANCE: "VOID_ALLOWANCE",
  /** 查詢發票. */
  QUERY: "QUERY",
  /** Issue to a business buyer with a 統一編號 (B2B). */
  B2B: "B2B",
  /** Mixed tax-rate invoice (應稅 + 零稅率 + 免稅 in one document). */
  MIXED_TAX: "MIXED_TAX",
  /** Look up an invoice by the merchant order id, not just the invoice number. */
  QUERY_BY_ORDER_ID: "QUERY_BY_ORDER_ID",
  /** Schedule an invoice to be issued automatically at a future date. */
  SCHEDULED_ISSUE: "SCHEDULED_ISSUE",
  /** Validate a carrier (手機條碼 / 愛心碼) against the tax authority. */
  CARRIER_VALIDATION: "CARRIER_VALIDATION",
  /**
   * Annotate a foreign-currency sale via `currency` + `exchangeRate`. The
   * statutory amounts are still filed in integer TWD; this only records the
   * original transaction's currency. Providers that don't support it reject a
   * non-TWD `currency` instead of silently dropping it.
   */
  FOREIGN_CURRENCY: "FOREIGN_CURRENCY",
} as const;
export type Capability = (typeof Capability)[keyof typeof Capability];

/** Whether `provider` declares support for `capability`. */
export function supports(provider: InvoiceProvider, capability: Capability): boolean {
  return provider.capabilities.has(capability);
}

/**
 * Thrown when a caller asks a provider to do something it does not support.
 * It is an {@link InvoiceError} (code `UNSUPPORTED`) so existing catch sites
 * keep working.
 */
export class UnsupportedCapabilityError extends InvoiceError {
  readonly capability: Capability;

  constructor(provider: string, capability: Capability) {
    super(`Provider "${provider}" does not support capability "${capability}"`, {
      provider,
      code: InvoiceErrorCode.UNSUPPORTED,
    });
    this.name = "UnsupportedCapabilityError";
    this.capability = capability;
  }
}

/** Throw {@link UnsupportedCapabilityError} unless `provider` supports `capability`. */
export function assertSupports(provider: InvoiceProvider, capability: Capability): void {
  if (!supports(provider, capability)) {
    throw new UnsupportedCapabilityError(provider.name, capability);
  }
}

/**
 * Normalized error codes. Adapters map provider/MOF error codes onto these so
 * callers can branch on a stable, provider-independent set.
 */
export const InvoiceErrorCode = {
  /** Auth / signature / credential failure. */
  AUTH: "AUTH",
  /** Request failed local or remote validation. */
  VALIDATION: "VALIDATION",
  /** Referenced invoice/allowance does not exist. */
  NOT_FOUND: "NOT_FOUND",
  /** Operation invalid for the invoice's current state (e.g. void a voided one). */
  CONFLICT: "CONFLICT",
  /** 字軌 / 配號 exhausted — no invoice number available. */
  NUMBER_EXHAUSTED: "NUMBER_EXHAUSTED",
  /** Network / timeout / transport failure. */
  NETWORK: "NETWORK",
  /** Provider returned an error we could not map. */
  PROVIDER: "PROVIDER",
  /** The provider does not support the requested operation/feature. */
  UNSUPPORTED: "UNSUPPORTED",
  /** Anything else. */
  UNKNOWN: "UNKNOWN",
} as const;
export type InvoiceErrorCode = (typeof InvoiceErrorCode)[keyof typeof InvoiceErrorCode];

export interface InvoiceErrorOptions {
  provider: string;
  code: InvoiceErrorCode;
  /** The provider's raw status/error code, preserved verbatim. */
  rawCode?: string;
  rawMessage?: string;
  /** The raw response payload for debugging. */
  raw?: unknown;
  cause?: unknown;
}

/** The single error type all adapters throw. */
export class InvoiceError extends Error {
  readonly provider: string;
  readonly code: InvoiceErrorCode;
  readonly rawCode?: string;
  readonly rawMessage?: string;
  readonly raw?: unknown;

  constructor(message: string, options: InvoiceErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "InvoiceError";
    this.provider = options.provider;
    this.code = options.code;
    this.rawCode = options.rawCode;
    this.rawMessage = options.rawMessage;
    this.raw = options.raw;
  }

  /**
   * Structured-logging shape. By default `JSON.stringify(error)` only keeps an
   * Error's enumerable own properties (dropping `message`, `code`, …); this keeps
   * the normalized fields. `raw` is intentionally omitted (it can be large or
   * carry sensitive payloads — read it off the instance when you need it).
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      provider: this.provider,
      code: this.code,
      message: this.message,
      rawCode: this.rawCode,
      rawMessage: this.rawMessage,
    };
  }
}

export function isInvoiceError(value: unknown): value is InvoiceError {
  return value instanceof InvoiceError;
}

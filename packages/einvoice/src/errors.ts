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

/**
 * Normalized ACTION-oriented semantics, one level finer than
 * {@link InvoiceErrorCode}. The codes are deliberately coarse (`CONFLICT`
 * alone covers duplicate-order, void-blocked-by-allowance, already-voided and
 * past-deadline — four situations a caller handles completely differently),
 * which forces consumers to hand-roll per-provider raw-code tables. `reason`
 * is that table, maintained once per adapter, `undefined` when unknown.
 *
 * Each value implies a concrete consumer action:
 * - `duplicate_order` — the invoice already exists: query-and-adopt it.
 * - `void_blocked_by_allowance` — fall back to issuing an allowance.
 * - `already_voided` — treat as idempotent success.
 * - `duplicate_allowance` — the allowance already exists: adopt / skip.
 * - `past_deadline` — cannot be automated; hand to a human.
 * - `carrier_not_registered` — retry the issue without the carrier.
 * - `rate_limited` — back off and retry later.
 * - credential sub-kinds (`credentials_invalid` / `not_enrolled` /
 *   `contract_expired` / `ip_blocked` / `account_suspended` /
 *   `stale_timestamp`) — each needs a different merchant-side fix; pair with
 *   the adapters' `*ErrorHint` helpers for display copy.
 */
export const InvoiceErrorReason = {
  DUPLICATE_ORDER: "duplicate_order",
  VOID_BLOCKED_BY_ALLOWANCE: "void_blocked_by_allowance",
  ALREADY_VOIDED: "already_voided",
  DUPLICATE_ALLOWANCE: "duplicate_allowance",
  PAST_DEADLINE: "past_deadline",
  CARRIER_NOT_REGISTERED: "carrier_not_registered",
  RATE_LIMITED: "rate_limited",
  CREDENTIALS_INVALID: "credentials_invalid",
  NOT_ENROLLED: "not_enrolled",
  CONTRACT_EXPIRED: "contract_expired",
  IP_BLOCKED: "ip_blocked",
  ACCOUNT_SUSPENDED: "account_suspended",
  STALE_TIMESTAMP: "stale_timestamp",
} as const;
export type InvoiceErrorReason = (typeof InvoiceErrorReason)[keyof typeof InvoiceErrorReason];

export interface InvoiceErrorOptions {
  provider: string;
  code: InvoiceErrorCode;
  /** Normalized semantic, when the adapter can determine one. */
  reason?: InvoiceErrorReason;
  /** The provider's raw status/error code, preserved verbatim. */
  rawCode?: string;
  rawMessage?: string;
  /** The raw response payload for debugging. */
  raw?: unknown;
  cause?: unknown;
}

/**
 * Brand stored under a globally-registered symbol (shared across realms via the
 * `Symbol.for` registry). `isInvoiceError` checks this instead of `instanceof`,
 * so the guard still works when two copies of this package are loaded — dual
 * ESM/CJS resolution, or a consumer with a transitive version mismatch — where
 * `instanceof` would silently return false.
 */
const INVOICE_ERROR_BRAND = Symbol.for("@paid-tw/einvoice.InvoiceError");

/** The single error type all adapters throw. */
export class InvoiceError extends Error {
  readonly provider: string;
  readonly code: InvoiceErrorCode;
  readonly reason?: InvoiceErrorReason;
  readonly rawCode?: string;
  readonly rawMessage?: string;
  readonly raw?: unknown;

  constructor(message: string, options: InvoiceErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "InvoiceError";
    this.provider = options.provider;
    this.code = options.code;
    this.reason = options.reason;
    this.rawCode = options.rawCode;
    this.rawMessage = options.rawMessage;
    this.raw = options.raw;
    // Non-enumerable so it stays out of JSON / property enumeration.
    Object.defineProperty(this, INVOICE_ERROR_BRAND, { value: true });
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
      // Included only when set so log shapes (and exact-equality tests on
      // errors without a reason) are unchanged.
      ...(this.reason !== undefined ? { reason: this.reason } : {}),
      message: this.message,
      rawCode: this.rawCode,
      rawMessage: this.rawMessage,
    };
  }
}

export function isInvoiceError(value: unknown): value is InvoiceError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[INVOICE_ERROR_BRAND] === true
  );
}

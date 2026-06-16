/**
 * Provider-agnostic domain model for Taiwan e-invoices (財政部 MIG 4.0).
 *
 * Every adapter (Amego, ECPay, ezPay, MOF…) maps these unified types to/from
 * its own wire format. Business code should depend ONLY on these types so that
 * switching providers never touches application logic.
 *
 * Money convention: the invoice's statutory amount fields are integers in New
 * Taiwan Dollars (no decimals) — this is a MIG invariant: even cross-border
 * invoices are filed to the government platform in TWD. For a foreign-currency
 * sale, set `currency` (ISO 4217) and `exchangeRate` on the invoice to annotate
 * the original transaction; the amount fields stay TWD.
 */

// ---------------------------------------------------------------------------
// Enums / unions
// ---------------------------------------------------------------------------

/** 課稅別 — maps to MIG `TaxType`. */
export const TaxType = {
  /** 應稅 (5% business tax) */
  TAXABLE: "TAXABLE",
  /** 零稅率 (exports etc.) */
  ZERO_RATED: "ZERO_RATED",
  /** 免稅 */
  TAX_FREE: "TAX_FREE",
  /** 特種稅額 */
  SPECIAL: "SPECIAL",
} as const;
export type TaxType = (typeof TaxType)[keyof typeof TaxType];

/**
 * Invoice category. Derived from whether the buyer has a 統一編號 (taxId):
 * B2B = triplicate (三聯式), B2C = duplicate (二聯式).
 */
export const InvoiceCategory = {
  B2B: "B2B",
  B2C: "B2C",
} as const;
export type InvoiceCategory = (typeof InvoiceCategory)[keyof typeof InvoiceCategory];

/** Whether item/line amounts already include the 5% business tax. */
export const PriceMode = {
  TAX_INCLUSIVE: "TAX_INCLUSIVE",
  TAX_EXCLUSIVE: "TAX_EXCLUSIVE",
} as const;
export type PriceMode = (typeof PriceMode)[keyof typeof PriceMode];

/** 載具類別. */
export const CarrierType = {
  /** 手機條碼 — code like `/ABC1234` (MIG 3J0002) */
  MOBILE_BARCODE: "MOBILE_BARCODE",
  /** 自然人憑證條碼 — 16-char code (MIG CQ0001) */
  CITIZEN_CERTIFICATE: "CITIZEN_CERTIFICATE",
  /** 會員載具 / 通用載具 issued by the value-added center (MIG EJ0113 etc.) */
  MEMBER: "MEMBER",
} as const;
export type CarrierType = (typeof CarrierType)[keyof typeof CarrierType];

/** Lifecycle status of an invoice as reported by a provider. */
export const InvoiceStatus = {
  ISSUED: "ISSUED",
  VOIDED: "VOIDED",
  /** Has at least one active allowance (折讓). */
  ALLOWANCE: "ALLOWANCE",
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

// ---------------------------------------------------------------------------
// Shared value objects
// ---------------------------------------------------------------------------

export interface Buyer {
  /** 買受人名稱. Defaults to a placeholder for anonymous B2C if omitted. */
  name?: string;
  /** 統一編號 (8 digits). Presence implies a B2B / triplicate invoice. */
  taxId?: string;
  /** Used by providers to email the invoice / notify the buyer. */
  email?: string;
  /** 買受人地址 (mainly B2B). */
  address?: string;
  phone?: string;
}

export interface Carrier {
  type: CarrierType;
  /**
   * 載具號碼.
   * - MOBILE_BARCODE: `/` + 7 chars
   * - CITIZEN_CERTIFICATE: 16 alphanumeric chars
   * - MEMBER: provider-defined; often omitted (provider links by email/member id)
   */
  code?: string;
}

/** 捐贈 — donating the invoice to a charity by 愛心碼. */
export interface Donation {
  /** 愛心碼 (3–7 digits). */
  npoban: string;
}

export interface InvoiceItem {
  /** 品名. */
  description: string;
  /** 數量. */
  quantity: number;
  /** 單價 (per `priceMode`). */
  unitPrice: number;
  /** 金額 = quantity × unitPrice (per `priceMode`). */
  amount: number;
  /** 單位 (e.g. 個, 件). */
  unit?: string;
  /** Per-line tax type. Required only for mixed-tax (混合稅率) invoices. */
  taxType?: TaxType;
  /** 備註 for this line. */
  remark?: string;
}

/** Monetary summary for the whole invoice. */
export interface AmountSummary {
  /** 銷售額 (untaxed total). */
  salesAmount: number;
  /** 營業稅額. */
  taxAmount: number;
  /** 總計 = salesAmount + taxAmount. */
  totalAmount: number;
}

// ---------------------------------------------------------------------------
// Issue (開立)
// ---------------------------------------------------------------------------

export interface IssueInvoiceInput {
  /** Your system's order/reference id. Used for idempotency + reconciliation. */
  orderId: string;
  buyer: Buyer;
  items: InvoiceItem[];
  /** Overall amount summary. Adapters validate this against `items`. */
  amount: AmountSummary;
  /** Invoice-level tax type. For mixed-tax invoices, also set per-item taxType. */
  taxType: TaxType;
  /** Business tax rate. Defaults to 0.05 when applicable. */
  taxRate?: number;
  priceMode: PriceMode;
  /**
   * Category. Optional — if omitted, adapters derive it from `buyer.taxId`
   * (taxId present → B2B, else B2C).
   */
  category?: InvoiceCategory;
  /** Mutually exclusive with `donation` in practice. */
  carrier?: Carrier;
  donation?: Donation;
  /** 備註. */
  remark?: string;
  /**
   * ISO 4217 currency of the original transaction (e.g. `"USD"`). Defaults to
   * `"TWD"`. The statutory amount fields remain TWD regardless — this annotates
   * a cross-border sale. Providers that don't support it ignore it.
   */
  currency?: string;
  /** Exchange rate to TWD (≤3-decimal precision), required when `currency` ≠ TWD. */
  exchangeRate?: number;
  /** Issue date. Defaults to "now" in Asia/Taipei when omitted. */
  date?: Date;
  /** Escape hatch for provider-specific fields not covered by the unified model. */
  providerOptions?: Record<string, unknown>;
}

export interface IssueInvoiceResult {
  /** 發票號碼, e.g. `AB12345678`. */
  invoiceNumber: string;
  /** 發票開立日期. */
  invoiceDate: Date;
  /** 隨機碼 (4 digits). */
  randomCode: string;
  /** Echoed `orderId`. */
  orderId: string;
  totalAmount: number;
  status: InvoiceStatus;
  /** Raw provider response, for debugging / audit. */
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Void (作廢)
// ---------------------------------------------------------------------------

export interface VoidInvoiceInput {
  invoiceNumber: string;
  /** 作廢原因. */
  reason: string;
  date?: Date;
  providerOptions?: Record<string, unknown>;
}

export interface VoidInvoiceResult {
  invoiceNumber: string;
  status: InvoiceStatus;
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Allowance (折讓) and its cancellation (折讓作廢)
// ---------------------------------------------------------------------------

export interface AllowanceInput {
  /** The original invoice being credited. */
  invoiceNumber: string;
  /** Your reference id for this allowance. */
  allowanceId: string;
  /** Lines being credited (a subset/partial of the original invoice). */
  items: InvoiceItem[];
  /** Total allowance amount (tax inclusive of the credited tax). */
  amount: AmountSummary;
  date?: Date;
  providerOptions?: Record<string, unknown>;
}

export interface AllowanceResult {
  /** 折讓單號碼. */
  allowanceNumber: string;
  invoiceNumber: string;
  allowanceDate: Date;
  totalAmount: number;
  raw: unknown;
}

export interface VoidAllowanceInput {
  invoiceNumber: string;
  allowanceNumber: string;
  reason?: string;
  providerOptions?: Record<string, unknown>;
}

export interface VoidAllowanceResult {
  allowanceNumber: string;
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Query (查詢)
// ---------------------------------------------------------------------------

export interface QueryInvoiceInput {
  /** Query by invoice number, or by your `orderId` — at least one required. */
  invoiceNumber?: string;
  orderId?: string;
  providerOptions?: Record<string, unknown>;
}

export interface QueryInvoiceResult {
  invoiceNumber: string;
  invoiceDate: Date;
  randomCode: string;
  orderId?: string;
  status: InvoiceStatus;
  amount: AmountSummary;
  buyer: Buyer;
  items: InvoiceItem[];
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

export const ProviderMode = {
  TEST: "TEST",
  PRODUCTION: "PRODUCTION",
} as const;
export type ProviderMode = (typeof ProviderMode)[keyof typeof ProviderMode];

/** Fields every adapter's config shares; adapters extend this with credentials. */
export interface BaseProviderConfig {
  mode?: ProviderMode;
  /** Override the API base URL (useful for sandboxes / proxies). */
  baseUrl?: string;
  /** Request timeout in ms. */
  timeoutMs?: number;
  /** Inject a custom fetch (testing, custom agents, edge runtimes). */
  fetch?: typeof fetch;
}

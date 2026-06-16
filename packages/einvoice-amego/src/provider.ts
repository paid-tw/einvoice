import {
  type AllowanceInput,
  type AllowanceResult,
  type Carrier,
  deriveCategory,
  type InvoiceProvider,
  InvoiceStatus,
  type IssueInvoiceInput,
  type IssueInvoiceResult,
  type QueryInvoiceInput,
  type QueryInvoiceResult,
  type VoidAllowanceInput,
  type VoidAllowanceResult,
  type VoidInvoiceInput,
  type VoidInvoiceResult,
  allowanceInputSchema,
  issueInvoiceInputSchema,
  queryInvoiceInputSchema,
  voidAllowanceInputSchema,
  voidInvoiceInputSchema,
} from "@paid-tw/einvoice";
import { computeAmegoAmounts } from "./amounts.js";
import { type AmegoResponse, amegoRequest } from "./client.js";
import type { AmegoConfig } from "./config.js";
import { ENDPOINTS } from "./endpoints.js";

/** Amego/MIG carrier type codes. */
const CARRIER_TYPE: Record<Carrier["type"], string> = {
  MOBILE_BARCODE: "3J0002",
  CITIZEN_CERTIFICATE: "CQ0001",
  MEMBER: "EJ0113",
};

/** Convert an Amego unix `*_time` field to a Date. */
function fromAmegoTime(value: unknown): Date {
  if (typeof value === "number") return new Date(value * 1000);
  const n = Number(value);
  return Number.isFinite(n) ? new Date(n * 1000) : new Date();
}

export class AmegoProvider implements InvoiceProvider {
  readonly name = "amego";

  constructor(private readonly config: AmegoConfig) {}

  /** Escape hatch: call any Amego endpoint directly with a raw payload. */
  raw(path: string, data?: Record<string, unknown>): Promise<AmegoResponse> {
    return amegoRequest(this.config, path, data ?? {});
  }

  // -------------------------------------------------------------------------
  // Unified InvoiceProvider
  // -------------------------------------------------------------------------

  async issue(input: IssueInvoiceInput): Promise<IssueInvoiceResult> {
    const parsed = issueInvoiceInputSchema.parse(input);
    const category = parsed.category ?? deriveCategory(parsed.buyer);
    const amounts = computeAmegoAmounts({
      total: parsed.amount.totalAmount,
      taxType: parsed.taxType,
      category,
      taxRate: parsed.taxRate,
    });

    const data: Record<string, unknown> = {
      OrderId: parsed.orderId,
      BuyerIdentifier: parsed.buyer.taxId ?? "0000000000",
      BuyerName: parsed.buyer.name ?? (category === "B2B" ? "" : "消費者"),
      BuyerEmailAddress: parsed.buyer.email,
      BuyerAddress: parsed.buyer.address,
      ...carrierFields(parsed.carrier),
      NPOBAN: parsed.donation?.npoban,
      ...amounts,
      ProductItem: parsed.items.map((item) => ({
        Description: item.description,
        Quantity: item.quantity,
        UnitPrice: item.unitPrice,
        Amount: item.amount, // tax-inclusive; must sum to TotalAmount
        Unit: item.unit,
        Remark: item.remark,
        TaxType: item.taxType ? String(amounts.TaxType) : undefined,
      })),
      ...(parsed.providerOptions ?? {}),
    };

    const res = await amegoRequest(this.config, ENDPOINTS.issue, data);
    return {
      invoiceNumber: String(res.invoice_number ?? ""),
      invoiceDate: fromAmegoTime(res.invoice_time),
      randomCode: String(res.random_number ?? ""),
      orderId: parsed.orderId,
      totalAmount: parsed.amount.totalAmount,
      status: InvoiceStatus.ISSUED,
      raw: res,
    };
  }

  async void(input: VoidInvoiceInput): Promise<VoidInvoiceResult> {
    const parsed = voidInvoiceInputSchema.parse(input);
    const res = await amegoRequest(this.config, ENDPOINTS.void, {
      InvoiceNumber: parsed.invoiceNumber,
      CancelReason: parsed.reason,
      ...(parsed.providerOptions ?? {}),
    });
    return {
      invoiceNumber: parsed.invoiceNumber,
      status: InvoiceStatus.VOIDED,
      raw: res,
    };
  }

  async allowance(input: AllowanceInput): Promise<AllowanceResult> {
    const parsed = allowanceInputSchema.parse(input);
    const res = await amegoRequest(this.config, ENDPOINTS.allowance, {
      InvoiceNumber: parsed.invoiceNumber,
      AllowanceId: parsed.allowanceId,
      TotalAmount: parsed.amount.totalAmount,
      TaxAmount: parsed.amount.taxAmount,
      SalesAmount: parsed.amount.salesAmount,
      ProductItem: parsed.items.map((item) => ({
        Description: item.description,
        Quantity: item.quantity,
        UnitPrice: item.unitPrice,
        Amount: item.amount,
        TaxType: item.taxType,
      })),
      ...(parsed.providerOptions ?? {}),
    });
    return {
      allowanceNumber: String(res.allowance_number ?? ""),
      invoiceNumber: parsed.invoiceNumber,
      allowanceDate: fromAmegoTime(res.allowance_time),
      totalAmount: parsed.amount.totalAmount,
      raw: res,
    };
  }

  async voidAllowance(input: VoidAllowanceInput): Promise<VoidAllowanceResult> {
    const parsed = voidAllowanceInputSchema.parse(input);
    const res = await amegoRequest(this.config, ENDPOINTS.voidAllowance, {
      InvoiceNumber: parsed.invoiceNumber,
      AllowanceNumber: parsed.allowanceNumber,
      CancelReason: parsed.reason,
      ...(parsed.providerOptions ?? {}),
    });
    return { allowanceNumber: parsed.allowanceNumber, raw: res };
  }

  async query(input: QueryInvoiceInput): Promise<QueryInvoiceResult> {
    const parsed = queryInvoiceInputSchema.parse(input);
    const res = await amegoRequest(this.config, ENDPOINTS.invoiceQuery, {
      InvoiceNumber: parsed.invoiceNumber,
      OrderId: parsed.orderId,
      ...(parsed.providerOptions ?? {}),
    });
    return {
      invoiceNumber: String(res.invoice_number ?? parsed.invoiceNumber ?? ""),
      invoiceDate: fromAmegoTime(res.invoice_time),
      randomCode: String(res.random_number ?? ""),
      orderId: parsed.orderId,
      status: mapInvoiceStatus(res),
      amount: {
        salesAmount: Number(res.SalesAmount ?? res.sales_amount ?? 0),
        taxAmount: Number(res.TaxAmount ?? res.tax_amount ?? 0),
        totalAmount: Number(res.TotalAmount ?? res.total_amount ?? 0),
      },
      buyer: {
        name: res.BuyerName ? String(res.BuyerName) : undefined,
        taxId:
          res.BuyerIdentifier && res.BuyerIdentifier !== "0000000000"
            ? String(res.BuyerIdentifier)
            : undefined,
      },
      items: [],
      raw: res,
    };
  }

  // -------------------------------------------------------------------------
  // Amego-specific extensions (not part of the cross-provider interface)
  // -------------------------------------------------------------------------

  /** 發票 management endpoints. */
  readonly invoice = {
    query: (data: { invoiceNumber?: string; orderId?: string } & Record<string, unknown>) =>
      this.raw(ENDPOINTS.invoiceQuery, normalizeRef(data)),
    list: (data?: Record<string, unknown>) => this.raw(ENDPOINTS.invoiceList, data),
    print: (data: { invoiceNumber: string } & Record<string, unknown>) =>
      this.raw(ENDPOINTS.invoicePrint, normalizeRef(data)),
    file: (data: { invoiceNumber: string } & Record<string, unknown>) =>
      this.raw(ENDPOINTS.invoiceFile, normalizeRef(data)),
    status: (data: { invoiceNumber: string } & Record<string, unknown>) =>
      this.raw(ENDPOINTS.invoiceStatus, normalizeRef(data)),
    /** 開立發票 (自訂配號). */
    issueCustom: (data: Record<string, unknown>) => this.raw(ENDPOINTS.issueCustom, data),
  };

  /** 折讓 management endpoints. */
  readonly allowances = {
    query: (data: Record<string, unknown>) => this.raw(ENDPOINTS.allowanceQuery, data),
    list: (data?: Record<string, unknown>) => this.raw(ENDPOINTS.allowanceList, data),
    print: (data: Record<string, unknown>) => this.raw(ENDPOINTS.allowancePrint, data),
    file: (data: Record<string, unknown>) => this.raw(ENDPOINTS.allowanceFile, data),
    status: (data: Record<string, unknown>) => this.raw(ENDPOINTS.allowanceStatus, data),
  };

  /** 中獎 endpoints. */
  readonly lottery = {
    status: (data?: Record<string, unknown>) => this.raw(ENDPOINTS.lotteryStatus, data),
    type: (data?: Record<string, unknown>) => this.raw(ENDPOINTS.lotteryType, data),
  };

  /** 字軌 (number track) endpoints for self-numbering merchants. */
  readonly track = {
    all: (data?: Record<string, unknown>) => this.raw(ENDPOINTS.trackAll, data),
    get: (data: Record<string, unknown>) => this.raw(ENDPOINTS.trackGet, data),
    status: (data?: Record<string, unknown>) => this.raw(ENDPOINTS.trackStatus, data),
  };

  /** 公司名稱查詢 — look up a company name by 統一編號. */
  banQuery(ban: string): Promise<AmegoResponse> {
    return this.raw(ENDPOINTS.banQuery, { ban });
  }

  /** 手機條碼查詢 — validate a mobile barcode carrier. */
  barcodeQuery(barcode: string): Promise<AmegoResponse> {
    return this.raw(ENDPOINTS.barcode, { barcode });
  }

  /** 伺服器時間 — useful to detect clock skew before signing. */
  time(): Promise<AmegoResponse> {
    return this.raw(ENDPOINTS.time);
  }
}

/** Create an Amego-backed {@link InvoiceProvider}. */
export function createAmegoProvider(config: AmegoConfig): AmegoProvider {
  return new AmegoProvider(config);
}

// --- helpers ---------------------------------------------------------------

function carrierFields(carrier?: Carrier): Record<string, unknown> {
  if (!carrier) return {};
  return {
    CarrierType: CARRIER_TYPE[carrier.type],
    CarrierId1: carrier.code,
    CarrierId2: carrier.code,
  };
}

function normalizeRef(
  data: { invoiceNumber?: string; orderId?: string } & Record<string, unknown>,
): Record<string, unknown> {
  const { invoiceNumber, orderId, ...rest } = data;
  return {
    ...(invoiceNumber ? { InvoiceNumber: invoiceNumber } : {}),
    ...(orderId ? { OrderId: orderId } : {}),
    ...rest,
  };
}

function mapInvoiceStatus(res: AmegoResponse): InvoiceStatus {
  // VERIFY: confirm Amego's status field/values for invoice_query. Defaults to
  // ISSUED when the field is absent.
  const status = res.status ?? res.invoice_status;
  if (status === "V" || status === "voided" || status === 2)
    return InvoiceStatus.VOIDED;
  if (status === "A" || status === "allowance") return InvoiceStatus.ALLOWANCE;
  return InvoiceStatus.ISSUED;
}

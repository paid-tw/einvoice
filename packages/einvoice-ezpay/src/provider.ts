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
  type TaxType,
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
import { type EzpayResult, ezpayRequest, ezpayTimestamp } from "./client.js";
import type { EzpayConfig } from "./config.js";
import { ENDPOINTS } from "./endpoints.js";
import { assertValidIssuePayload } from "./validation.js";

/** Unified carrier type → ezPay CarrierType. */
const CARRIER_TYPE: Record<Carrier["type"], string> = {
  MOBILE_BARCODE: "0",
  CITIZEN_CERTIFICATE: "1",
  MEMBER: "2",
};

export class EzpayProvider implements InvoiceProvider {
  readonly name = "ezpay";

  constructor(private readonly config: EzpayConfig) {}

  private respondType() {
    return this.config.respondType ?? "JSON";
  }

  /** Escape hatch: call any ezPay endpoint with raw PostData_ params. */
  raw(path: string, postData: Record<string, string | number | undefined>): Promise<EzpayResult> {
    return ezpayRequest(this.config, path, postData);
  }

  // -------------------------------------------------------------------------
  // Unified InvoiceProvider
  // -------------------------------------------------------------------------

  async issue(input: IssueInvoiceInput): Promise<IssueInvoiceResult> {
    const parsed = issueInvoiceInputSchema.parse(input);
    const category = parsed.category ?? deriveCategory(parsed.buyer);
    const hasCarrierOrDonation = Boolean(parsed.carrier || parsed.donation);

    const postData: Record<string, string | number | undefined> = {
      RespondType: this.respondType(),
      Version: ENDPOINTS.issue.version,
      TimeStamp: ezpayTimestamp(),
      MerchantOrderNo: parsed.orderId,
      Status: "1", // 即時開立
      Category: category,
      BuyerName: parsed.buyer.name ?? (category === "B2B" ? "" : "消費者"),
      BuyerUBN: category === "B2B" ? parsed.buyer.ubn : undefined,
      BuyerAddress: parsed.buyer.address,
      BuyerEmail: parsed.buyer.email,
      ...carrierFields(parsed.carrier),
      LoveCode: parsed.donation?.npoban,
      // B2B always prints; B2C prints only when no carrier/donation.
      PrintFlag: category === "B2B" ? "Y" : hasCarrierOrDonation ? "N" : "Y",
      TaxType: ezpayTaxType(parsed.taxType),
      TaxRate: ezpayTaxRate(parsed.taxType, parsed.taxRate),
      Amt: parsed.amount.salesAmount, // 銷售額(未稅)
      TaxAmt: parsed.amount.taxAmount,
      TotalAmt: parsed.amount.totalAmount, // 含稅
      ItemName: parsed.items.map((i) => i.description).join("|"),
      ItemCount: parsed.items.map((i) => i.quantity).join("|"),
      ItemUnit: parsed.items.map((i) => i.unit ?? "個").join("|"),
      ItemPrice: parsed.items.map((i) => i.unitPrice).join("|"),
      ItemAmt: parsed.items.map((i) => i.amount).join("|"),
      Comment: parsed.remark,
      ...(parsed.providerOptions ?? {}),
    } as Record<string, string | number | undefined>;

    if (this.config.validatePayload !== false) assertValidIssuePayload(postData);

    const { result, raw } = await ezpayRequest(this.config, ENDPOINTS.issue.path, postData);
    return {
      invoiceNumber: String(result.InvoiceNumber ?? ""),
      invoiceDate: parseEzpayDate(result.CreateTime),
      randomCode: String(result.RandomNum ?? ""),
      orderId: parsed.orderId,
      totalAmount: parsed.amount.totalAmount,
      status: InvoiceStatus.ISSUED,
      raw,
    };
  }

  async void(input: VoidInvoiceInput): Promise<VoidInvoiceResult> {
    const parsed = voidInvoiceInputSchema.parse(input);
    const { raw } = await ezpayRequest(this.config, ENDPOINTS.void.path, {
      RespondType: this.respondType(),
      Version: ENDPOINTS.void.version,
      TimeStamp: ezpayTimestamp(),
      InvoiceNumber: parsed.invoiceNumber,
      InvalidReason: parsed.reason,
      ...(parsed.providerOptions ?? {}),
    });
    return { invoiceNumber: parsed.invoiceNumber, status: InvoiceStatus.VOIDED, raw };
  }

  async allowance(input: AllowanceInput): Promise<AllowanceResult> {
    const parsed = allowanceInputSchema.parse(input);
    const opts = (parsed.providerOptions ?? {}) as Record<string, unknown>;
    const taxRate = typeof opts.taxRate === "number" ? opts.taxRate : 0.05;
    // ezPay keys an allowance off the invoice number + the invoice's order no.
    const merchantOrderNo = (opts.merchantOrderNo as string) ?? parsed.allowanceId;

    const { result, raw } = await ezpayRequest(this.config, ENDPOINTS.allowance.path, {
      RespondType: this.respondType(),
      Version: ENDPOINTS.allowance.version,
      TimeStamp: ezpayTimestamp(),
      InvoiceNo: parsed.invoiceNumber,
      MerchantOrderNo: merchantOrderNo,
      ItemName: parsed.items.map((i) => i.description).join("|"),
      ItemCount: parsed.items.map((i) => i.quantity).join("|"),
      ItemUnit: parsed.items.map((i) => i.unit ?? "個").join("|"),
      ItemPrice: parsed.items.map((i) => i.unitPrice).join("|"),
      ItemAmt: parsed.items.map((i) => i.amount).join("|"),
      ItemTaxAmt: parsed.items.map((i) => Math.round(i.amount * taxRate)).join("|"),
      TotalAmt: parsed.amount.salesAmount + parsed.amount.taxAmount,
      BuyerEmail: opts.buyerEmail as string | undefined,
      Status: (opts.status as string) ?? "1", // 立即確認折讓
      ...(opts.extra as Record<string, unknown> | undefined),
    });
    return {
      allowanceNumber: String(result.AllowanceNo ?? ""),
      invoiceNumber: parsed.invoiceNumber,
      allowanceDate: new Date(),
      totalAmount: parsed.amount.totalAmount,
      raw,
    };
  }

  async voidAllowance(input: VoidAllowanceInput): Promise<VoidAllowanceResult> {
    const parsed = voidAllowanceInputSchema.parse(input);
    const { raw } = await ezpayRequest(this.config, ENDPOINTS.voidAllowance.path, {
      RespondType: this.respondType(),
      Version: ENDPOINTS.voidAllowance.version,
      TimeStamp: ezpayTimestamp(),
      AllowanceNo: parsed.allowanceNumber,
      InvalidReason: parsed.reason ?? "作廢折讓",
      ...(parsed.providerOptions ?? {}),
    });
    return { allowanceNumber: parsed.allowanceNumber, raw };
  }

  async query(input: QueryInvoiceInput): Promise<QueryInvoiceResult> {
    const parsed = queryInvoiceInputSchema.parse(input);
    const opts = (parsed.providerOptions ?? {}) as Record<string, unknown>;
    // ezPay supports two lookups: by invoice number + random code (SearchType 0),
    // or by order number + total amount (SearchType 1).
    const byInvoice = Boolean(parsed.invoiceNumber);
    const postData: Record<string, string | number | undefined> = byInvoice
      ? {
          SearchType: "0",
          InvoiceNumber: parsed.invoiceNumber,
          RandomNum: opts.randomNum as string | undefined,
          MerchantOrderNo: parsed.orderId ?? (opts.merchantOrderNo as string) ?? "",
          TotalAmt: opts.totalAmt as number | undefined,
        }
      : {
          SearchType: "1",
          MerchantOrderNo: parsed.orderId,
          TotalAmt: opts.totalAmt as number | undefined,
          InvoiceNumber: opts.invoiceNumber as string | undefined,
          RandomNum: opts.randomNum as string | undefined,
        };

    const { result, raw } = await ezpayRequest(this.config, ENDPOINTS.search.path, {
      RespondType: this.respondType(),
      Version: ENDPOINTS.search.version,
      TimeStamp: ezpayTimestamp(),
      ...postData,
    });

    return {
      invoiceNumber: String(result.InvoiceNumber ?? parsed.invoiceNumber ?? ""),
      invoiceDate: parseEzpayDate(result.CreateTime),
      randomCode: String(result.RandomNum ?? ""),
      orderId: result.MerchantOrderNo ? String(result.MerchantOrderNo) : parsed.orderId,
      status: deriveStatus(result),
      amount: {
        salesAmount: Number(result.Amt ?? 0),
        taxAmount: Number(result.TaxAmt ?? 0),
        totalAmount: Number(result.TotalAmt ?? 0),
      },
      buyer: {
        name: result.BuyerName ? String(result.BuyerName) : undefined,
        ubn:
          result.BuyerUBN && result.BuyerUBN !== "0000000000"
            ? String(result.BuyerUBN)
            : undefined,
        email: result.BuyerEmail ? String(result.BuyerEmail) : undefined,
      },
      items: [],
      raw,
    };
  }
}

/** Create an ezPay-backed {@link InvoiceProvider}. */
export function createEzpayProvider(config: EzpayConfig): EzpayProvider {
  return new EzpayProvider(config);
}

// --- helpers ---------------------------------------------------------------

function carrierFields(carrier?: Carrier): Record<string, string | undefined> {
  if (!carrier) return {};
  return { CarrierType: CARRIER_TYPE[carrier.type], CarrierNum: carrier.code };
}

/** Unified TaxType → ezPay TaxType (1 應稅 / 2 零稅率 / 3 免稅 / 9 混合). */
export function ezpayTaxType(taxType: TaxType): string {
  switch (taxType) {
    case "TAXABLE":
    case "SPECIAL":
      return "1";
    case "ZERO_RATED":
      return "2";
    case "TAX_FREE":
      return "3";
  }
}

/** ezPay TaxRate is a percentage without `%` (e.g. 5); zero/free → 0. */
export function ezpayTaxRate(taxType: TaxType, taxRate?: number): number {
  if (taxType === "ZERO_RATED" || taxType === "TAX_FREE") return 0;
  return Math.round((taxRate ?? 0.05) * 100);
}

/** ezPay `CreateTime` ("YYYY-MM-DD HH:mm:ss", Asia/Taipei) → Date. */
function parseEzpayDate(value: unknown): Date {
  const s = String(value ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return new Date();
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`);
}

function deriveStatus(result: Record<string, unknown>): InvoiceStatus {
  const s = result.InvoiceStatus;
  if (s === "0" || s === 0) return InvoiceStatus.VOIDED;
  return InvoiceStatus.ISSUED;
}

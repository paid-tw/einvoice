import {
  type AllowanceInput,
  type AllowanceResult,
  Capability,
  type Carrier,
  deriveCategory,
  InvoiceError,
  InvoiceErrorCode,
  type InvoiceItem,
  type InvoiceProvider,
  InvoiceStatus,
  isValidMobileBarcode,
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
import { type EcpayResult, ecpayRequest } from "./client.js";
import type { EcpayConfig } from "./config.js";
import { ENDPOINTS } from "./endpoints.js";

/** Unified carrier type → ECPay CarrierType (空=紙本/1=綠界/2=自然人/3=手機). */
const CARRIER_TYPE: Record<Carrier["type"], string> = {
  MEMBER: "1",
  CITIZEN_CERTIFICATE: "2",
  MOBILE_BARCODE: "3",
};

export class EcpayProvider implements InvoiceProvider {
  readonly name = "ecpay";
  readonly capabilities: ReadonlySet<Capability> = new Set([
    Capability.ISSUE,
    Capability.VOID,
    Capability.ALLOWANCE,
    Capability.VOID_ALLOWANCE,
    Capability.QUERY,
    Capability.B2B,
    Capability.MIXED_TAX,
    Capability.QUERY_BY_ORDER_ID,
    Capability.SCHEDULED_ISSUE,
    Capability.CARRIER_VALIDATION,
  ]);

  constructor(private readonly config: EcpayConfig) {}

  /** Escape hatch: call any B2C endpoint with a raw Data payload. */
  raw(path: string, data: Record<string, unknown>): Promise<EcpayResult> {
    return ecpayRequest(this.config, path, data);
  }

  // -------------------------------------------------------------------------
  // Unified InvoiceProvider
  // -------------------------------------------------------------------------

  async issue(input: IssueInvoiceInput): Promise<IssueInvoiceResult> {
    const parsed = issueInvoiceInputSchema.parse(input);
    const data = this.buildIssueData(parsed);
    const result = await ecpayRequest(this.config, ENDPOINTS.issue, data);
    return {
      invoiceNumber: String(result.InvoiceNo ?? ""),
      invoiceDate: parseEcpayDate(result.InvoiceDate),
      randomCode: String(result.RandomNumber ?? ""),
      orderId: parsed.orderId,
      totalAmount: parsed.amount.totalAmount,
      status: InvoiceStatus.ISSUED,
      raw: result,
    };
  }

  /**
   * 延遲(待觸發)開立 (DelayIssue, DelayFlag=2): create a held invoice that is only
   * issued when {@link EcpayProvider.triggerIssue} is called. Returns the
   * `relateNumber` to trigger with.
   */
  async issuePending(input: IssueInvoiceInput): Promise<{ relateNumber: string; raw: EcpayResult }> {
    const parsed = issueInvoiceInputSchema.parse(input);
    const opts = (parsed.providerOptions ?? {}) as Record<string, unknown>;
    const result = await ecpayRequest(this.config, ENDPOINTS.delayIssue, {
      ...this.buildIssueData(parsed),
      DelayFlag: "2", // 待觸發
      DelayDay: "0",
      Tsr: parsed.orderId,
      PayType: "2",
      PayAct: (opts.payAct as string) ?? "ECPAY",
    });
    return { relateNumber: parsed.orderId, raw: result };
  }

  /**
   * 觸發開立 (TriggerIssue): issue a held invoice now, then look up the assigned
   * number (the trigger reply itself carries no InvoiceNo). Success replies use
   * RtnCode 4000003/4000004.
   */
  async triggerIssue(opts: { relateNumber: string; payAct?: string }): Promise<IssueInvoiceResult> {
    await ecpayRequest(
      this.config,
      ENDPOINTS.triggerIssue,
      { Tsr: opts.relateNumber, PayType: "2", PayAct: opts.payAct ?? "ECPAY" },
      { successCodes: [4000003, 4000004] },
    );
    const q = await this.query({ orderId: opts.relateNumber });
    return {
      invoiceNumber: q.invoiceNumber,
      invoiceDate: q.invoiceDate,
      randomCode: q.randomCode,
      orderId: opts.relateNumber,
      totalAmount: q.amount.totalAmount,
      status: q.status,
      raw: q.raw,
    };
  }

  async void(input: VoidInvoiceInput): Promise<VoidInvoiceResult> {
    const parsed = voidInvoiceInputSchema.parse(input);
    const opts = (parsed.providerOptions ?? {}) as Record<string, unknown>;
    await ecpayRequest(this.config, ENDPOINTS.invalid, {
      InvoiceNo: parsed.invoiceNumber,
      InvoiceDate: (opts.invoiceDate as string) ?? taipeiDate(parsed.date),
      Reason: parsed.reason,
    });
    return { invoiceNumber: parsed.invoiceNumber, status: InvoiceStatus.VOIDED, raw: undefined };
  }

  /**
   * 協議折讓 (AllowanceByCollegiate): opens an allowance the buyer confirms via
   * the notification (it carries an IA_TempExpireDate). It becomes effective —
   * and {@link EcpayProvider.voidAllowance}-able — only after confirmation.
   * Requires a buyer email (live-verified).
   */
  async allowance(input: AllowanceInput): Promise<AllowanceResult> {
    const parsed = allowanceInputSchema.parse(input);
    const opts = (parsed.providerOptions ?? {}) as Record<string, unknown>;
    const result = await ecpayRequest(this.config, ENDPOINTS.allowance, {
      InvoiceNo: parsed.invoiceNumber,
      InvoiceDate: (opts.invoiceDate as string) ?? taipeiDate(parsed.date),
      // AllowanceByCollegiate always requires a buyer email (live-verified).
      AllowanceNotify: (opts.allowanceNotify as string) ?? "E", // S簡訊 / E信箱 / N不通知
      CustomerName: opts.customerName as string | undefined,
      NotifyMail: opts.notifyMail as string | undefined,
      AllowanceAmount: parsed.amount.totalAmount,
      Items: toEcpayItems(parsed.items, parsed.providerOptions),
    });
    return {
      allowanceNumber: String(result.IA_Allow_No ?? ""),
      invoiceNumber: parsed.invoiceNumber,
      allowanceDate: parseEcpayDate(result.IA_TempDate),
      totalAmount: parsed.amount.totalAmount,
      raw: result,
    };
  }

  async voidAllowance(input: VoidAllowanceInput): Promise<VoidAllowanceResult> {
    const parsed = voidAllowanceInputSchema.parse(input);
    const result = await ecpayRequest(this.config, ENDPOINTS.allowanceInvalid, {
      InvoiceNo: parsed.invoiceNumber,
      AllowanceNo: parsed.allowanceNumber,
      Reason: parsed.reason ?? "作廢折讓",
    });
    return { allowanceNumber: parsed.allowanceNumber, raw: result };
  }

  async query(input: QueryInvoiceInput): Promise<QueryInvoiceResult> {
    const parsed = queryInvoiceInputSchema.parse(input);
    const opts = (parsed.providerOptions ?? {}) as Record<string, unknown>;
    // GetIssue is keyed by RelateNumber (the merchant order id).
    const result = await ecpayRequest(this.config, ENDPOINTS.getIssue, {
      RelateNumber: parsed.orderId ?? (opts.relateNumber as string) ?? "",
    });
    // GetIssue returns IIS_-prefixed fields; SalesAmount is the 含稅 total.
    const total = Number(result.IIS_Sales_Amount ?? 0);
    const tax = Number(result.IIS_Tax_Amount ?? 0);
    const items = Array.isArray(result.Items) ? (result.Items as Array<Record<string, unknown>>) : [];
    return {
      invoiceNumber: String(result.IIS_Number ?? parsed.invoiceNumber ?? ""),
      invoiceDate: parseEcpayDate(result.IIS_Create_Date),
      randomCode: String(result.IIS_Random_Number ?? ""),
      orderId: stringOrUndef(result.IIS_Relate_Number) ?? parsed.orderId,
      status: deriveStatus(result),
      amount: { salesAmount: total - tax, taxAmount: tax, totalAmount: total },
      buyer: {
        name: stringOrUndef(result.IIS_Customer_Name),
        ubn: stringOrUndef(result.IIS_Identifier, "0000000000"),
        email: stringOrUndef(result.IIS_Customer_Email),
      },
      items: items.map((it) => ({
        description: String(it.ItemName ?? ""),
        quantity: Number(it.ItemCount ?? 0),
        unitPrice: Number(it.ItemPrice ?? 0),
        amount: Number(it.ItemAmount ?? 0),
        unit: stringOrUndef(it.ItemWord),
        remark: stringOrUndef(it.ItemRemark),
      })),
      raw: result,
    };
  }

  /**
   * 手機條碼驗證 (CheckBarcode): resolves `true` when a mobile barcode is
   * registered at the tax authority. The `/XXXXXXX` format is checked first.
   */
  async validateMobileBarcode(barcode: string): Promise<boolean> {
    if (this.config.validatePayload !== false && !isValidMobileBarcode(barcode)) {
      throw new InvoiceError(`Invalid mobile barcode format: ${barcode}`, {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "BarCode must be '/' followed by 7 of [0-9A-Z.+-]",
      });
    }
    const result = await ecpayRequest(this.config, ENDPOINTS.checkBarcode, { BarCode: barcode });
    return result.IsExist === "Y";
  }

  /**
   * 愛心碼/捐贈碼驗證 (CheckLoveCode): resolves `true` when the donation code is
   * registered. The 3–7 digit format is checked first.
   */
  async validateLoveCode(loveCode: string): Promise<boolean> {
    if (this.config.validatePayload !== false && !/^\d{3,7}$/.test(loveCode)) {
      throw new InvoiceError(`Invalid love code format: ${loveCode}`, {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "LoveCode must be 3–7 digits",
      });
    }
    const result = await ecpayRequest(this.config, ENDPOINTS.checkLoveCode, { LoveCode: loveCode });
    return result.IsExist === "Y";
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  /** Map a unified issue input to the ECPay `Issue` Data payload. */
  private buildIssueData(parsed: IssueInvoiceInput): Record<string, unknown> {
    const category = parsed.category ?? deriveCategory(parsed.buyer);
    const carrier = parsed.carrier;
    const donating = Boolean(parsed.donation);
    // Carrier/donation invoices are electronic; everything else prints.
    const print = carrier || donating ? "0" : "1";

    return {
      RelateNumber: parsed.orderId,
      CustomerID: (parsed.providerOptions?.customerId as string) ?? "",
      CustomerIdentifier: category === "B2B" ? parsed.buyer.ubn : "",
      CustomerName: parsed.buyer.name ?? "",
      CustomerAddr: parsed.buyer.address ?? "",
      CustomerPhone: parsed.buyer.phone ?? "",
      CustomerEmail: parsed.buyer.email ?? "",
      Print: print,
      Donation: donating ? "1" : "0",
      LoveCode: parsed.donation?.npoban ?? "",
      CarrierType: carrier ? CARRIER_TYPE[carrier.type] : "",
      CarrierNum: carrier?.code ?? "",
      TaxType: ecpayTaxType(parsed.taxType),
      SalesAmount: parsed.amount.totalAmount, // 含稅總額
      InvoiceRemark: parsed.remark ?? "",
      Items: toEcpayItems(parsed.items, parsed.providerOptions, parsed.taxType),
      InvType: parsed.taxType === "SPECIAL" ? "08" : "07",
      vat: parsed.priceMode === "TAX_EXCLUSIVE" ? "0" : "1",
      ...(parsed.providerOptions?.data as Record<string, unknown> | undefined),
    };
  }
}

/** Create an ECPay-backed {@link InvoiceProvider}. */
export function createEcpayProvider(config: EcpayConfig): EcpayProvider {
  return new EcpayProvider(config);
}

// --- helpers ---------------------------------------------------------------

/** Unified TaxType → ECPay TaxType (1 應稅 / 2 零稅率 / 3 免稅 / 9 混合). */
export function ecpayTaxType(taxType: TaxType): string {
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

/** Build the ECPay `Items` array from unified items. */
function toEcpayItems(
  items: InvoiceItem[],
  providerOptions?: Record<string, unknown>,
  invoiceTaxType?: TaxType,
): Array<Record<string, unknown>> {
  void providerOptions;
  return items.map((item, i) => ({
    ItemSeq: i + 1,
    ItemName: item.description,
    ItemCount: item.quantity,
    ItemWord: item.unit ?? "式",
    ItemPrice: item.unitPrice,
    ItemTaxType: ecpayTaxType(item.taxType ?? invoiceTaxType ?? "TAXABLE"),
    ItemAmount: item.amount,
  }));
}

/** ECPay date ("YYYY-MM-DD HH:mm:ss", Asia/Taipei) → Date. */
function parseEcpayDate(value: unknown): Date {
  const s = String(value ?? "").trim();
  const m = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(s);
  if (!m) return new Date();
  const [, y, mo, d, hh = "00", mi = "00", ss = "00"] = m;
  return new Date(`${y}-${mo}-${d}T${hh}:${mi}:${ss}+08:00`);
}

/** Format a Date (or now) as `YYYY-MM-DD` in Asia/Taipei. */
function taipeiDate(date?: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date ?? new Date());
}

function stringOrUndef(value: unknown, placeholder?: string): string | undefined {
  const s = value == null ? "" : String(value);
  return s && s !== placeholder ? s : undefined;
}

function deriveStatus(result: Record<string, unknown>): InvoiceStatus {
  const invalid = result.IIS_Invalid_Status ?? result.InvalidStatus;
  if (invalid === "1" || invalid === 1) return InvoiceStatus.VOIDED;
  return InvoiceStatus.ISSUED;
}

import {
  type AllowanceInput,
  type AllowanceResult,
  Capability,
  type Carrier,
  deriveCategory,
  InvoiceError,
  InvoiceErrorCode,
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
import { type EzpayResponse, type EzpayResult, ezpayRequest, ezpayTimestamp } from "./client.js";
import type { EzpayConfig } from "./config.js";
import { encryptPostData, makeCheckCode } from "./crypto.js";
import { ENDPOINTS } from "./endpoints.js";
import {
  assertValidAllowancePayload,
  assertValidAllowanceTouchPayload,
  assertValidIssuePayload,
  assertValidSearchPayload,
  assertValidTouchIssuePayload,
  assertValidVoidAllowancePayload,
  assertValidVoidPayload,
} from "./validation.js";

/** Unified carrier type → ezPay CarrierType. */
const CARRIER_TYPE: Record<Carrier["type"], string> = {
  MOBILE_BARCODE: "0",
  CITIZEN_CERTIFICATE: "1",
  MEMBER: "2",
};

/** A held invoice awaiting a {@link EzpayProvider.triggerIssue} call. */
export interface EzpayPendingInvoice {
  /** ezPay 電子發票開立序號 — pass this to {@link EzpayProvider.triggerIssue}. */
  invoiceTransNo: string;
  orderId: string;
  totalAmount: number;
  raw: EzpayResponse;
}

/** Input for {@link EzpayProvider.triggerIssue} (觸發開立發票). */
export interface TriggerIssueInput {
  invoiceTransNo: string;
  orderId: string;
  totalAmount: number;
  /** ezPay 簡單付交易序號, when金流 is also handled by ezPay. */
  transNum?: string;
  providerOptions?: Record<string, string | number | undefined>;
}

/** Input for {@link EzpayProvider.triggerAllowance} (觸發確認/取消折讓). */
export interface TriggerAllowanceInput {
  allowanceNumber: string;
  /** MerchantOrderNo of the invoice the allowance was opened against. */
  orderId: string;
  /** 折讓總金額. */
  totalAmount: number;
  /** `CONFIRM` (確認折讓) uploads next day; `CANCEL` (取消折讓) discards it. */
  action: "CONFIRM" | "CANCEL";
  /** Carried through to the result for convenience. */
  invoiceNumber?: string;
  providerOptions?: Record<string, string | number | undefined>;
}

export class EzpayProvider implements InvoiceProvider {
  readonly name = "ezpay";
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
  ]);

  constructor(private readonly config: EzpayConfig) {}

  private respondType() {
    return this.config.respondType ?? "JSON";
  }

  /** Run a payload assertion unless `validatePayload` is disabled. */
  private validate(assert: (data: unknown) => void, postData: unknown): void {
    if (this.config.validatePayload !== false) assert(postData);
  }

  /**
   * Verify an issue-family response's `CheckCode` against the 5 result fields
   * (per the ezPay 附件二 spec). Throws when it doesn't match the locally
   * recomputed value — a sign the reply was tampered with or mis-routed.
   */
  private verifyIssueCheckCode(result: Record<string, unknown>): void {
    if (this.config.verifyCheckCode === false) return;
    const checkCode = result.CheckCode;
    if (!checkCode) return; // some responses omit it; nothing to verify
    const expected = makeCheckCode(
      {
        MerchantID: String(result.MerchantID ?? ""),
        MerchantOrderNo: String(result.MerchantOrderNo ?? ""),
        InvoiceTransNo: String(result.InvoiceTransNo ?? ""),
        TotalAmt: String(result.TotalAmt ?? ""),
        RandomNum: String(result.RandomNum ?? ""),
      },
      this.config.hashKey,
      this.config.hashIV,
    );
    if (expected !== String(checkCode).toUpperCase()) {
      throw new InvoiceError("ezPay response CheckCode mismatch — possible tampering", {
        provider: "ezpay",
        code: InvoiceErrorCode.PROVIDER,
        rawCode: "CHECKCODE_MISMATCH",
        raw: result,
      });
    }
  }

  /** Escape hatch: call any ezPay endpoint with raw PostData_ params. */
  raw(path: string, postData: Record<string, string | number | undefined>): Promise<EzpayResult> {
    return ezpayRequest(this.config, path, postData);
  }

  /**
   * Build the encrypted form fields (`MerchantID_` + `PostData_`) for an
   * endpoint WITHOUT sending the request. Use this to POST from a browser form
   * straight to ezPay — e.g. a DisplayFlag query whose result page is rendered
   * by ezPay. POST these fields to `${baseUrl}${endpointPath}`.
   */
  buildPostData(postData: Record<string, string | number | undefined>): {
    MerchantID_: string;
    PostData_: string;
  } {
    return {
      MerchantID_: this.config.merchantId,
      PostData_: encryptPostData(postData, this.config.hashKey, this.config.hashIV),
    };
  }

  /**
   * Build the encrypted `invoice_search` form fields for a browser Form POST
   * (the DisplayFlag flow). Pass `providerOptions.displayFlag: "1"` to have
   * ezPay render the result page. POST the returned fields to the search endpoint.
   */
  buildQueryPostData(input: QueryInvoiceInput): { MerchantID_: string; PostData_: string } {
    return this.buildPostData(this.buildSearchPostData(input));
  }

  // -------------------------------------------------------------------------
  // Unified InvoiceProvider
  // -------------------------------------------------------------------------

  /** Build the `invoice_issue` PostData_ for a given Status (1 即時 / 0 觸發 / 3 預約). */
  private buildIssuePostData(
    parsed: IssueInvoiceInput,
    status: string,
  ): Record<string, string | number | undefined> {
    const category = parsed.category ?? deriveCategory(parsed.buyer);
    const hasCarrierOrDonation = Boolean(parsed.carrier || parsed.donation);

    const postData: Record<string, string | number | undefined> = {
      RespondType: this.respondType(),
      Version: ENDPOINTS.issue.version,
      TimeStamp: ezpayTimestamp(),
      MerchantOrderNo: parsed.orderId,
      Status: status,
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
    return postData;
  }

  async issue(input: IssueInvoiceInput): Promise<IssueInvoiceResult> {
    const parsed = issueInvoiceInputSchema.parse(input);
    const postData = this.buildIssuePostData(parsed, "1"); // 即時開立
    const { result, raw } = await ezpayRequest(this.config, ENDPOINTS.issue.path, postData);
    this.verifyIssueCheckCode(result);
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

  /**
   * ezPay 觸發開立: create a held invoice (`Status=0`). It is only stored on the
   * platform — call {@link EzpayProvider.triggerIssue} with the returned
   * `invoiceTransNo` to actually issue it.
   */
  async issuePending(input: IssueInvoiceInput): Promise<EzpayPendingInvoice> {
    const parsed = issueInvoiceInputSchema.parse(input);
    const postData = this.buildIssuePostData(parsed, "0"); // 等待觸發開立
    const { result, raw } = await ezpayRequest(this.config, ENDPOINTS.issue.path, postData);
    this.verifyIssueCheckCode(result);
    return {
      invoiceTransNo: String(result.InvoiceTransNo ?? ""),
      orderId: String(result.MerchantOrderNo ?? parsed.orderId),
      totalAmount: Number(result.TotalAmt ?? parsed.amount.totalAmount),
      raw,
    };
  }

  /**
   * ezPay 觸發開立發票: issue a previously held invoice (created via
   * {@link EzpayProvider.issuePending} or a `Status=3` scheduled one) now.
   */
  async triggerIssue(opts: TriggerIssueInput): Promise<IssueInvoiceResult> {
    const postData = {
      RespondType: this.respondType(),
      Version: ENDPOINTS.touchIssue.version,
      TimeStamp: ezpayTimestamp(),
      InvoiceTransNo: opts.invoiceTransNo,
      MerchantOrderNo: opts.orderId,
      TotalAmt: opts.totalAmount,
      TransNum: opts.transNum,
      ...(opts.providerOptions ?? {}),
    };
    this.validate(assertValidTouchIssuePayload, postData);
    const { result, raw } = await ezpayRequest(this.config, ENDPOINTS.touchIssue.path, postData);
    this.verifyIssueCheckCode(result);
    return {
      invoiceNumber: String(result.InvoiceNumber ?? ""),
      invoiceDate: parseEzpayDate(result.CreateTime),
      randomCode: String(result.RandomNum ?? ""),
      orderId: String(result.MerchantOrderNo ?? opts.orderId),
      totalAmount: Number(result.TotalAmt ?? opts.totalAmount),
      status: InvoiceStatus.ISSUED,
      raw,
    };
  }

  async void(input: VoidInvoiceInput): Promise<VoidInvoiceResult> {
    const parsed = voidInvoiceInputSchema.parse(input);
    const postData = {
      RespondType: this.respondType(),
      Version: ENDPOINTS.void.version,
      TimeStamp: ezpayTimestamp(),
      InvoiceNumber: parsed.invoiceNumber,
      InvalidReason: parsed.reason,
      ...(parsed.providerOptions ?? {}),
    };
    this.validate(assertValidVoidPayload, postData);
    const { raw } = await ezpayRequest(this.config, ENDPOINTS.void.path, postData);
    return { invoiceNumber: parsed.invoiceNumber, status: InvoiceStatus.VOIDED, raw };
  }

  async allowance(input: AllowanceInput): Promise<AllowanceResult> {
    const parsed = allowanceInputSchema.parse(input);
    const opts = (parsed.providerOptions ?? {}) as Record<string, unknown>;
    const taxRate = typeof opts.taxRate === "number" ? opts.taxRate : 0.05;
    // ezPay keys an allowance off the invoice number + the invoice's order no.
    const merchantOrderNo = (opts.merchantOrderNo as string) ?? parsed.allowanceId;

    const postData = {
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
    };
    this.validate(assertValidAllowancePayload, postData);
    const { result, raw } = await ezpayRequest(this.config, ENDPOINTS.allowance.path, postData);
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
    const postData = {
      RespondType: this.respondType(),
      Version: ENDPOINTS.voidAllowance.version,
      TimeStamp: ezpayTimestamp(),
      AllowanceNo: parsed.allowanceNumber,
      InvalidReason: parsed.reason ?? "作廢折讓",
      ...(parsed.providerOptions ?? {}),
    };
    this.validate(assertValidVoidAllowancePayload, postData);
    const { raw } = await ezpayRequest(this.config, ENDPOINTS.voidAllowance.path, postData);
    return { allowanceNumber: parsed.allowanceNumber, raw };
  }

  /**
   * ezPay 觸發確認/取消折讓: confirm (`CONFIRM`) or cancel (`CANCEL`) a held
   * allowance created with `Status=0`. A confirmed allowance is uploaded the
   * next day; once confirmed it can no longer be cancelled (use
   * {@link EzpayProvider.voidAllowance} to void an uploaded one instead).
   */
  async triggerAllowance(opts: TriggerAllowanceInput): Promise<AllowanceResult> {
    const postData = {
      RespondType: this.respondType(),
      Version: ENDPOINTS.allowanceTouch.version,
      TimeStamp: ezpayTimestamp(),
      AllowanceStatus: opts.action === "CANCEL" ? "D" : "C",
      AllowanceNo: opts.allowanceNumber,
      MerchantOrderNo: opts.orderId,
      TotalAmt: opts.totalAmount,
      ...(opts.providerOptions ?? {}),
    };
    this.validate(assertValidAllowanceTouchPayload, postData);
    const { result, raw } = await ezpayRequest(this.config, ENDPOINTS.allowanceTouch.path, postData);
    return {
      allowanceNumber: String(result.AllowanceNo ?? opts.allowanceNumber),
      invoiceNumber: opts.invoiceNumber ?? "",
      allowanceDate: new Date(),
      totalAmount: opts.totalAmount,
      raw,
    };
  }

  /** Build the validated `invoice_search` PostData_ from a unified query input. */
  private buildSearchPostData(
    input: QueryInvoiceInput,
  ): Record<string, string | number | undefined> {
    const parsed = queryInvoiceInputSchema.parse(input);
    const opts = (parsed.providerOptions ?? {}) as Record<string, unknown>;
    // ezPay supports two lookups: by invoice number + random code (SearchType 0),
    // or by order number + total amount (SearchType 1).
    const byInvoice = Boolean(parsed.invoiceNumber);
    const lookup: Record<string, string | number | undefined> = byInvoice
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
    // DisplayFlag=1 hands the result page to ezPay (browser Form POST flow).
    if (opts.displayFlag !== undefined) lookup.DisplayFlag = String(opts.displayFlag);

    const fullPostData = {
      RespondType: this.respondType(),
      Version: ENDPOINTS.search.version,
      TimeStamp: ezpayTimestamp(),
      ...lookup,
    };
    this.validate(assertValidSearchPayload, fullPostData);
    return fullPostData;
  }

  async query(input: QueryInvoiceInput): Promise<QueryInvoiceResult> {
    const parsed = queryInvoiceInputSchema.parse(input);
    const fullPostData = this.buildSearchPostData(input);
    const { result, raw } = await ezpayRequest(this.config, ENDPOINTS.search.path, fullPostData);

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

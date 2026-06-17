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
import { assertValidIssuePayload } from "./validation.js";

/** 字軌狀態: 停用 / 暫停 / 啟用. */
export type EcpayWordStatus = "DISABLE" | "PAUSE" | "ENABLE";
const WORD_STATUS_CODE: Record<EcpayWordStatus, number> = { DISABLE: 0, PAUSE: 1, ENABLE: 2 };

/** A 字軌's use status (UseStatus 1–6). */
export type EcpayWordTrackStatus =
  | "INACTIVE" // 1 未啟用
  | "IN_USE" // 2 使用中
  | "DISABLED" // 3 已停用
  | "PAUSED" // 4 暫停中
  | "PENDING_REVIEW" // 5 待審核
  | "REJECTED"; // 6 審核不通過
const TRACK_STATUS: Record<number, EcpayWordTrackStatus> = {
  1: "INACTIVE",
  2: "IN_USE",
  3: "DISABLED",
  4: "PAUSED",
  5: "PENDING_REVIEW",
  6: "REJECTED",
};
const TRACK_STATUS_CODE: Record<EcpayWordTrackStatus, number> = {
  INACTIVE: 1,
  IN_USE: 2,
  DISABLED: 3,
  PAUSED: 4,
  PENDING_REVIEW: 5,
  REJECTED: 6,
};

/** A merchant 字軌 from 查詢字軌 (GetInvoiceWordSetting). */
export interface EcpayWordTrack {
  /** 字軌號碼ID (use with {@link EcpayProvider.setInvoiceWordStatus}). */
  trackId: string;
  /** 發票年度 (民國年). */
  year: string;
  /** 期別 1–6. */
  term: number;
  /** 07 一般稅額 / 08 特種稅額. */
  invType: string;
  /** 字軌名稱, e.g. `"JU"`. */
  header: string;
  /** 起始 / 結束 8-digit 發票號碼. */
  start: string;
  end: string;
  /** 目前已使用號碼 (可空). */
  currentNumber: string;
  status: EcpayWordTrackStatus;
  /** 產品服務別代號 (多組字軌時). */
  productServiceId?: string;
}

/** Filter for 查詢字軌 (GetInvoiceWordSetting). */
export interface GetWordSettingInput {
  /** 發票年度 (民國年, e.g. "115"). */
  invoiceYear: string;
  /** 期別 1–6; omit for all. */
  term?: number;
  /** Use status; omit for all. */
  useStatus?: EcpayWordTrackStatus;
  invType?: "07" | "08";
  invoiceHeader?: string;
  productServiceId?: string;
}

/** One allocated invoice-number range (字軌) from 查詢財政部配號結果. */
export interface EcpayWordSetting {
  /** 期別 1–6 (1=1-2月, 2=3-4月, …). */
  term: number;
  /** 字軌類別: 07 一般稅額 / 08 特種稅額. */
  invType: string;
  /** 發票字軌, e.g. `"GI"`. */
  header: string;
  /** 起始 8-digit 發票號碼 (尾數 00/50). */
  start: string;
  /** 結束 8-digit 發票號碼 (尾數 49/99). */
  end: string;
  /** 申請本數 (1 本 = 50 numbers). */
  count: number;
}

/** Result of {@link EcpayProvider.allowanceOnline} (線上折讓, pending buyer confirmation). */
export interface OnlineAllowanceResult {
  /** 折讓單號 — pending until the buyer confirms via the email link. */
  allowanceNumber: string;
  invoiceNumber: string;
  /** When the online allowance was created (IA_TempDate). */
  createdAt: Date;
  /** The buyer must confirm before this (72h, IA_TempExpireDate). */
  expiresAt: Date;
  /** 折讓剩餘金額. */
  remainingAmount: number;
  raw: EcpayResult;
}

/** What to notify about (→ ECPay `InvoiceTag`). */
export type NotifyTag =
  | "ISSUE" // I 發票開立
  | "VOID" // II 發票作廢
  | "ALLOWANCE" // A 折讓開立
  | "ALLOWANCE_VOID" // AI 折讓作廢
  | "AWARD" // AW 發票中獎
  | "ONLINE_ALLOWANCE"; // OA 線上折讓
const NOTIFY_TAG: Record<NotifyTag, string> = {
  ISSUE: "I",
  VOID: "II",
  ALLOWANCE: "A",
  ALLOWANCE_VOID: "AI",
  AWARD: "AW",
  ONLINE_ALLOWANCE: "OA",
};
const NOTIFY_METHOD = { SMS: "S", EMAIL: "E", BOTH: "A" } as const;
const NOTIFY_RECIPIENT = { CUSTOMER: "C", MERCHANT: "M", BOTH: "A" } as const;

/** Input for {@link EcpayProvider.sendNotification} (發送發票通知). */
export interface SendNotifyInput {
  invoiceNumber: string;
  /** Required when `tag` is ALLOWANCE / ALLOWANCE_VOID / ONLINE_ALLOWANCE. */
  allowanceNumber?: string;
  tag: NotifyTag;
  /** Channel. `ONLINE_ALLOWANCE` must use `"EMAIL"`. */
  method: keyof typeof NOTIFY_METHOD;
  /** Recipient. `ONLINE_ALLOWANCE` must use `"CUSTOMER"`. */
  recipient: keyof typeof NOTIFY_RECIPIENT;
  /** At least one of email / phone is required. */
  email?: string;
  phone?: string;
}

/** Print layout (→ ECPay `PrintStyle`). B2B styles require an invoice with a 統編. */
export type PrintStyle = "SINGLE" | "DOUBLE" | "THERMAL" | "B2B_A4" | "B2B_A5";
const PRINT_STYLE: Record<PrintStyle, number> = {
  SINGLE: 1,
  DOUBLE: 2,
  THERMAL: 3,
  B2B_A4: 4,
  B2B_A5: 5,
};

/** Input for {@link EcpayProvider.getPrintUrl} (發票列印). */
export interface PrintInvoiceInput {
  invoiceNumber: string;
  /** `yyyy-MM-dd` (or `yyyy/MM/dd`). Defaults to today (Asia/Taipei). */
  invoiceDate?: string;
  /** Layout; defaults to `SINGLE`. */
  style?: PrintStyle;
  /** Show the line-item detail. B2B / 統編 invoices always show it. */
  showDetail?: boolean;
  /** Stamp the print as 補印 (電子發票證明聯補印). Ignored for B2B styles. */
  reprint?: boolean;
}

/** Detail of a voided invoice from {@link EcpayProvider.getInvalid} (查詢作廢發票明細). */
export interface InvalidDetail {
  invoiceNumber: string; // II_Invoice_No
  /** 作廢時間 (II_Date). */
  voidedAt: Date;
  reason: string; // Reason
  uploaded: boolean; // II_Upload_Status
  uploadedAt?: Date; // II_Upload_Date
  sellerUbn?: string; // II_Seller_Identifier
  buyerUbn?: string; // II_Buyer_Identifier
  raw: Record<string, unknown>;
}

/** Detail of a voided allowance from {@link EcpayProvider.getAllowanceInvalid} (查詢作廢折讓明細). */
export interface InvalidAllowanceDetail {
  allowanceNumber: string; // AI_Allow_No
  invoiceNumber: string; // AI_Invoice_No
  /** 折讓單日期 (AI_Allow_Date). */
  allowanceDate: Date;
  /** 作廢時間 (AI_Date). */
  voidedAt: Date;
  reason: string; // Reason
  uploaded: boolean; // AI_Upload_Status
  uploadedAt?: Date; // AI_Upload_Date
  sellerUbn?: string; // AI_Seller_Identifier
  buyerUbn?: string; // AI_Buyer_Identifier
  raw: Record<string, unknown>;
}

/** Lookup for {@link EcpayProvider.getAllowanceList} (查詢折讓明細). */
export interface GetAllowanceListInput {
  /** 折讓編號 — SearchType 0. */
  allowanceNumber?: string;
  /** 發票號碼 — SearchType 1/2 (needs `date`). */
  invoiceNumber?: string;
  /** yyyy-MM-dd — the invoice's issue date (dateType ISSUE) or allowance date (ALLOWANCE). */
  date?: string;
  /** `"ISSUE"` (SearchType 1, default) or `"ALLOWANCE"` (SearchType 2). */
  dateType?: "ISSUE" | "ALLOWANCE";
}

/** One row from {@link EcpayProvider.getAllowanceList}. */
export interface AllowanceDetail {
  allowanceNumber: string; // IA_Allow_No
  invoiceNumber: string; // IA_Invoice_No
  allowanceDate: Date; // IA_Date
  invoiceIssueDate: Date; // IA_Invoice_Issue_Date
  voided: boolean; // IA_Invalid_Status
  uploaded: boolean; // IA_Upload_Status
  taxType: string; // IA_Tax_Type
  /** 不含稅進貨額 (IA_Total_Amount). */
  amount: number;
  taxAmount: number; // IA_Tax_Amount
  /** 含稅折讓總額 (IA_Total_Tax_Amount). */
  totalAmount: number;
  ubn?: string; // IA_Identifier
  customerName?: string; // IIS_Customer_Name
  notifyMail?: string; // IA_Send_Mail
  notifyPhone?: string; // IA_Send_Phone
  items: InvoiceItem[];
  raw: Record<string, unknown>;
}

/** Filter for {@link EcpayProvider.listInvoices} (查詢多筆發票). */
export interface ListInvoicesInput {
  /** 查詢起始日期 yyyy-MM-dd (by issue date). */
  beginDate: string;
  /** 查詢結束日期 yyyy-MM-dd. */
  endDate: string;
  /** 單頁筆數 (≤200; recommend ≤30). Default 30. */
  numPerPage?: number;
  /** 頁數 (1-based). Default 1. Sorted newest issue date first. */
  page?: number;
  /** Raw ECPay `Query_*` filters, passed through (e.g. `{ Query_Invalid: "1" }`). */
  filters?: Record<string, string | number>;
}

/** One row from {@link EcpayProvider.listInvoices}. */
export interface InvoiceListItem {
  invoiceNumber: string;
  orderId: string;
  ubn?: string;
  category: string; // B2B / B2C
  taxType: string;
  taxAmount: number;
  salesAmount: number; // 含稅 total
  createdAt: Date;
  voided: boolean;
  uploaded: boolean;
  remainingAllowance: number;
  raw: Record<string, unknown>;
}

/** A page of {@link EcpayProvider.listInvoices} results. */
export interface InvoiceListPage {
  /** Total rows across all pages (use to drive pagination). */
  totalCount: number;
  page: number;
  invoices: InvoiceListItem[];
}

/** Outcome of {@link EcpayProvider.triggerIssue} (觸發開立). */
export interface TriggerIssueResult {
  /** `true` when issued immediately (4000004); `false` when it will auto-issue after the delay (4000003). */
  issued: boolean;
  /** The assigned 發票號碼 — present only when `issued` is true. */
  invoiceNumber?: string;
  invoiceDate?: Date;
  randomCode?: string;
  relateNumber: string;
  raw: EcpayResult;
}

/** Options for {@link EcpayProvider.issuePending} (延遲開立). */
export interface IssuePendingOptions {
  /** `"SCHEDULE"` (預約, auto-issues after delayDay) or `"TRIGGER"` (待觸發, default). */
  mode?: "SCHEDULE" | "TRIGGER";
  /** Delay days. SCHEDULE: 1–15 (default 1). TRIGGER: 0–15 (default 0). */
  delayDay?: number;
  /** Production callback URL fired when the invoice issues (no-op on stage). */
  notifyUrl?: string;
  /** PayAct override (default `"ECPAY"`). */
  payAct?: string;
}

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
   * 延遲開立 (DelayIssue): stage an invoice for later issuance. Two modes:
   * - `"SCHEDULE"` (DelayFlag=1, 預約): auto-issues after `delayDay` (1–15) days.
   * - `"TRIGGER"` (DelayFlag=2, 待觸發, default): only issues when
   *   {@link EcpayProvider.triggerIssue} is called; `delayDay` 0–15 (default 0).
   *
   * Returns the `relateNumber` (= the Tsr) to trigger / look up with.
   */
  async issuePending(
    input: IssueInvoiceInput,
    options: IssuePendingOptions = {},
  ): Promise<{ relateNumber: string; raw: EcpayResult }> {
    const parsed = issueInvoiceInputSchema.parse(input);
    const opts = (parsed.providerOptions ?? {}) as Record<string, unknown>;
    const schedule = options.mode === "SCHEDULE";
    const delayDay = options.delayDay ?? (schedule ? 1 : 0);
    if (this.config.validatePayload !== false) {
      const valid = schedule ? delayDay >= 1 && delayDay <= 15 : delayDay >= 0 && delayDay <= 15;
      if (!valid)
        throw new InvoiceError(`Invalid delayDay: ${delayDay}`, {
          provider: "ecpay",
          code: InvoiceErrorCode.VALIDATION,
          rawMessage: schedule ? "SCHEDULE delayDay must be 1–15" : "TRIGGER delayDay must be 0–15",
        });
    }
    const result = await ecpayRequest(this.config, ENDPOINTS.delayIssue, {
      ...this.buildIssueData(parsed),
      DelayFlag: schedule ? "1" : "2",
      DelayDay: delayDay,
      Tsr: parsed.orderId,
      PayType: "2",
      PayAct: options.payAct ?? (opts.payAct as string) ?? "ECPAY",
      NotifyURL: options.notifyUrl,
    });
    return { relateNumber: parsed.orderId, raw: result };
  }

  /**
   * 編輯延遲開立 (EditDelayIssue): replace a still-pending delayed invoice's data,
   * keyed by its `Tsr` (defaults to the new input's `orderId`). The invoice must
   * not have been triggered/issued yet.
   */
  async editDelayIssue(
    input: IssueInvoiceInput,
    options: { tsr?: string; notifyUrl?: string } = {},
  ): Promise<{ relateNumber: string; raw: EcpayResult }> {
    const parsed = issueInvoiceInputSchema.parse(input);
    const result = await ecpayRequest(this.config, ENDPOINTS.editDelayIssue, {
      ...this.buildIssueData(parsed),
      Tsr: options.tsr ?? parsed.orderId,
      NotifyURL: options.notifyUrl,
    });
    return { relateNumber: parsed.orderId, raw: result };
  }

  /**
   * 觸發開立 (TriggerIssue): trigger a previously staged (DelayFlag=2) invoice,
   * keyed by its `Tsr` (= the relateNumber). The request takes only Tsr + PayType.
   * Two outcomes (live-verified):
   * - `DelayDay=0` → RtnCode 4000004: issued now; `issued: true` + the looked-up
   *   invoice number (the trigger reply itself carries none).
   * - `DelayDay>0` → RtnCode 4000003: it will auto-issue after the delay;
   *   `issued: false`, no number yet — query by `relateNumber` later.
   */
  async triggerIssue(opts: { relateNumber: string }): Promise<TriggerIssueResult> {
    const res = await ecpayRequest(
      this.config,
      ENDPOINTS.triggerIssue,
      { Tsr: opts.relateNumber, PayType: "2" },
      { successCodes: [4000003, 4000004] },
    );
    if (Number(res.RtnCode) !== 4000004) {
      // 4000003: triggered but issues after the configured delay — not yet available.
      return { issued: false, relateNumber: opts.relateNumber, raw: res };
    }
    const q = await this.query({ orderId: opts.relateNumber });
    return {
      issued: true,
      invoiceNumber: q.invoiceNumber,
      invoiceDate: q.invoiceDate,
      randomCode: q.randomCode,
      relateNumber: opts.relateNumber,
      raw: res,
    };
  }

  /**
   * 取消延遲開立 (CancelDelayIssue): cancel a staged delayed invoice that hasn't
   * been issued yet (預約時間未到 / 尚未觸發), keyed by its `Tsr` (= relateNumber).
   */
  async cancelDelayIssue(tsr: string): Promise<void> {
    if (this.config.validatePayload !== false && !tsr) {
      throw new InvoiceError("Tsr is required", {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "Tsr is required",
      });
    }
    await ecpayRequest(this.config, ENDPOINTS.cancelDelayIssue, { Tsr: tsr });
  }

  /**
   * 作廢發票 (Invalid). Needs the invoice's open date — pass it via
   * `providerOptions.invoiceDate` (defaults to today, Asia/Taipei). An invoice
   * with an un-voided allowance can't be voided (5070450 → CONFLICT); void the
   * allowance(s) first.
   */
  async void(input: VoidInvoiceInput): Promise<VoidInvoiceResult> {
    const parsed = voidInvoiceInputSchema.parse(input);
    const opts = (parsed.providerOptions ?? {}) as Record<string, unknown>;
    if (this.config.validatePayload !== false && parsed.reason.length > 20) {
      throw new InvoiceError("Reason must be ≤20 chars", {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "作廢原因 (Reason) must be ≤20 chars",
      });
    }
    const result = await ecpayRequest(this.config, ENDPOINTS.invalid, {
      InvoiceNo: parsed.invoiceNumber,
      InvoiceDate: (opts.invoiceDate as string) ?? taipeiDate(parsed.date),
      Reason: parsed.reason,
    });
    return { invoiceNumber: parsed.invoiceNumber, status: InvoiceStatus.VOIDED, raw: result };
  }

  /**
   * 一般開立折讓 (Allowance, 紙本): create a real allowance (綠界 uploads to the
   * MOF the next day) and return its 折讓單號 immediately — it can be voided right
   * away with {@link EcpayProvider.voidAllowance}. Defaults to no buyer
   * notification (`AllowanceNotify="N"`); to notify, pass
   * `providerOptions: { allowanceNotify: "E" | "S" | "A", notifyMail, notifyPhone }`.
   */
  async allowance(input: AllowanceInput): Promise<AllowanceResult> {
    const parsed = allowanceInputSchema.parse(input);
    const opts = (parsed.providerOptions ?? {}) as Record<string, unknown>;
    const result = await ecpayRequest(this.config, ENDPOINTS.allowance, {
      InvoiceNo: parsed.invoiceNumber,
      InvoiceDate: (opts.invoiceDate as string) ?? taipeiDate(parsed.date),
      AllowanceNotify: (opts.allowanceNotify as string) ?? "N", // S簡訊 / E信箱 / A皆通知 / N不通知
      CustomerName: opts.customerName as string | undefined,
      NotifyMail: opts.notifyMail as string | undefined,
      NotifyPhone: opts.notifyPhone as string | undefined,
      AllowanceAmount: parsed.amount.totalAmount,
      Reason: opts.reason as string | undefined,
      Items: toEcpayItems(parsed.items, parsed.providerOptions),
    });
    return {
      allowanceNumber: String(result.IA_Allow_No ?? ""),
      invoiceNumber: parsed.invoiceNumber,
      allowanceDate: parseEcpayDate(result.IA_Date),
      totalAmount: parsed.amount.totalAmount,
      raw: result,
    };
  }

  /**
   * 線上開立折讓 (AllowanceByCollegiate): create an allowance the buyer confirms
   * online — ECPay emails them a link they must click (72h, `expiresAt`) before
   * the allowance is actually issued. Returns the pending 折讓單號 + expiry (the
   * buyer can be reminded/cancelled until then). Needs a `notifyMail`; an
   * optional `returnUrl` receives the server-to-server confirmation.
   */
  async allowanceOnline(
    input: AllowanceInput,
    options: { notifyMail: string; returnUrl?: string; customerName?: string; reason?: string },
  ): Promise<OnlineAllowanceResult> {
    const parsed = allowanceInputSchema.parse(input);
    const opts = (parsed.providerOptions ?? {}) as Record<string, unknown>;
    if (this.config.validatePayload !== false && !options.notifyMail) {
      throw new InvoiceError("notifyMail is required for an online allowance", {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "AllowanceNotify is fixed to E (email); notifyMail is required",
      });
    }
    const result = await ecpayRequest(this.config, ENDPOINTS.allowanceByCollegiate, {
      InvoiceNo: parsed.invoiceNumber,
      InvoiceDate: (opts.invoiceDate as string) ?? taipeiDate(parsed.date),
      AllowanceNotify: "E", // fixed to email
      CustomerName: options.customerName,
      NotifyMail: options.notifyMail,
      AllowanceAmount: parsed.amount.totalAmount,
      Reason: options.reason,
      Items: toEcpayItems(parsed.items, parsed.providerOptions),
      ReturnURL: options.returnUrl,
    });
    return {
      allowanceNumber: String(result.IA_Allow_No ?? ""),
      invoiceNumber: String(result.IA_Invoice_No ?? parsed.invoiceNumber),
      createdAt: parseEcpayDate(result.IA_TempDate),
      expiresAt: parseEcpayDate(result.IA_TempExpireDate),
      remainingAmount: Number(result.IA_Remain_Allowance_Amt ?? 0),
      raw: result,
    };
  }

  /**
   * 作廢折讓 (AllowanceInvalid): void a single 折讓單 (not the whole invoice).
   * An already-voided allowance → 2000063 (CONFLICT); an unknown one → 2000039
   * (NOT_FOUND).
   */
  async voidAllowance(input: VoidAllowanceInput): Promise<VoidAllowanceResult> {
    const parsed = voidAllowanceInputSchema.parse(input);
    const reason = parsed.reason ?? "作廢折讓";
    if (this.config.validatePayload !== false && reason.length > 20) {
      throw new InvoiceError("Reason must be ≤20 chars", {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "作廢折讓原因 (Reason) must be ≤20 chars",
      });
    }
    const result = await ecpayRequest(this.config, ENDPOINTS.allowanceInvalid, {
      InvoiceNo: parsed.invoiceNumber,
      AllowanceNo: parsed.allowanceNumber,
      Reason: reason,
    });
    return { allowanceNumber: parsed.allowanceNumber, raw: result };
  }

  /**
   * 取消線上折讓 (AllowanceInvalidByCollegiate): cancel a still-pending online
   * allowance (from {@link EcpayProvider.allowanceOnline}) before the buyer
   * confirms it — the amount is returned to the invoice's available allowance.
   * For a confirmed/paper allowance use {@link EcpayProvider.voidAllowance}.
   */
  async cancelAllowanceOnline(input: VoidAllowanceInput): Promise<VoidAllowanceResult> {
    const parsed = voidAllowanceInputSchema.parse(input);
    const reason = parsed.reason ?? "取消折讓";
    if (this.config.validatePayload !== false && reason.length > 20) {
      throw new InvoiceError("Reason must be ≤20 chars", {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "取消原因 (Reason) must be ≤20 chars",
      });
    }
    const result = await ecpayRequest(this.config, ENDPOINTS.allowanceInvalidByCollegiate, {
      InvoiceNo: parsed.invoiceNumber,
      AllowanceNo: parsed.allowanceNumber,
      Reason: reason,
    });
    return { allowanceNumber: parsed.allowanceNumber, raw: result };
  }

  async query(input: QueryInvoiceInput): Promise<QueryInvoiceResult> {
    const parsed = queryInvoiceInputSchema.parse(input);
    const opts = (parsed.providerOptions ?? {}) as Record<string, unknown>;
    // GetIssue takes either RelateNumber (情境一) or InvoiceNo + InvoiceDate (情境二).
    const data =
      parsed.orderId || opts.relateNumber
        ? { RelateNumber: parsed.orderId ?? (opts.relateNumber as string) }
        : {
            InvoiceNo: parsed.invoiceNumber,
            InvoiceDate: (opts.invoiceDate as string) ?? taipeiDate(),
          };
    const result = await ecpayRequest(this.config, ENDPOINTS.getIssue, data);
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
        address: stringOrUndef(result.IIS_Customer_Addr),
        phone: stringOrUndef(result.IIS_Customer_Phone),
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
   * 發票列印 (InvoicePrint): get a print URL (`InvoiceHtml`) for an invoice,
   * valid for 1 hour. Only paper-printable invoices work — a carrier/donation
   * invoice (or an unknown number) returns 查無資料 (NOT_FOUND). B2B styles
   * (`B2B_A4` / `B2B_A5`) require an invoice carrying a 統編.
   */
  async getPrintUrl(input: PrintInvoiceInput): Promise<string> {
    const result = await ecpayRequest(this.config, ENDPOINTS.invoicePrint, {
      InvoiceNo: input.invoiceNumber,
      InvoiceDate: input.invoiceDate ?? taipeiDate(),
      ...(input.style ? { PrintStyle: PRINT_STYLE[input.style] } : {}),
      ...(input.showDetail !== undefined ? { IsShowingDetail: input.showDetail ? 1 : 2 } : {}),
      ...(input.reprint ? { IsReprintInvoice: "Y" } : {}),
    });
    return String(result.InvoiceHtml ?? "");
  }

  /**
   * 發送發票通知 (InvoiceNotify): email/SMS an invoice, void, allowance or award
   * notification to the customer and/or merchant. (Stage doesn't actually send —
   * it only validates the rules.) Allowance tags need an `allowanceNumber`;
   * `ONLINE_ALLOWANCE` must be EMAIL + CUSTOMER; email or phone is required.
   */
  async sendNotification(input: SendNotifyInput): Promise<void> {
    const tag = NOTIFY_TAG[input.tag];
    if (this.config.validatePayload !== false) {
      const fail = (msg: string) =>
        new InvoiceError(msg, { provider: "ecpay", code: InvoiceErrorCode.VALIDATION, rawMessage: msg });
      if (!input.email && !input.phone) throw fail("email or phone is required");
      if (["A", "AI", "OA"].includes(tag) && !input.allowanceNumber)
        throw fail("allowanceNumber is required for allowance notifications");
      if (input.tag === "ONLINE_ALLOWANCE" && (input.method !== "EMAIL" || input.recipient !== "CUSTOMER"))
        throw fail("ONLINE_ALLOWANCE must use EMAIL + CUSTOMER");
    }
    await ecpayRequest(this.config, ENDPOINTS.invoiceNotify, {
      InvoiceNo: input.invoiceNumber,
      AllowanceNo: input.allowanceNumber,
      Phone: input.phone,
      NotifyMail: input.email,
      Notify: NOTIFY_METHOD[input.method],
      InvoiceTag: tag,
      Notified: NOTIFY_RECIPIENT[input.recipient],
    });
  }

  /**
   * 查詢作廢折讓明細 (GetAllowanceInvalid): look up a voided allowance's detail
   * (allowance date, void time, reason, upload status, seller/buyer 統編). Keyed
   * by InvoiceNo + AllowanceNo (both required).
   */
  async getAllowanceInvalid(input: {
    invoiceNumber: string;
    allowanceNumber: string;
  }): Promise<InvalidAllowanceDetail> {
    if (this.config.validatePayload !== false && (!input.invoiceNumber || !input.allowanceNumber)) {
      throw new InvoiceError("invoiceNumber and allowanceNumber are both required", {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "GetAllowanceInvalid needs InvoiceNo + AllowanceNo",
      });
    }
    const result = await ecpayRequest(this.config, ENDPOINTS.getAllowanceInvalid, {
      InvoiceNo: input.invoiceNumber,
      AllowanceNo: input.allowanceNumber,
    });
    return {
      allowanceNumber: String(result.AI_Allow_No ?? input.allowanceNumber),
      invoiceNumber: String(result.AI_Invoice_No ?? input.invoiceNumber),
      allowanceDate: parseEcpayDate(result.AI_Allow_Date),
      voidedAt: parseEcpayDate(result.AI_Date),
      reason: String(result.Reason ?? ""),
      uploaded: result.AI_Upload_Status === "1" || result.AI_Upload_Status === 1,
      uploadedAt: result.AI_Upload_Date ? parseEcpayDate(result.AI_Upload_Date) : undefined,
      sellerUbn: stringOrUndef(result.AI_Seller_Identifier, "0000000000"),
      buyerUbn: stringOrUndef(result.AI_Buyer_Identifier, "0000000000"),
      raw: result,
    };
  }

  /**
   * 查詢作廢發票明細 (GetInvalid): look up a voided invoice's detail (void time,
   * reason, upload status, seller/buyer 統編). Keyed by RelateNumber + InvoiceNo
   * + InvoiceDate (all required).
   */
  async getInvalid(input: {
    orderId: string;
    invoiceNumber: string;
    invoiceDate: string;
  }): Promise<InvalidDetail> {
    if (this.config.validatePayload !== false && (!input.orderId || !input.invoiceNumber || !input.invoiceDate)) {
      throw new InvoiceError("orderId, invoiceNumber and invoiceDate are all required", {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "GetInvalid needs RelateNumber + InvoiceNo + InvoiceDate",
      });
    }
    const result = await ecpayRequest(this.config, ENDPOINTS.getInvalid, {
      RelateNumber: input.orderId,
      InvoiceNo: input.invoiceNumber,
      InvoiceDate: input.invoiceDate,
    });
    return {
      invoiceNumber: String(result.II_Invoice_No ?? input.invoiceNumber),
      voidedAt: parseEcpayDate(result.II_Date),
      reason: String(result.Reason ?? ""),
      uploaded: result.II_Upload_Status === "1" || result.II_Upload_Status === 1,
      uploadedAt: result.II_Upload_Date ? parseEcpayDate(result.II_Upload_Date) : undefined,
      sellerUbn: stringOrUndef(result.II_Seller_Identifier, "0000000000"),
      buyerUbn: stringOrUndef(result.II_Buyer_Identifier, "0000000000"),
      raw: result,
    };
  }

  /**
   * 查詢折讓明細 (GetAllowanceList): look up allowances by 折讓編號 (SearchType 0)
   * or 發票號碼 + 日期 (SearchType 1 = issue date, 2 = allowance date). Excludes
   * online allowances the buyer hasn't confirmed yet.
   */
  async getAllowanceList(input: GetAllowanceListInput): Promise<AllowanceDetail[]> {
    let data: Record<string, unknown>;
    if (input.allowanceNumber) {
      data = { SearchType: "0", AllowanceNo: input.allowanceNumber };
    } else if (input.invoiceNumber && input.date) {
      data = {
        SearchType: input.dateType === "ALLOWANCE" ? "2" : "1",
        InvoiceNo: input.invoiceNumber,
        Date: input.date,
      };
    } else if (this.config.validatePayload !== false) {
      throw new InvoiceError("Provide allowanceNumber, or invoiceNumber + date", {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "GetAllowanceList needs SearchType 0 (allowanceNumber) or 1/2 (invoiceNumber + date)",
      });
    } else {
      data = { SearchType: "0", AllowanceNo: "" };
    }
    const result = await ecpayRequest(this.config, ENDPOINTS.getAllowanceList, data);
    const rows = Array.isArray(result.AllowanceInfo)
      ? (result.AllowanceInfo as Array<Record<string, unknown>>)
      : [];
    return rows.map((a) => ({
      allowanceNumber: String(a.IA_Allow_No ?? ""),
      invoiceNumber: String(a.IA_Invoice_No ?? ""),
      allowanceDate: parseEcpayDate(a.IA_Date),
      invoiceIssueDate: parseEcpayDate(a.IA_Invoice_Issue_Date),
      voided: a.IA_Invalid_Status === "1" || a.IA_Invalid_Status === 1,
      uploaded: a.IA_Upload_Status === "1" || a.IA_Upload_Status === 1,
      taxType: String(a.IA_Tax_Type ?? ""),
      amount: Number(a.IA_Total_Amount ?? 0),
      taxAmount: Number(a.IA_Tax_Amount ?? 0),
      totalAmount: Number(a.IA_Total_Tax_Amount ?? 0),
      ubn: stringOrUndef(a.IA_Identifier, "0000000000"),
      customerName: stringOrUndef(a.IIS_Customer_Name),
      notifyMail: stringOrUndef(a.IA_Send_Mail),
      notifyPhone: stringOrUndef(a.IA_Send_Phone),
      items: (Array.isArray(a.Items) ? (a.Items as Array<Record<string, unknown>>) : []).map((it) => ({
        description: String(it.ItemName ?? ""),
        quantity: Number(it.ItemCount ?? 0),
        unitPrice: Number(it.ItemPrice ?? 0),
        amount: Number(it.ItemAmount ?? 0),
        unit: stringOrUndef(it.ItemWord),
      })),
      raw: a,
    }));
  }

  /**
   * 查詢多筆發票 (GetIssueList): list issued invoices in a date range, newest
   * first, paginated. Call once to read `totalCount`, then iterate `page`. Note
   * this endpoint's response `Data` is unencrypted JSON (handled internally).
   */
  async listInvoices(input: ListInvoicesInput): Promise<InvoiceListPage> {
    const numPerPage = input.numPerPage ?? 30;
    if (this.config.validatePayload !== false && (numPerPage < 1 || numPerPage > 200)) {
      throw new InvoiceError(`Invalid numPerPage: ${numPerPage}`, {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "numPerPage must be 1–200",
      });
    }
    const result = await ecpayRequest(
      this.config,
      ENDPOINTS.getIssueList,
      {
        BeginDate: input.beginDate,
        EndDate: input.endDate,
        NumPerPage: numPerPage,
        ShowingPage: input.page ?? 1,
        DataType: "1", // JSON (CSV not supported)
        ...input.filters,
      },
      { plainData: true },
    );
    const rows = Array.isArray(result.InvoiceData)
      ? (result.InvoiceData as Array<Record<string, unknown>>)
      : [];
    return {
      totalCount: Number(result.TotalCount ?? 0),
      page: Number(result.ShowingPage ?? input.page ?? 1),
      invoices: rows.map((w) => ({
        invoiceNumber: String(w.IIS_Number ?? ""),
        orderId: String(w.IIS_Relate_Number ?? ""),
        ubn: stringOrUndef(w.IIS_Identifier, "0000000000"),
        category: String(w.IIS_Category ?? ""),
        taxType: String(w.IIS_Tax_Type ?? ""),
        taxAmount: Number(w.IIS_Tax_Amount ?? 0),
        salesAmount: Number(w.IIS_Sales_Amount ?? 0),
        createdAt: parseEcpayDate(w.IIS_Create_Date),
        voided: w.IIS_Invalid_Status === "1" || w.IIS_Invalid_Status === 1,
        uploaded: w.IIS_Upload_Status === "1" || w.IIS_Upload_Status === 1,
        remainingAllowance: Number(w.IIS_Remain_Allowance_Amt ?? 0),
        raw: w,
      })),
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

  /**
   * 愛心碼/捐贈碼驗證 + 組織名稱: resolve the receiving organisation's name for a
   * donation code, or `undefined` when the code does not exist. The 3–7 digit
   * format is checked first.
   */
  async lookupLoveCodeOrganName(loveCode: string): Promise<string | undefined> {
    if (this.config.validatePayload !== false && !/^\d{3,7}$/.test(loveCode)) {
      throw new InvoiceError(`Invalid love code format: ${loveCode}`, {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "LoveCode must be 3–7 digits",
      });
    }
    const result = await ecpayRequest(this.config, ENDPOINTS.checkLoveCode, { LoveCode: loveCode });
    return result.IsExist === "Y" && result.OrganName ? String(result.OrganName) : undefined;
  }

  /**
   * 統一編號驗證 + 公司名稱 (GetCompanyNameByTaxID): resolve the company name for a
   * 統編, or `undefined` when the number is well-formed but not in any public
   * dataset (查無資料 / 財政部API異常 — these do NOT mean the 統編 is invalid, so
   * keep issuing). Throws VALIDATION only for a bad checksum/format (1200125 /
   * 2027000) — the cases where you should stop.
   */
  async lookupCompanyName(ban: string): Promise<string | undefined> {
    if (this.config.validatePayload !== false && !/^\d{8}$/.test(ban)) {
      throw new InvoiceError(`Invalid 統一編號: ${ban}`, {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "統一編號 must be 8 digits",
      });
    }
    // 7 (查無資料) and 9000001 (財政部API失敗) are "proceed" outcomes, not errors.
    const result = await ecpayRequest(
      this.config,
      ENDPOINTS.getCompanyNameByTaxID,
      { UnifiedBusinessNo: ban },
      { successCodes: [7, 9000001] },
    );
    return Number(result.RtnCode) === 1 && result.CompanyName ? String(result.CompanyName) : undefined;
  }

  /**
   * 統一編號驗證: `true` when a company name was found for the 統編. A well-formed
   * 統編 with no public data resolves `false` (it may still be valid — see
   * {@link EcpayProvider.lookupCompanyName}); a bad checksum/format throws.
   */
  async validateBan(ban: string): Promise<boolean> {
    return (await this.lookupCompanyName(ban)) !== undefined;
  }

  /**
   * 查詢財政部配號結果 (GetGovInvoiceWordSetting): list the invoice number ranges
   * (字軌) the tax authority has allocated to this merchant for a given 民國年
   * (e.g. `"115"` — only last/current/next year). Throws NOT_FOUND (查無資料)
   * when no allocation exists (often: not yet authorised to ECPay).
   */
  async getGovInvoiceWordSetting(invoiceYear: string): Promise<EcpayWordSetting[]> {
    if (this.config.validatePayload !== false && !/^\d{3}$/.test(invoiceYear)) {
      throw new InvoiceError(`Invalid InvoiceYear: ${invoiceYear}`, {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "InvoiceYear must be a 3-digit 民國年 (e.g. 115)",
      });
    }
    const result = await ecpayRequest(this.config, ENDPOINTS.getGovInvoiceWordSetting, {
      InvoiceYear: invoiceYear,
    });
    const info = Array.isArray(result.InvoiceInfo)
      ? (result.InvoiceInfo as Array<Record<string, unknown>>)
      : [];
    return info.map((w) => ({
      term: Number(w.InvoiceTerm),
      invType: String(w.InvType ?? ""),
      header: String(w.InvoiceHeader ?? ""),
      start: String(w.InvoiceStart ?? ""),
      end: String(w.InvoiceEnd ?? ""),
      count: Number(w.Number ?? 0),
    }));
  }

  /**
   * 查詢字軌 (GetInvoiceWordSetting): list this merchant's own 字軌 (TrackID, the
   * allocated number range, the currently-used number, and use status) for a
   * 民國年, optionally filtered by 期別 / status / 字軌類別.
   */
  async getInvoiceWordSetting(input: GetWordSettingInput): Promise<EcpayWordTrack[]> {
    if (this.config.validatePayload !== false && !/^\d{3}$/.test(input.invoiceYear)) {
      throw new InvoiceError(`Invalid InvoiceYear: ${input.invoiceYear}`, {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "InvoiceYear must be a 3-digit 民國年 (e.g. 115)",
      });
    }
    const result = await ecpayRequest(this.config, ENDPOINTS.getInvoiceWordSetting, {
      InvoiceYear: input.invoiceYear,
      InvoiceTerm: input.term ?? 0, // 0 = all
      UseStatus: input.useStatus ? TRACK_STATUS_CODE[input.useStatus] : 0, // 0 = all
      InvoiceCategory: 1, // B2C (fixed)
      InvType: input.invType,
      InvoiceHeader: input.invoiceHeader,
      ProductServiceId: input.productServiceId,
    });
    const info = Array.isArray(result.InvoiceInfo)
      ? (result.InvoiceInfo as Array<Record<string, unknown>>)
      : [];
    return info.map((w) => ({
      trackId: String(w.TrackID ?? ""),
      year: String(w.InvoiceYear ?? ""),
      term: Number(w.InvoiceTerm),
      invType: String(w.InvType ?? ""),
      header: String(w.InvoiceHeader ?? ""),
      start: String(w.InvoiceStart ?? ""),
      end: String(w.InvoiceEnd ?? ""),
      currentNumber: String(w.InvoiceNo ?? ""),
      status: TRACK_STATUS[Number(w.UseStatus)] ?? "INACTIVE",
      productServiceId: stringOrUndef(w.ProductServiceId),
    }));
  }

  /**
   * 設定字軌號碼狀態 (UpdateInvoiceWordStatus): activate (or pause/disable) a
   * track so invoices can be issued against it. Newly added 字軌 default to
   * 已審核但未啟用, so this must be called once before issuing. `trackId` is the
   * TrackID returned when the 字軌 was added.
   */
  async setInvoiceWordStatus(trackId: string, status: EcpayWordStatus): Promise<void> {
    if (this.config.validatePayload !== false && !trackId) {
      throw new InvoiceError("TrackID is required", {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "TrackID is required",
      });
    }
    await ecpayRequest(this.config, ENDPOINTS.updateInvoiceWordStatus, {
      TrackID: trackId,
      InvoiceStatus: WORD_STATUS_CODE[status],
    });
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  /** Map a unified issue input to the ECPay `Issue` Data payload. */
  private buildIssueData(parsed: IssueInvoiceInput): Record<string, unknown> {
    const category = parsed.category ?? deriveCategory(parsed.buyer);
    const carrier = parsed.carrier;
    const donating = Boolean(parsed.donation);
    const opts = (parsed.providerOptions ?? {}) as Record<string, unknown>;
    // Carrier/donation invoices are electronic; everything else prints.
    const print = carrier || donating ? "0" : "1";

    const data: Record<string, unknown> = {
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
      // 零稅率 (TaxType 2/9): ClearanceMark is required by the API; ZeroTaxRateReason
      // is accepted but not enforced. Both come through providerOptions.
      ClearanceMark: opts.clearanceMark as string | undefined,
      ZeroTaxRateReason: opts.zeroTaxRateReason as string | undefined,
      SpecialTaxType: opts.specialTaxType as string | number | undefined,
      ...(opts.data as Record<string, unknown> | undefined),
    };
    if (this.config.validatePayload !== false) assertValidIssuePayload(data);
    return data;
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
    ...(item.remark ? { ItemRemark: item.remark } : {}),
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
  // A remaining-allowance amount below the sales total means it's been credited.
  const sales = Number(result.IIS_Sales_Amount ?? 0);
  const remain = Number(result.IIS_Remain_Allowance_Amt ?? sales);
  if (sales > 0 && remain < sales) return InvoiceStatus.ALLOWANCE;
  return InvoiceStatus.ISSUED;
}

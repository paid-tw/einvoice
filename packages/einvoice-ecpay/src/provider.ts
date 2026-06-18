import {
  type AllowanceInput,
  type AllowanceResult,
  Capability,
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
  parseInput,
  queryInvoiceInputSchema,
  taipeiDateTime,
  taxTypeToCode,
  voidAllowanceInputSchema,
  voidInvoiceInputSchema,
} from "@paid-tw/einvoice";
import { type EcpayResult, ecpayRequest } from "./client.js";
import type { EcpayConfig } from "./config.js";
import { ENDPOINTS } from "./endpoints.js";
import { assertValidIssuePayload } from "./validation.js";
import {
  CARRIER_TYPE,
  NOTIFY_METHOD,
  NOTIFY_RECIPIENT,
  NOTIFY_TAG,
  PRINT_STYLE,
  TRACK_STATUS,
  TRACK_STATUS_CODE,
  WORD_STATUS_CODE,
  type AllowanceDetail,
  type EcpayWordSetting,
  type EcpayWordStatus,
  type EcpayWordTrack,
  type GetAllowanceListInput,
  type GetWordSettingInput,
  type InvalidAllowanceDetail,
  type InvalidDetail,
  type InvoiceListPage,
  type IssuePendingOptions,
  type ListInvoicesInput,
  type OnlineAllowanceResult,
  type PrintInvoiceInput,
  type SendNotifyInput,
  type TriggerIssueResult,
  type VoidReissueInput,
  type VoidReissueResult,
} from "./types.js";

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
    const parsed = parseInput(issueInvoiceInputSchema, input, "ecpay");
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
    const parsed = parseInput(issueInvoiceInputSchema, input, "ecpay");
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
    const parsed = parseInput(issueInvoiceInputSchema, input, "ecpay");
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
    const parsed = parseInput(voidInvoiceInputSchema, input, "ecpay");
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
   * 註銷重開 (VoidWithReIssue): atomically void an invoice and reissue it. ECPay
   * keeps the original 發票號碼 / 自訂編號 / 開立時間 (only the RandomNumber
   * changes), so `reissue.orderId` must be the original RelateNumber and
   * `invoiceDate` the original issue time. Must be done before the 13th of the
   * month after the invoice's period. The reissued invoice's number/date are
   * returned (equal to the original); a still-pending (not-yet-uploaded) invoice
   * can't be re-voided yet.
   */
  async voidWithReissue(input: VoidReissueInput): Promise<VoidReissueResult> {
    const parsed = parseInput(issueInvoiceInputSchema, input.reissue, "ecpay");
    if (this.config.validatePayload !== false && (input.voidReason ?? "").length > 20) {
      throw new InvoiceError("VoidReason must be ≤20 chars", {
        provider: "ecpay",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "註銷原因 (VoidReason) must be ≤20 chars",
      });
    }
    const result = await ecpayRequest(this.config, ENDPOINTS.voidWithReIssue, {
      VoidModel: { InvoiceNo: input.invoiceNumber, VoidReason: input.voidReason },
      IssueModel: {
        ...this.buildIssueData(parsed),
        InvoiceDate:
          typeof input.invoiceDate === "string"
            ? input.invoiceDate
            : taipeiDateTime(input.invoiceDate),
      },
    });
    return {
      invoiceNumber: String(result.InvoiceNo ?? ""),
      invoiceDate: parseEcpayDate(result.InvoiceDate),
      randomCode: String(result.RandomNumber ?? ""),
      raw: result,
    };
  }

  /**
   * 一般開立折讓 (Allowance, 紙本): create a real allowance (綠界 uploads to the
   * MOF the next day) and return its 折讓單號 immediately — it can be voided right
   * away with {@link EcpayProvider.voidAllowance}. Defaults to no buyer
   * notification (`AllowanceNotify="N"`); to notify, pass
   * `providerOptions: { allowanceNotify: "E" | "S" | "A", notifyMail, notifyPhone }`.
   */
  async allowance(input: AllowanceInput): Promise<AllowanceResult> {
    const parsed = parseInput(allowanceInputSchema, input, "ecpay");
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
    const parsed = parseInput(allowanceInputSchema, input, "ecpay");
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
    const parsed = parseInput(voidAllowanceInputSchema, input, "ecpay");
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
    const parsed = parseInput(voidAllowanceInputSchema, input, "ecpay");
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
    const parsed = parseInput(queryInvoiceInputSchema, input, "ecpay");
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
    const items = Array.isArray(result.Items)
      ? (result.Items as Array<Record<string, unknown>>)
      : [];
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
        new InvoiceError(msg, {
          provider: "ecpay",
          code: InvoiceErrorCode.VALIDATION,
          rawMessage: msg,
        });
      if (!input.email && !input.phone) throw fail("email or phone is required");
      if (["A", "AI", "OA"].includes(tag) && !input.allowanceNumber)
        throw fail("allowanceNumber is required for allowance notifications");
      if (
        input.tag === "ONLINE_ALLOWANCE" &&
        (input.method !== "EMAIL" || input.recipient !== "CUSTOMER")
      )
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
    if (
      this.config.validatePayload !== false &&
      (!input.orderId || !input.invoiceNumber || !input.invoiceDate)
    ) {
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
        rawMessage:
          "GetAllowanceList needs SearchType 0 (allowanceNumber) or 1/2 (invoiceNumber + date)",
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
      items: (Array.isArray(a.Items) ? (a.Items as Array<Record<string, unknown>>) : []).map(
        (it) => ({
          description: String(it.ItemName ?? ""),
          quantity: Number(it.ItemCount ?? 0),
          unitPrice: Number(it.ItemPrice ?? 0),
          amount: Number(it.ItemAmount ?? 0),
          unit: stringOrUndef(it.ItemWord),
        }),
      ),
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
    return Number(result.RtnCode) === 1 && result.CompanyName
      ? String(result.CompanyName)
      : undefined;
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
    // ECPay's B2C 2.0 API has no foreign-currency field (no FOREIGN_CURRENCY
    // capability), so reject a non-TWD currency rather than silently dropping it.
    if (this.config.validatePayload !== false && parsed.currency && parsed.currency !== "TWD") {
      throw new InvoiceError(
        `ECPay does not support foreign-currency invoices; currency must be TWD (got ${parsed.currency})`,
        {
          provider: "ecpay",
          code: InvoiceErrorCode.UNSUPPORTED,
          rawMessage: "FOREIGN_CURRENCY is not supported",
        },
      );
    }
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

/** Unified TaxType → ECPay TaxType (1 應稅 / 2 零稅率 / 3 免稅; 9 混合 handled per-item). */
export const ecpayTaxType = taxTypeToCode;

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

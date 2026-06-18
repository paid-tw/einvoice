import {
  Capability,
  InvoiceError,
  InvoiceErrorCode,
  InvoiceStatus,
  parseInput,
  parseTaipeiDate,
  queryInvoiceInputSchema,
  voidAllowanceInputSchema,
  voidInvoiceInputSchema,
  type AllowanceInput,
  type AllowanceResult,
  type InvoiceItem,
  type InvoiceProvider,
  type IssueInvoiceInput,
  type IssueInvoiceResult,
  type QueryInvoiceInput,
  type QueryInvoiceResult,
  type VoidAllowanceInput,
  type VoidAllowanceResult,
  type VoidInvoiceInput,
  type VoidInvoiceResult,
} from "@paid-tw/einvoice";
import {
  type EzpayConfig,
  ezpayRequest,
  ezpayTimestamp,
  makeCheckCode,
} from "@paid-tw/einvoice-ezpay";
import { CB_ENDPOINTS } from "./endpoints.js";
import { assertValidCrossBorderIssue, resolveCurrency } from "./validation.js";

/** Cross-border provider config — identical shape to {@link EzpayConfig}. */
export type EzpayCrossBorderConfig = EzpayConfig;

/** Result of {@link EzpayCrossBorderProvider.issuePending} (Status 0/3, no number yet). */
export interface CrossBorderPendingInvoice {
  /** ezPay 開立序號 — pass to {@link EzpayCrossBorderProvider.triggerIssue}. */
  invoiceTransNo: string;
  orderId: string;
  raw: unknown;
}

/** Options for {@link EzpayCrossBorderProvider.issuePending}. */
export interface IssuePendingOptions {
  /** `"TRIGGER"` (Status=0, default) or `"SCHEDULE"` (Status=3, auto-issues). */
  mode?: "TRIGGER" | "SCHEDULE";
  /** `YYYY-MM-DD` scheduled issue date — required for `"SCHEDULE"`. */
  createStatusTime?: string;
}

const fail = (message: string, code = InvoiceErrorCode.VALIDATION) =>
  new InvoiceError(message, { provider: "ezpay-crossborder", code, rawMessage: message });

/** Format an amount: TWD → integer string, foreign currency → 2 decimals. */
function fmtAmount(value: number, foreign: boolean): string {
  return foreign ? value.toFixed(2) : String(Math.round(value));
}

/** Build the pipe-joined item fields (cross-border: tax-inclusive ItemPrice, ItemTaxAmt=0). */
function joinItems(items: InvoiceItem[], foreign: boolean): Record<string, string> {
  return {
    ItemName: items.map((i) => i.description).join("|"),
    ItemCount: items.map((i) => i.quantity).join("|"),
    ItemUnit: items.map((i) => i.unit ?? "式").join("|"),
    ItemPrice: items.map((i) => fmtAmount(i.unitPrice, foreign)).join("|"),
    ItemAmt: items.map((i) => fmtAmount(i.amount, foreign)).join("|"),
  };
}

/**
 * ezPay 境外電商 (CES) provider — foreign-currency-native B2C e-invoices.
 *
 * Reuses the standard ezPay wire layer (AES-256-CBC `PostData_`, CheckCode,
 * `Status`/`Result` envelope) over the cross-border endpoints. It is B2C and
 * e-mail-carrier only, so it does NOT support 統編 (B2B) / 載具 / 捐贈 / 混合稅率;
 * those are rejected as `UNSUPPORTED`. Set `currency` + `exchangeRate` on the
 * issue input for a foreign-currency sale (amounts then carry 2 decimals).
 */
export class EzpayCrossBorderProvider implements InvoiceProvider {
  readonly name = "ezpay-crossborder";

  readonly capabilities: ReadonlySet<Capability> = new Set([
    Capability.ISSUE,
    Capability.VOID,
    Capability.ALLOWANCE,
    Capability.VOID_ALLOWANCE,
    Capability.QUERY,
    Capability.QUERY_BY_ORDER_ID,
    Capability.SCHEDULED_ISSUE,
    Capability.FOREIGN_CURRENCY,
  ]);

  constructor(private readonly config: EzpayCrossBorderConfig) {}

  /** 即時開立發票 (Status=1). */
  async issue(input: IssueInvoiceInput): Promise<IssueInvoiceResult> {
    // NB: issue/allowance use a cross-border-specific validator instead of the
    // shared issueInvoiceInputSchema — foreign-currency sales carry 2-decimal
    // amounts, which the core amountSummarySchema (integer-only) would reject.
    if (this.config.validatePayload !== false) assertValidCrossBorderIssue(input);
    const res = await ezpayRequest(
      this.config,
      CB_ENDPOINTS.issue.path,
      this.buildIssuePostData(input, "1"),
    );
    const r = res.result;
    this.verifyIssueCheckCode(r);
    return {
      invoiceNumber: String(r.InvoiceNumber ?? ""),
      invoiceDate: parseTaipeiDate(r.CreateTime),
      randomCode: String(r.RandomNum ?? ""),
      orderId: input.orderId,
      totalAmount: Number(r.TotalAmt ?? input.amount.totalAmount),
      status: InvoiceStatus.ISSUED,
      raw: res.raw,
    };
  }

  /**
   * 等待觸發 (Status=0) / 預約自動開立 (Status=3) — stages the invoice without a
   * number. Trigger it (or wait for the scheduled date) with {@link triggerIssue}.
   */
  async issuePending(
    input: IssueInvoiceInput,
    options: IssuePendingOptions = {},
  ): Promise<CrossBorderPendingInvoice> {
    const schedule = options.mode === "SCHEDULE";
    if (this.config.validatePayload !== false) {
      assertValidCrossBorderIssue(input);
      if (schedule && !/^\d{4}-\d{2}-\d{2}$/.test(options.createStatusTime ?? "")) {
        throw fail("createStatusTime (YYYY-MM-DD) is required for SCHEDULE");
      }
    }
    const postData = this.buildIssuePostData(input, schedule ? "3" : "0", options.createStatusTime);
    const res = await ezpayRequest(this.config, CB_ENDPOINTS.issue.path, postData);
    return {
      invoiceTransNo: String(res.result.InvoiceTransNo ?? ""),
      orderId: input.orderId,
      raw: res.raw,
    };
  }

  /** 觸發開立 — issue a staged (Status 0/3) invoice now. */
  async triggerIssue(args: {
    invoiceTransNo: string;
    orderId: string;
    totalAmount: number;
    currency?: string;
  }): Promise<IssueInvoiceResult> {
    const foreign = (args.currency ?? "TWD").toUpperCase() !== "TWD";
    const res = await ezpayRequest(this.config, CB_ENDPOINTS.triggerIssue.path, {
      RespondType: "JSON",
      Version: CB_ENDPOINTS.triggerIssue.version,
      TimeStamp: ezpayTimestamp(),
      InvoiceTransNo: args.invoiceTransNo,
      MerchantOrderNo: args.orderId,
      TotalAmt: fmtAmount(args.totalAmount, foreign),
    });
    const r = res.result;
    this.verifyIssueCheckCode(r);
    return {
      invoiceNumber: String(r.InvoiceNumber ?? ""),
      invoiceDate: parseTaipeiDate(r.CreateTime),
      randomCode: String(r.RandomNum ?? ""),
      orderId: args.orderId,
      totalAmount: Number(r.TotalAmt ?? args.totalAmount),
      status: InvoiceStatus.ISSUED,
      raw: res.raw,
    };
  }

  /** 作廢發票. `reason` ≤ 6 中文字 / 20 英數字. */
  async void(input: VoidInvoiceInput): Promise<VoidInvoiceResult> {
    parseInput(voidInvoiceInputSchema, input, "ezpay-crossborder");
    if (this.config.validatePayload !== false && (input.reason ?? "").length > 20) {
      throw fail("作廢原因 (reason) must be ≤20 chars");
    }
    const res = await ezpayRequest(this.config, CB_ENDPOINTS.void.path, {
      RespondType: "JSON",
      Version: CB_ENDPOINTS.void.version,
      TimeStamp: ezpayTimestamp(),
      InvoiceNumber: input.invoiceNumber,
      InvalidReason: input.reason,
    });
    return { invoiceNumber: input.invoiceNumber, status: InvoiceStatus.VOIDED, raw: res.raw };
  }

  /**
   * 開立折讓. Defaults to 不立即確認 (Status=0) — confirm/cancel later with
   * {@link confirmAllowance} / {@link cancelAllowance}. Pass
   * `providerOptions: { confirm: true }` to confirm immediately (Status=1).
   * The original invoice's currency/email travel via `providerOptions`
   * (`currency`, `exchangeRate`, `buyerEmail`, `merchantOrderNo`).
   */
  async allowance(input: AllowanceInput): Promise<AllowanceResult> {
    const opts = (input.providerOptions ?? {}) as Record<string, unknown>;
    const currency = resolveCurrency({ currency: opts.currency as string | undefined });
    const foreign = currency !== "TWD";
    const items = joinItems(input.items, foreign);
    const res = await ezpayRequest(this.config, CB_ENDPOINTS.allowance.path, {
      RespondType: "JSON",
      Version: CB_ENDPOINTS.allowance.version,
      TimeStamp: ezpayTimestamp(),
      InvoiceNo: input.invoiceNumber,
      MerchantOrderNo: (opts.merchantOrderNo as string | undefined) ?? input.allowanceId,
      ...items,
      ItemTaxAmt: input.items.map(() => "0").join("|"),
      TotalAmt: fmtAmount(input.amount.totalAmount, foreign),
      BuyerEmail: opts.buyerEmail as string | undefined,
      Status: opts.confirm ? "1" : "0",
    });
    const r = res.result;
    return {
      allowanceNumber: String(r.AllowanceNo ?? ""),
      invoiceNumber: String(r.InvoiceNumber ?? input.invoiceNumber),
      allowanceDate: input.date ?? new Date(),
      totalAmount: Number(r.AllowanceAmt ?? input.amount.totalAmount),
      raw: res.raw,
    };
  }

  /** 觸發確認折讓 (C) — upload a pending (Status=0) allowance to the MOF. */
  async confirmAllowance(args: {
    allowanceNumber: string;
    orderId: string;
    totalAmount: number;
    currency?: string;
  }): Promise<VoidAllowanceResult> {
    return this.touchAllowance("C", args);
  }

  /** 觸發取消折讓 (D) — cancel a still-pending allowance. */
  async cancelAllowance(args: {
    allowanceNumber: string;
    orderId: string;
    totalAmount: number;
    currency?: string;
  }): Promise<VoidAllowanceResult> {
    return this.touchAllowance("D", args);
  }

  /** 作廢已確認折讓. `reason` ≤ 6 中文字 / 20 英數字. */
  async voidAllowance(input: VoidAllowanceInput): Promise<VoidAllowanceResult> {
    parseInput(voidAllowanceInputSchema, input, "ezpay-crossborder");
    if (this.config.validatePayload !== false && (input.reason ?? "").length > 20) {
      throw fail("作廢原因 (reason) must be ≤20 chars");
    }
    const res = await ezpayRequest(this.config, CB_ENDPOINTS.voidAllowance.path, {
      RespondType: "JSON",
      Version: CB_ENDPOINTS.voidAllowance.version,
      TimeStamp: ezpayTimestamp(),
      AllowanceNo: input.allowanceNumber,
      InvalidReason: input.reason ?? "作廢折讓",
    });
    return {
      allowanceNumber: String(res.result.AllowanceNo ?? input.allowanceNumber),
      raw: res.raw,
    };
  }

  /**
   * 查詢發票. By `invoiceNumber` (情境一, needs `providerOptions.randomCode`) or by
   * `orderId` (情境二, needs `providerOptions.totalAmount` + optional `currency`).
   */
  async query(input: QueryInvoiceInput): Promise<QueryInvoiceResult> {
    parseInput(queryInvoiceInputSchema, input, "ezpay-crossborder");
    const opts = (input.providerOptions ?? {}) as Record<string, unknown>;
    const base = {
      RespondType: "JSON",
      Version: CB_ENDPOINTS.search.version,
      TimeStamp: ezpayTimestamp(),
    };
    let postData: Record<string, string | number | undefined>;
    if (input.orderId) {
      const foreign = ((opts.currency as string | undefined) ?? "TWD").toUpperCase() !== "TWD";
      postData = {
        ...base,
        SearchType: "1",
        MerchantOrderNo: input.orderId,
        TotalAmt: fmtAmount(Number(opts.totalAmount), foreign),
      };
    } else if (input.invoiceNumber) {
      postData = {
        ...base,
        SearchType: "0",
        InvoiceNumber: input.invoiceNumber,
        RandomNum: String(opts.randomCode ?? ""),
      };
    } else {
      throw fail("query requires invoiceNumber (+ randomCode) or orderId (+ totalAmount)");
    }
    const res = await ezpayRequest(this.config, CB_ENDPOINTS.search.path, postData);
    const r = res.result;
    const items: InvoiceItem[] = parseItemDetail(r.ItemDetail);
    return {
      invoiceNumber: String(r.InvoiceNumber ?? ""),
      invoiceDate: parseTaipeiDate(r.CreateTime),
      randomCode: String(r.RandomNum ?? ""),
      orderId: r.MerchantOrderNo ? String(r.MerchantOrderNo) : undefined,
      status: String(r.InvoiceStatus) === "2" ? InvoiceStatus.VOIDED : InvoiceStatus.ISSUED,
      amount: {
        salesAmount: Number(r.Amt ?? 0),
        taxAmount: Number(r.TaxAmt ?? 0),
        totalAmount: Number(r.TotalAmt ?? 0),
      },
      buyer: {
        name: r.BuyerName ? String(r.BuyerName) : undefined,
        address: r.BuyerAddress ? String(r.BuyerAddress) : undefined,
        email: r.BuyerEmail ? String(r.BuyerEmail) : undefined,
      },
      items,
      raw: res.raw,
    };
  }

  private async touchAllowance(
    action: "C" | "D",
    args: { allowanceNumber: string; orderId: string; totalAmount: number; currency?: string },
  ): Promise<VoidAllowanceResult> {
    const foreign = (args.currency ?? "TWD").toUpperCase() !== "TWD";
    const res = await ezpayRequest(this.config, CB_ENDPOINTS.allowanceTouch.path, {
      RespondType: "JSON",
      Version: CB_ENDPOINTS.allowanceTouch.version,
      TimeStamp: ezpayTimestamp(),
      AllowanceStatus: action,
      AllowanceNo: args.allowanceNumber,
      MerchantOrderNo: args.orderId,
      TotalAmt: fmtAmount(args.totalAmount, foreign),
    });
    return {
      allowanceNumber: String(res.result.AllowanceNo ?? args.allowanceNumber),
      raw: res.raw,
    };
  }

  /**
   * Verify an issued invoice's response `CheckCode` (附件二): SHA-256 over
   * MerchantID / MerchantOrderNo / InvoiceTransNo / TotalAmt / RandomNum sorted
   * A–Z and wrapped by HashIV/HashKey. Detects a tampered or mis-routed reply.
   * Skipped when `verifyCheckCode` is `false`. `TotalAmt` must be the raw string
   * ezPay returned (foreign currency comes back with trailing decimals).
   */
  private verifyIssueCheckCode(r: Record<string, unknown>): void {
    if (this.config.verifyCheckCode === false) return;
    const expected = makeCheckCode(
      {
        MerchantID: String(r.MerchantID ?? ""),
        MerchantOrderNo: String(r.MerchantOrderNo ?? ""),
        InvoiceTransNo: String(r.InvoiceTransNo ?? ""),
        TotalAmt: String(r.TotalAmt ?? ""),
        RandomNum: String(r.RandomNum ?? ""),
      },
      this.config.hashKey,
      this.config.hashIV,
    );
    if (expected !== String(r.CheckCode ?? "")) {
      throw new InvoiceError(
        "ezPay cross-border response CheckCode mismatch — possible tampering",
        {
          provider: "ezpay-crossborder",
          code: InvoiceErrorCode.PROVIDER,
          rawMessage: "CheckCode mismatch",
          raw: r,
        },
      );
    }
  }

  private buildIssuePostData(
    input: IssueInvoiceInput,
    status: string,
    createStatusTime?: string,
  ): Record<string, string | number | undefined> {
    const currency = resolveCurrency(input);
    const foreign = currency !== "TWD";
    return {
      RespondType: "JSON",
      Version: CB_ENDPOINTS.issue.version,
      TimeStamp: ezpayTimestamp(),
      MerchantOrderNo: input.orderId,
      Status: status,
      ...(status === "3" ? { CreateStatusTime: createStatusTime } : {}),
      BuyerName: input.buyer.name ?? input.buyer.email,
      BuyerAddress: input.buyer.address,
      BuyerEmail: input.buyer.email,
      Amt: fmtAmount(input.amount.salesAmount, foreign),
      TaxAmt: fmtAmount(input.amount.taxAmount, foreign),
      TotalAmt: fmtAmount(input.amount.totalAmount, foreign),
      ...joinItems(input.items, foreign),
      Comment: input.remark,
      Currency: currency,
      OriginalCurrencyAmount: fmtAmount(input.amount.totalAmount, foreign),
      ExchangeRate: input.exchangeRate ?? 1,
    };
  }
}

/** Parse the query response's `ItemDetail` JSON array into unified items. */
function parseItemDetail(value: unknown): InvoiceItem[] {
  let rows: Array<Record<string, unknown>>;
  try {
    rows =
      typeof value === "string"
        ? JSON.parse(value)
        : Array.isArray(value)
          ? (value as Array<Record<string, unknown>>)
          : [];
  } catch {
    rows = [];
  }
  return rows.map((it) => ({
    description: String(it.ItemName ?? ""),
    quantity: Number(it.ItemCount ?? 0),
    unitPrice: Number(it.ItemPrice ?? 0),
    amount: Number(it.ItemAmount ?? 0),
    unit: it.ItemWord ? String(it.ItemWord) : undefined,
  }));
}

/** Create an ezPay cross-border {@link InvoiceProvider}. */
export function createEzpayCrossBorderProvider(
  config: EzpayCrossBorderConfig,
): EzpayCrossBorderProvider {
  return new EzpayCrossBorderProvider(config);
}

import {
  Capability,
  InvoiceError,
  InvoiceErrorCode,
  InvoiceStatus,
  type AllowanceInput,
  type AllowanceResult,
  type Buyer,
  type Carrier,
  type InvoiceItem,
  type InvoiceProvider,
  type IssueInvoiceInput,
  type IssueInvoiceResult,
  type QueryInvoiceInput,
  type QueryInvoiceResult,
  type TaxType,
  type VoidAllowanceInput,
  type VoidAllowanceResult,
  type VoidInvoiceInput,
  type VoidInvoiceResult,
} from "@paid-tw/einvoice";
import { EzreceiptClient } from "./client.js";
import { type EzreceiptConfig } from "./config.js";
import { ENDPOINTS } from "./endpoints.js";

/** ezReceipt carrierType: 1 會員 / 2 手機條碼 / 3 自然人憑證 / 5 捐贈 / 10 紙本 / 20 境外電商. */
const CARRIER_TYPE: Record<Carrier["type"], number> = {
  MEMBER: 1,
  MOBILE_BARCODE: 2,
  CITIZEN_CERTIFICATE: 3,
};

/** Unified TaxType → ezReceipt taxType (1 應稅 / 2 零稅率 / 3 免稅). 特種 issues as 應稅 + trCode. */
export function ezreceiptTaxType(taxType: TaxType): number {
  switch (taxType) {
    case "ZERO_RATED":
      return 2;
    case "TAX_FREE":
      return 3;
    default:
      return 1; // TAXABLE / SPECIAL
  }
}

const fail = (message: string, code = InvoiceErrorCode.VALIDATION) =>
  new InvoiceError(message, { provider: "ezreceipt", code, rawMessage: message });

/** One used/unused number range within a 字軌 segment's `usage`. */
export interface InvoiceTrackUsage {
  startNo: number;
  endNo: number;
  /** -1 非易發票使用 / 0 未使用 / 1 已使用. */
  status: number;
}

/** One 字軌 segment (分段字軌) from {@link EzreceiptProvider.listInvoiceTracks}. */
export interface InvoiceTrack {
  /** 字軌識別碼 (inID) — key for {@link EzreceiptProvider.adjustInvoiceTrack}. */
  inID: number;
  /** 期別 YYYYMM (起始月). */
  period: string;
  /** 字軌名稱, e.g. `"SX"`. */
  lead: string;
  /** 起始 8-digit 號碼. */
  startNo: number;
  /** 結束 8-digit 號碼. */
  endNo: number;
  /** 字軌類別: 7 一般稅額 / 8 特種稅額. */
  invType: number;
  /** 0 不限 / 1 無統編 / 2 有統編. */
  bizType: number;
  /** 備註. */
  memo?: string | null;
  /** 是否已關閉 (0/1). */
  isClosed: number;
  /** 0 使用中 / 1 未來期別 / 2 過期 / 3 用盡 (不可開啟). */
  closedCode?: number;
  /** 字軌所屬平台 (1 易發票 / 100 其他 / null 未設定). */
  platform: number | null;
  /** 商標識別碼. */
  sgoID?: number | null;
  /** 空白號碼上傳財政部的時間. */
  uploadTime?: string | null;
  /** 上傳狀態: -2 未知錯誤 / -1 處理中 / 0 成功 / 1 合約到期 / 51 字軌授權到期. */
  resultCode?: number;
  /** 各號碼區間的使用狀況. */
  usage?: InvoiceTrackUsage[];
  /** 最後修改者 ({ userID, dspName 膩稱 }). */
  modifier?: { userID?: number; dspName?: string | null } | null;
  /** 最後修改日期. */
  modifyTime?: string | null;
}

/** Filters for {@link EzreceiptProvider.listInvoiceTracks}. */
export interface ListInvoiceTracksInput {
  /** 期別 YYYYMM. Defaults to the current period. */
  period?: string;
  /** 7 一般稅額 / 8 特種稅額. */
  invType?: 7 | 8;
  /** 0 不限 / 1 無統編 / 2 有統編. */
  bizType?: 0 | 1 | 2;
  /** Strict-match the `bizType` (forceBiz=true). */
  forceBiz?: boolean;
  /** Only the currently-open 字軌 (isActive=1). */
  activeOnly?: boolean;
  /** Only tracks used on a platform: 1 易發票 / 100 其他. */
  platform?: 1 | 100;
  /** Sort order by 字軌 year/month/number. `"DESC"` (default) / `"ASC"`. */
  order?: "ASC" | "DESC";
  /** Page number (1-based). */
  page?: number;
  /** Page size (default 10). */
  pageSize?: number;
}

/** Filters for {@link EzreceiptProvider.listInvoices}. period (or fromTime/toTime) is required by the API. */
export interface ListInvoicesInput {
  /**
   * 期別 YYYYMM — a BIMONTHLY code starting on an ODD month (01=Jan–Feb,
   * 03=Mar–Apr, 05=May–Jun, …); e.g. June 2026 → `"202605"`, not `"202606"`.
   * Defaults to the current period; ignored when fromTime is set.
   */
  period?: string;
  /** Issue-time range start `YYYY-MM-DD HH:mm:ss` (overrides period). */
  fromTime?: string;
  /** Issue-time range end `YYYY-MM-DD HH:mm:ss`. */
  toTime?: string;
  /** Field to filter on; append `%` to propValue for a partial match. */
  prop?: "invNo" | "nid" | "orderNo" | "boNo" | "devNo" | "winNo" | "accName" | "extID" | "storeName" | "storeNID" | "carrierInfo" | "buyerName";
  /** Value for {@link prop}. */
  propValue?: string;
  /** 1 會員 / 2 手機條碼 / 3 自然人憑證 / 5 捐贈 / 10 紙本 / 20 境外. */
  carrierType?: 1 | 2 | 3 | 5 | 10 | 20;
  /** Only voided (true) / only non-voided (false). */
  voided?: boolean;
  /** 1 存證 / 2 交換. */
  msgType?: 1 | 2;
  /** Has 統編 (true) / no 統編 (false). */
  withUbn?: boolean;
  /** Page number (1-based). */
  page?: number;
  /** Page size (default 10). */
  pageSize?: number;
}

/** One line's remaining creditable (折讓) quota from {@link EzreceiptProvider.getAllowanceQuota}. */
export interface AllowanceQuotaItem {
  /** 原發票品項識別碼 (soiID) — use it in an allowance's prodList. */
  soiID: number;
  /** 商品編號. */
  prodNo?: string | null;
  /** 商品名稱. */
  title?: string | null;
  /** 建議數量 (not strictly enforced by the tax authority). */
  qty: number;
  /** 尚餘可折讓金額 (未稅). */
  amount: number;
  /** 尚餘可折讓稅額. */
  tax: number;
}

/** Parse an ezReceipt datetime ("YYYY-MM-DD HH:mm:ss", Asia/Taipei) → Date. */
function parseDate(value: unknown): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(value ?? "").trim());
  if (!m) return new Date();
  const [, y, mo, d, hh, mi, ss] = m;
  return new Date(`${y}-${mo}-${d}T${hh}:${mi}:${ss}+08:00`);
}

/**
 * Format a Date as `YYYY-MM-DD HH:mm:ss` in Asia/Taipei (for `invoiceTime`).
 * The `"sv-SE"` locale is intentional — Swedish formats dates ISO-style
 * (`YYYY-MM-DD HH:mm:ss`), the exact shape ezReceipt expects.
 */
function taipeiDateTime(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace("T", " ");
}

/**
 * ezReceipt 易發票 (COIMOTION) provider. Order-centric REST API: the unified
 * `issue` maps to the all-in-one `eInvoice/invoice/issue` (the order is created
 * implicitly from `prodList`). Operations key off the internal `invID` (not the
 * 發票號碼); the issue result's `raw.id` is the invID — pass it back via
 * `providerOptions.invID` for void/query/allowance, or let the provider resolve
 * it from the invoice number.
 */
export class EzreceiptProvider implements InvoiceProvider {
  readonly name = "ezreceipt";

  // Verified live: B2B (issueTo 統編), mixed per-item tax, and carrier issuance
  // all work. FOREIGN_CURRENCY is NOT declared — true 境外電商 (carrierType 20)
  // requires a 境外電商-type account (a normal account returns 1052); the
  // `currency` param is tolerated but doesn't make a domestic invoice foreign.
  readonly capabilities: ReadonlySet<Capability> = new Set([
    Capability.ISSUE,
    Capability.VOID,
    Capability.ALLOWANCE,
    Capability.VOID_ALLOWANCE,
    Capability.QUERY,
    Capability.B2B,
    Capability.MIXED_TAX,
  ]);

  private readonly client: EzreceiptClient;

  constructor(private readonly config: EzreceiptConfig) {
    this.client = new EzreceiptClient(config);
  }

  /** 開立發票 — all-in-one (creates the order from `prodList` + issues). */
  async issue(input: IssueInvoiceInput): Promise<IssueInvoiceResult> {
    const r = await this.client.request<Record<string, unknown>>(ENDPOINTS.issue, this.buildIssueBody(input));
    return {
      invoiceNumber: String(r.invNo ?? ""),
      invoiceDate: parseDate(r.createTime ?? r.invoiceTime),
      randomCode: String(r.randNo ?? ""),
      orderId: input.orderId,
      totalAmount: input.amount.totalAmount,
      status: InvoiceStatus.ISSUED,
      raw: r,
    };
  }

  /** 作廢發票. `reason` ≤ 20 chars. Needs the invID (via `providerOptions.invID`). */
  async void(input: VoidInvoiceInput): Promise<VoidInvoiceResult> {
    if (this.config.validatePayload !== false && (input.reason ?? "").length > 20) {
      throw fail("作廢原因 (voidReason) must be ≤20 chars");
    }
    const invID = await this.resolveInvID(input.invoiceNumber, input.providerOptions);
    const r = await this.client.request(ENDPOINTS.void(invID), { voidReason: input.reason });
    return { invoiceNumber: input.invoiceNumber, status: InvoiceStatus.VOIDED, raw: r };
  }

  /**
   * 開立折讓證明單. Credits invoice lines by their `soiID` (resolved from the
   * invoice unless supplied). `amount` is the tax-exclusive credit per line.
   */
  async allowance(input: AllowanceInput): Promise<AllowanceResult> {
    const opts = (input.providerOptions ?? {}) as { invID?: number; itemTax?: number[]; allowTime?: string; needConfirm?: boolean };
    const invID = await this.resolveInvID(input.invoiceNumber, input.providerOptions);
    // The invoice line ids (soiID) come from a view; the create call keys off
    // those (no path id), so the credited invoice is identified per line.
    const invoice = await this.client.request<Record<string, unknown>>(ENDPOINTS.view(invID), {});
    const lines = (invoice.prodList as Array<Record<string, unknown>> | undefined) ?? [];
    const prodList = input.items.map((item, i) => ({
      soiID: lines[i]?.soiID,
      qty: item.quantity,
      amount: item.amount, // 稅前小計
      // Full-line credit: reuse the invoice line's tax; override per line via providerOptions.itemTax.
      tax: opts.itemTax?.[i] ?? Number(lines[i]?.saleTax ?? 0),
    }));
    const r = await this.client.request<Record<string, unknown>>(ENDPOINTS.allowanceCreate, {
      prodList,
      ...(opts.allowTime ? { allowTime: opts.allowTime } : {}),
      ...(opts.needConfirm ? { needConfirm: true } : {}),
    });
    return {
      allowanceNumber: String(r.awNo ?? ""),
      invoiceNumber: input.invoiceNumber,
      allowanceDate: parseDate(r.createTime),
      totalAmount: input.amount.totalAmount,
      raw: r,
    };
  }

  /**
   * 作廢折讓. Keyed by the allowance's internal `awID` — pass it via
   * `providerOptions.awID` (from the allowance result's `raw.awID`).
   */
  async voidAllowance(input: VoidAllowanceInput): Promise<VoidAllowanceResult> {
    if (this.config.validatePayload !== false && (input.reason ?? "").length > 20) {
      throw fail("作廢原因 (voidReason) must be ≤20 chars");
    }
    const awID = await this.resolveAwID(input.allowanceNumber, input.providerOptions);
    const r = await this.client.request(ENDPOINTS.allowanceVoid(awID), { voidReason: input.reason ?? "作廢折讓" });
    return { allowanceNumber: input.allowanceNumber, raw: r };
  }

  /** 查詢發票. By the internal `invID` (`providerOptions.invID`) or invoice number. */
  async query(input: QueryInvoiceInput): Promise<QueryInvoiceResult> {
    const invID = await this.resolveInvID(input.invoiceNumber, input.providerOptions);
    const r = await this.client.request<Record<string, unknown>>(ENDPOINTS.view(invID), {});
    const sales = Number(r.salesAmount ?? 0);
    const tax = Number(r.taxAmount ?? 0);
    const buyer = (r.buyer ?? {}) as Record<string, unknown>;
    return {
      invoiceNumber: String(r.invNo ?? ""),
      invoiceDate: parseDate(r.invoiceTime),
      randomCode: String(r.randNo ?? ""),
      orderId: r.orderNo ? String(r.orderNo) : undefined,
      status: String(r.procState) === "13" ? InvoiceStatus.VOIDED : InvoiceStatus.ISSUED,
      amount: { salesAmount: sales, taxAmount: tax, totalAmount: sales + tax },
      buyer: {
        name: buyer.name ? String(buyer.name) : undefined,
        ubn: buyer.nid ? String(buyer.nid) : undefined,
        address: buyer.addr ? String(buyer.addr) : undefined,
        phone: buyer.phone ? String(buyer.phone) : undefined,
        email: buyer.email ? String(buyer.email) : undefined,
      },
      items: ((r.prodList as Array<Record<string, unknown>>) ?? []).map((p) => ({
        description: String(p.title ?? ""),
        quantity: Number(p.qty ?? 0),
        unitPrice: Number(p.sales ?? 0),
        amount: Number(p.sales ?? 0),
        unit: p.unit ? String(p.unit) : undefined,
      })),
      raw: r,
    };
  }

  /**
   * 條列發票 — list issued invoices for reconciliation/reporting. The API needs a
   * `period` (or a fromTime/toTime range); it can't reach back more than 5 years.
   * Returns the raw invoice rows plus the total `entries` count (for paging).
   */
  async listInvoices(input: ListInvoicesInput = {}): Promise<{ entries: number; list: Record<string, unknown>[] }> {
    const r = await this.client.request<{ entries?: number; list?: Record<string, unknown>[] }>(ENDPOINTS.list, {
      ...(input.period ? { period: input.period } : {}),
      ...(input.fromTime ? { fromTime: input.fromTime } : {}),
      ...(input.toTime ? { toTime: input.toTime } : {}),
      ...(input.prop ? { prop: input.prop } : {}),
      ...(input.propValue != null ? { propValue: input.propValue } : {}),
      ...(input.carrierType ? { carrierType: input.carrierType } : {}),
      ...(input.voided != null ? { isVoid: input.voided ? 1 : 0 } : {}),
      ...(input.msgType ? { msgType: input.msgType } : {}),
      ...(input.withUbn != null ? { withGUINo: input.withUbn } : {}),
      ...(input.page ? { _pn: input.page } : {}),
      ...(input.pageSize ? { _ps: input.pageSize } : {}),
    });
    return { entries: Number(r.entries ?? 0), list: r.list ?? [] };
  }

  /**
   * 各品項尚餘可折讓額度 — an invoice can be credited multiple times; this returns
   * each line's remaining creditable quantity / amount (untaxed) / tax. Useful
   * for validating or building a partial allowance.
   */
  async getAllowanceQuota(invoiceNumber: string, providerOptions?: Record<string, unknown>): Promise<AllowanceQuotaItem[]> {
    const invID = await this.resolveInvID(invoiceNumber, providerOptions);
    const r = await this.client.request<{ itemList?: AllowanceQuotaItem[] }>(ENDPOINTS.allowQuota(invID), {});
    return r.itemList ?? [];
  }

  // --- 字軌 management (extension — beyond the unified InvoiceProvider) -------

  /**
   * 字軌分段清單 — list this merchant's invoice-number tracks. (字軌 配號 itself is
   * backend-only; the API can only manage existing tracks.)
   */
  async listInvoiceTracks(input: ListInvoiceTracksInput = {}): Promise<InvoiceTrack[]> {
    const r = await this.client.request<{ list?: InvoiceTrack[] }>(ENDPOINTS.invNumberList(this.config.stID), {
      ...(input.period ? { period: input.period } : {}),
      ...(input.invType ? { invType: input.invType } : {}),
      ...(input.bizType != null ? { bizType: input.bizType } : {}),
      ...(input.forceBiz ? { forceBiz: true } : {}),
      ...(input.activeOnly ? { isActive: 1 } : {}),
      ...(input.platform ? { platform: input.platform } : {}),
      ...(input.order ? { dspOrder: input.order === "ASC" ? 2 : 1 } : {}),
      ...(input.page ? { _pn: input.page } : {}),
      ...(input.pageSize ? { _ps: input.pageSize } : {}),
    });
    return r.list ?? [];
  }

  /**
   * 調整字軌分段起訖號 — adjust a track segment's `startNo` and/or `endNo` (keyed by
   * its `inID`). Subject to the API's neighbour-segment / already-used rules.
   */
  async adjustInvoiceTrack(
    inID: string | number,
    change: { startNo?: string | number; endNo?: string | number },
  ): Promise<InvoiceTrack> {
    if (this.config.validatePayload !== false && change.startNo == null && change.endNo == null) {
      throw fail("adjustInvoiceTrack needs startNo and/or endNo");
    }
    return this.client.request<InvoiceTrack>(ENDPOINTS.invNumberAdjustNo(inID), {
      ...(change.startNo != null ? { startNo: String(change.startNo) } : {}),
      ...(change.endNo != null ? { endNo: String(change.endNo) } : {}),
    });
  }

  /**
   * 開啟/關閉字軌分段 — a closed track's numbers can't be issued; an exhausted or
   * expired track can't be re-opened.
   */
  async setInvoiceTrackStatus(inID: string | number, action: "OPEN" | "CLOSE"): Promise<{ inID: number; action: number }> {
    return this.client.request<{ inID: number; action: number }>(ENDPOINTS.invNumberClose(inID), {
      action: action === "CLOSE" ? 1 : 0,
    });
  }

  /**
   * 設定字軌印製發票的商標 (logo) by its `sgoID`. Pass `null` to clear it (printed
   * invoices then use no logo).
   */
  async setInvoiceTrackLogo(inID: string | number, sgoID: number | null): Promise<{ inID: number }> {
    return this.client.request<{ inID: number }>(ENDPOINTS.invNumberSetLogo(inID), { sgoID });
  }

  /**
   * 字軌分段 — split a (closed, 易發票-owned) track in two at `startNo`. The front
   * segment keeps everything but its 迄號 (→ `startNo`-1); the returned BACK
   * segment starts at `startNo` and copies the rest (override `bizType` / `memo`).
   */
  async splitInvoiceTrack(
    inID: string | number,
    args: { startNo: string | number; bizType?: 0 | 1 | 2; memo?: string },
  ): Promise<{ inID: number; startNo: number; bizType: number; memo: string | null }> {
    return this.client.request(ENDPOINTS.invNumberSplit(inID), {
      startNo: String(args.startNo),
      ...(args.bizType != null ? { bizType: args.bizType } : {}),
      ...(args.memo ? { memo: args.memo } : {}),
    });
  }

  /**
   * 異動分段字軌 — update `bizType` / `platform` / `memo`. An in-use track only
   * accepts `memo`; `platform` (1 易發票 / 100 其他) can be set ONCE and never
   * changed again.
   */
  async updateInvoiceTrack(
    inID: string | number,
    args: { bizType?: 0 | 1 | 2; platform?: 1 | 100; memo?: string },
  ): Promise<{ inID: number; bizType: number; platform: number | null; memo: string | null }> {
    return this.client.request(ENDPOINTS.invNumberUpdate(inID), {
      ...(args.bizType != null ? { bizType: args.bizType } : {}),
      ...(args.platform != null ? { platform: args.platform } : {}),
      ...(args.memo != null ? { memo: args.memo } : {}),
    });
  }

  /**
   * Resolve the internal invID: `providerOptions.invID` if given (fastest),
   * else look it up by invoice number via `invoice/list { invNo }`.
   */
  private async resolveInvID(
    invoiceNumber: string | undefined,
    providerOptions: Record<string, unknown> | undefined,
  ): Promise<string | number> {
    const invID = providerOptions?.invID;
    if (invID != null) return invID as string | number;
    if (!invoiceNumber) throw fail("either invoiceNumber or providerOptions.invID is required");
    const r = await this.client.request<{ list?: Array<{ invNo?: string; invID?: number }> }>(ENDPOINTS.list, {
      invNo: invoiceNumber,
      _ps: 1,
    });
    const found = (r.list ?? []).find((x) => x.invNo === invoiceNumber)?.invID;
    if (found == null) {
      throw new InvoiceError(`ezReceipt invoice ${invoiceNumber} not found`, {
        provider: "ezreceipt",
        code: InvoiceErrorCode.NOT_FOUND,
        rawMessage: "invoice not found",
      });
    }
    return found;
  }

  /**
   * Resolve the internal awID: `providerOptions.awID` if given, else look it up
   * by allowance number (awNo) via `allowance/list { awNo }`.
   */
  private async resolveAwID(
    allowanceNumber: string | undefined,
    providerOptions: Record<string, unknown> | undefined,
  ): Promise<string | number> {
    const awID = providerOptions?.awID;
    if (awID != null) return awID as string | number;
    if (!allowanceNumber) throw fail("either allowanceNumber or providerOptions.awID is required");
    const r = await this.client.request<{ list?: Array<{ awNo?: string; awID?: number }> }>(ENDPOINTS.allowanceList, {
      awNo: allowanceNumber,
      _ps: 1,
    });
    const found = (r.list ?? []).find((x) => x.awNo === allowanceNumber)?.awID;
    if (found == null) {
      throw new InvoiceError(`ezReceipt allowance ${allowanceNumber} not found`, {
        provider: "ezreceipt",
        code: InvoiceErrorCode.NOT_FOUND,
        rawMessage: "allowance not found",
      });
    }
    return found;
  }

  private buildIssueBody(input: IssueInvoiceInput): Record<string, unknown> {
    const opts = (input.providerOptions ?? {}) as Record<string, unknown>;
    const invoiceTime = input.date ? taipeiDateTime(input.date) : (opts.invoiceTime as string | undefined);
    const body: Record<string, unknown> = {
      prodList: input.items.map((item) => toProdItem(item, input)),
      // Record the caller's orderId as the order number (reconciliation); extend
      // with title/discount/xportFee via providerOptions.order.
      order: { orderNo: input.orderId, ...((opts.order as Record<string, unknown>) ?? {}) },
      trCode: opts.trCode ?? 0,
      msgType: opts.msgType ?? 1,
      ...(input.currency && input.currency !== "TWD" ? { currency: input.currency } : {}),
      ...(input.remark ? { remarks: input.remark } : {}),
      ...(opts.sendTo ? { sendTo: opts.sendTo } : {}),
      ...(opts.credit4 ? { credit4: opts.credit4 } : {}),
      // Self-assigned number / 註銷重開 (invNo + autoInvNo); else the platform picks.
      ...(opts.invNo ? { invNo: opts.invNo } : {}),
      ...(opts.autoInvNo != null ? { autoInvNo: opts.autoInvNo } : {}),
      ...(invoiceTime ? { invoiceTime } : {}),
      // Zero-rated / mixed-tax invoices REQUIRE zeroTaxReason (71–79) + isCustom (0/1).
      ...(opts.zeroTaxReason != null ? { zeroTaxReason: opts.zeroTaxReason } : {}),
      ...(opts.clearanceMark != null ? { isCustom: opts.clearanceMark } : {}),
      ...(opts.winvNo ? { winvNo: opts.winvNo } : {}),
      ...(opts.randNo ? { randNo: opts.randNo } : {}),
      ...(opts.accCode ? { accCode: opts.accCode } : {}),
    };
    // A donation (carrierType 5) can't carry a 統編 (1054), so it's exclusive.
    // Otherwise a carrier and a 統編 (issueTo) may COEXIST — e.g. a mobile-barcode
    // B2C invoice annotated with the buyer's 統編 for expense claims.
    if (input.donation) {
      body.carrier = { carrierType: 5, charity: input.donation.npoban };
    } else {
      if (input.carrier) {
        const carrierType = CARRIER_TYPE[input.carrier.type];
        body.carrier = { carrierType, carrierInfo: carrierInfo(input.carrier, input.buyer) };
        if (carrierType === 1) body.buyer = toBuyer(input.buyer, carrierInfo(input.carrier, input.buyer));
      }
      if (input.buyer.ubn) {
        body.issueTo = {
          nid: input.buyer.ubn,
          title: input.buyer.name,
          addr: input.buyer.address,
          ...(opts.isNonprofit != null ? { isNonprofit: opts.isNonprofit } : {}),
        };
      }
      if (!input.carrier && !input.buyer.ubn && this.config.validatePayload !== false) {
        throw fail("ezReceipt requires a buyer.ubn (B2B), a carrier, or a donation");
      }
    }
    return body;
  }
}

/** Map a unified item → ezReceipt prodList entry. */
function toProdItem(item: InvoiceItem, input: IssueInvoiceInput): Record<string, unknown> {
  return {
    title: item.description,
    qty: item.quantity,
    sales: item.unitPrice,
    incTax: input.priceMode === "TAX_INCLUSIVE",
    taxType: ezreceiptTaxType(item.taxType ?? input.taxType),
    ...(item.unit ? { unit: item.unit } : {}),
    ...(item.remark ? { remarks: item.remark } : {}),
    // A negative-priced line must be flagged as a discount (mcType 100); otherwise
    // the API rejects the sub-zero price (1057/1062).
    ...(item.unitPrice < 0 || item.amount < 0 ? { mcType: 100 } : {}),
  };
}

/** The carrierInfo for a unified carrier (member id / barcode / cert number). */
function carrierInfo(carrier: Carrier, buyer: Buyer): string | undefined {
  if (carrier.type === "MEMBER") return carrier.code ?? buyer.email ?? buyer.phone;
  return carrier.code;
}

function toBuyer(buyer: Buyer, accName: string | undefined): Record<string, unknown> {
  return {
    accName: accName ?? buyer.email ?? buyer.phone,
    name: buyer.name ?? "消費者",
    ...(buyer.address ? { addr: buyer.address } : {}),
    ...(buyer.phone ? { phone: buyer.phone } : {}),
  };
}

/** Create an ezReceipt {@link InvoiceProvider}. */
export function createEzreceiptProvider(config: EzreceiptConfig): EzreceiptProvider {
  return new EzreceiptProvider(config);
}

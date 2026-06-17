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
  /** 是否已關閉 (0/1). */
  isClosed: number;
  /** 字軌所屬平台 (1 易發票 / 100 其他 / null 未設定). */
  platform: number | null;
}

/** Filters for {@link EzreceiptProvider.listInvoiceTracks}. */
export interface ListInvoiceTracksInput {
  /** 期別 YYYYMM. Defaults to the current period. */
  period?: string;
  /** 7 一般稅額 / 8 特種稅額. */
  invType?: 7 | 8;
  /** 0 不限 / 1 無統編 / 2 有統編. */
  bizType?: 0 | 1 | 2;
  /** Only the currently-open 字軌 (isActive=1). */
  activeOnly?: boolean;
  /** Page number (1-based). */
  page?: number;
  /** Page size (default 10). */
  pageSize?: number;
}

/** Parse an ezReceipt datetime ("YYYY-MM-DD HH:mm:ss", Asia/Taipei) → Date. */
function parseDate(value: unknown): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(value ?? "").trim());
  if (!m) return new Date();
  const [, y, mo, d, hh, mi, ss] = m;
  return new Date(`${y}-${mo}-${d}T${hh}:${mi}:${ss}+08:00`);
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
      ...(input.activeOnly ? { isActive: 1 } : {}),
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
    const body: Record<string, unknown> = {
      prodList: input.items.map((item) => toProdItem(item, input)),
      trCode: opts.trCode ?? 0,
      msgType: opts.msgType ?? 1,
      ...(input.currency && input.currency !== "TWD" ? { currency: input.currency } : {}),
      ...(input.remark ? { remarks: input.remark } : {}),
    };
    if (input.buyer.ubn) {
      body.issueTo = { nid: input.buyer.ubn, title: input.buyer.name, addr: input.buyer.address };
    } else if (input.donation) {
      body.carrier = { carrierType: 5, charity: input.donation.npoban };
    } else if (input.carrier) {
      const carrierType = CARRIER_TYPE[input.carrier.type];
      body.carrier = { carrierType, carrierInfo: carrierInfo(input.carrier, input.buyer) };
      if (carrierType === 1) body.buyer = toBuyer(input.buyer, carrierInfo(input.carrier, input.buyer));
    } else if (this.config.validatePayload !== false) {
      throw fail("ezReceipt requires a buyer.ubn (B2B), a carrier, or a donation");
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

import {
  Capability,
  InvoiceError,
  InvoiceErrorCode,
  InvoiceStatus,
  allowanceInputSchema,
  parseInput,
  parseTaipeiDate,
  queryInvoiceInputSchema,
  taipeiDateTime,
  voidAllowanceInputSchema,
  voidInvoiceInputSchema,
  type AllowanceInput,
  type AllowanceResult,
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
import { EzreceiptClient } from "./client.js";
import { type EzreceiptConfig } from "./config.js";
import { ENDPOINTS } from "./endpoints.js";
import { CARRIER_TYPE, carrierInfo, toBuyer, toProdItem } from "./mapping.js";
import type {
  AllowanceQuotaItem,
  BusinessInfo,
  InvoicePrintInfo,
  InvoiceTrack,
  ListInvoicesInput,
  ListInvoiceTracksInput,
} from "./types.js";

const fail = (message: string, code = InvoiceErrorCode.VALIDATION) =>
  new InvoiceError(message, { provider: "ezreceipt", code, rawMessage: message });

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
    Capability.CARRIER_VALIDATION,
  ]);

  private readonly client: EzreceiptClient;

  constructor(private readonly config: EzreceiptConfig) {
    this.client = new EzreceiptClient(config);
  }

  /** 開立發票 — all-in-one (creates the order from `prodList` + issues). */
  async issue(input: IssueInvoiceInput): Promise<IssueInvoiceResult> {
    // NB: issue intentionally does NOT run the shared issueInvoiceInputSchema —
    // ezReceipt accepts a member id via `buyer.email` (carrierInfo fallback), so a
    // non-email value is valid here and the schema's `.email()` check would reject
    // it. void / allowance / voidAllowance / query DO use the shared schemas.
    const r = await this.client.request<Record<string, unknown>>(
      ENDPOINTS.issue,
      this.buildIssueBody(input),
    );
    return {
      invoiceNumber: String(r.invNo ?? ""),
      invoiceDate: parseTaipeiDate(r.createTime ?? r.invoiceTime),
      randomCode: String(r.randNo ?? ""),
      orderId: input.orderId,
      totalAmount: input.amount.totalAmount,
      status: InvoiceStatus.ISSUED,
      raw: r,
    };
  }

  /** 作廢發票. `reason` ≤ 20 chars. Needs the invID (via `providerOptions.invID`). */
  async void(input: VoidInvoiceInput): Promise<VoidInvoiceResult> {
    parseInput(voidInvoiceInputSchema, input, "ezreceipt");
    if (this.config.validatePayload !== false && (input.reason ?? "").length > 20) {
      throw fail("作廢原因 (voidReason) must be ≤20 chars");
    }
    const invID = await this.resolveInvID(input.invoiceNumber, input.providerOptions);
    // voidReason is REQUIRED (126) — the unified type already mandates it.
    // providerOptions.voidOrder also voids the underlying order.
    const r = await this.client.request(ENDPOINTS.void(invID), {
      voidReason: input.reason,
      ...((input.providerOptions as { voidOrder?: boolean } | undefined)?.voidOrder
        ? { voidOrder: true }
        : {}),
    });
    return { invoiceNumber: input.invoiceNumber, status: InvoiceStatus.VOIDED, raw: r };
  }

  /**
   * 開立折讓證明單. Credits invoice lines by their `soiID` (resolved from the
   * invoice unless supplied). `amount` is the tax-exclusive credit per line.
   */
  async allowance(input: AllowanceInput): Promise<AllowanceResult> {
    parseInput(allowanceInputSchema, input, "ezreceipt");
    const opts = (input.providerOptions ?? {}) as {
      invID?: number;
      itemTax?: number[];
      allowTime?: string;
      needConfirm?: boolean;
    };
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
      allowanceDate: parseTaipeiDate(r.createTime),
      totalAmount: input.amount.totalAmount,
      raw: r,
    };
  }

  /**
   * 作廢折讓. Keyed by the allowance's internal `awID` — pass it via
   * `providerOptions.awID` (from the allowance result's `raw.awID`).
   */
  async voidAllowance(input: VoidAllowanceInput): Promise<VoidAllowanceResult> {
    parseInput(voidAllowanceInputSchema, input, "ezreceipt");
    if (this.config.validatePayload !== false && (input.reason ?? "").length > 20) {
      throw fail("作廢原因 (voidReason) must be ≤20 chars");
    }
    const awID = await this.resolveAwID(input.allowanceNumber, input.providerOptions);
    const r = await this.client.request(ENDPOINTS.allowanceVoid(awID), {
      voidReason: input.reason ?? "作廢折讓",
    });
    return { allowanceNumber: input.allowanceNumber, raw: r };
  }

  /** 查詢發票. By the internal `invID` (`providerOptions.invID`) or invoice number. */
  async query(input: QueryInvoiceInput): Promise<QueryInvoiceResult> {
    parseInput(queryInvoiceInputSchema, input, "ezreceipt");
    const invID = await this.resolveInvID(input.invoiceNumber, input.providerOptions);
    const r = await this.client.request<Record<string, unknown>>(ENDPOINTS.view(invID), {});
    const sales = Number(r.salesAmount ?? 0);
    const tax = Number(r.taxAmount ?? 0);
    const buyer = (r.buyer ?? {}) as Record<string, unknown>;
    return {
      invoiceNumber: String(r.invNo ?? ""),
      invoiceDate: parseTaipeiDate(r.invoiceTime),
      randomCode: String(r.randNo ?? ""),
      orderId: r.orderNo ? String(r.orderNo) : undefined,
      // procState: 11 已開立, 13 已作廢, 30 已註銷 — both 13 and 30 are cancelled.
      status: ["13", "30"].includes(String(r.procState))
        ? InvoiceStatus.VOIDED
        : InvoiceStatus.ISSUED,
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
  async listInvoices(
    input: ListInvoicesInput = {},
  ): Promise<{ entries: number; list: Record<string, unknown>[] }> {
    const r = await this.client.request<{ entries?: number; list?: Record<string, unknown>[] }>(
      ENDPOINTS.list,
      {
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
      },
    );
    return { entries: Number(r.entries ?? 0), list: r.list ?? [] };
  }

  /**
   * 註銷發票 — distinct from {@link EzreceiptProvider.void} (作廢): a 註銷 can run
   * when the invoice is 已開立 / 已作廢 / 已折讓作廢 and is what "void + reissue"
   * builds on. B2B invoices CANNOT be revoked via the value-added centre (a 財政部
   * limitation) — do those on the 財政部 platform.
   */
  async revokeInvoice(
    invoiceNumber: string,
    reason: string,
    opts: { revokeTime?: string; providerOptions?: Record<string, unknown> } = {},
  ): Promise<{ invID: number; revokeReason: string; revokeTime: string }> {
    if (this.config.validatePayload !== false && reason.length > 20) {
      throw fail("註銷原因 (revokeReason) must be ≤20 chars");
    }
    const invID = await this.resolveInvID(invoiceNumber, opts.providerOptions);
    return this.client.request(ENDPOINTS.invoiceRevoke(invID), {
      revokeReason: reason,
      ...(opts.revokeTime ? { revokeTime: opts.revokeTime } : {}),
    });
  }

  /**
   * 確認交換發票 — for 交換 (msgType=2) invoices only: the buyer confirms an issue
   * (`"ISSUE"`, with an optional buyerRemark 1-4) or a void (`"VOID"`), or the
   * seller confirms a return (`"RETURN"`, which auto-voids the invoice). Requires
   * the account's B2B-exchange feature; resolves invID from the invoice number.
   */
  async replyInvoice(
    invoiceNumber: string,
    action: "ISSUE" | "VOID" | "RETURN",
    opts: { buyerRemark?: 1 | 2 | 3 | 4; providerOptions?: Record<string, unknown> } = {},
  ): Promise<{ invID: number; action: number }> {
    const invID = await this.resolveInvID(invoiceNumber, opts.providerOptions);
    const code = action === "ISSUE" ? 1 : action === "VOID" ? 2 : 3;
    return this.client.request(ENDPOINTS.invoiceReply(invID), {
      action: code,
      ...(opts.buyerRemark != null ? { buyerRemark: opts.buyerRemark } : {}),
    });
  }

  /**
   * 各品項尚餘可折讓額度 — an invoice can be credited multiple times; this returns
   * each line's remaining creditable quantity / amount (untaxed) / tax. Useful
   * for validating or building a partial allowance.
   */
  async getAllowanceQuota(
    invoiceNumber: string,
    providerOptions?: Record<string, unknown>,
  ): Promise<AllowanceQuotaItem[]> {
    const invID = await this.resolveInvID(invoiceNumber, providerOptions);
    const r = await this.client.request<{ itemList?: AllowanceQuotaItem[] }>(
      ENDPOINTS.allowQuota(invID),
      {},
    );
    return r.itemList ?? [];
  }

  /**
   * 排程折讓事件 email 通知 — queue notifications for the given allowance ids on a
   * 折讓 event: CREATE(6) / CONFIRM(7, 交換 only) / VOID(8) / VOID_CONFIRM(9, 交換
   * only). `forceToBuyer` ignores the user's per-event "notify buyer" setting.
   */
  async notifyAllowance(
    awIDs: Array<string | number>,
    event: "CREATE" | "CONFIRM" | "VOID" | "VOID_CONFIRM",
    opts: { forceToBuyer?: boolean } = {},
  ): Promise<void> {
    const eventType = { CREATE: 6, CONFIRM: 7, VOID: 8, VOID_CONFIRM: 9 }[event];
    await this.client.request(ENDPOINTS.notificationAllowance, {
      awList: awIDs,
      eventType,
      ...(opts.forceToBuyer ? { forceToBuyer: true } : {}),
    });
  }

  /**
   * 取得列印發票所需的資料 — barcode, both QR codes, logo/titles and line items, so
   * a caller can render its own paper proof (消費證明聯). JSON, not a file.
   */
  async getInvoicePrintInfo(
    invoiceNumber: string,
    providerOptions?: Record<string, unknown>,
  ): Promise<InvoicePrintInfo> {
    const invID = await this.resolveInvID(invoiceNumber, providerOptions);
    return this.client.request<InvoicePrintInfo>(ENDPOINTS.proofInvInfo(invID), {});
  }

  /**
   * 檢查手機條碼 — validate a mobile-barcode carrier against the 財政部 platform
   * (format `/` + 7 alphanumerics). Returns whether it exists/is registered.
   */
  async checkMobileCode(mobileCode: string): Promise<boolean> {
    const r = await this.client.request<{ isExist: number }>(ENDPOINTS.openTaxCheckMobileCode, {
      mobileCode,
    });
    return r.isExist === 1;
  }

  /** 檢查捐贈碼 — validate a 捐贈碼 (3–7 digits) against the 財政部 platform. */
  async checkCharity(donate: string): Promise<boolean> {
    const r = await this.client.request<{ isExist: number }>(ENDPOINTS.openTaxCheckCharity, {
      donate,
    });
    return r.isExist === 1;
  }

  /**
   * 以統編查詢機關 — look up public business/organisation info by 統編. Optionally
   * filter by `compType` (1 稅籍登記 / 2 非營利團體 / 3 學校).
   */
  async lookupBusiness(nid: string, opts: { compType?: 1 | 2 | 3 } = {}): Promise<BusinessInfo[]> {
    const r = await this.client.request<{ list?: BusinessInfo[] }>(
      ENDPOINTS.openTaxGuidList(nid),
      opts.compType != null ? { compType: opts.compType } : {},
    );
    return r.list ?? [];
  }

  /**
   * 取得發票列印檔 — the invoice proof PDF bytes (or a ZIP when `zipped`) for the
   * given invoice numbers. `isCopy` marks the 證明聯 as 副本; `format` 1/2/11/12/21/
   * 22/25; `device` for thermal printers (TM-T82III/TM-m10/TM-P20/mC-Print3).
   * Binary response → returns the raw bytes + content-type.
   */
  async printInvoice(
    invoiceNumbers: string[],
    opts: {
      isCopy?: boolean;
      zipped?: boolean;
      format?: number;
      printTime?: string;
      device?: string;
    } = {},
  ): Promise<{ contentType: string; data: Uint8Array }> {
    const invList = await Promise.all(invoiceNumbers.map((n) => this.resolveInvID(n)));
    return this.client.requestFile(ENDPOINTS.proofInvPrint, {
      invList,
      ...(opts.isCopy ? { isCopy: true } : {}),
      ...(opts.zipped ? { isZipped: true } : {}),
      ...(opts.format != null ? { format: opts.format } : {}),
      ...(opts.printTime ? { printTime: opts.printTime } : {}),
      ...(opts.device ? { device: opts.device } : {}),
    });
  }

  /**
   * 取得折讓單列印檔 — returns the allowance PDF bytes (or a ZIP when `zipped`).
   * `format`: 1 熱感紙 / 2 A4. The response is binary, so this returns the raw
   * bytes + content-type rather than a parsed object.
   */
  async printAllowance(
    awIDs: Array<string | number>,
    opts: { zipped?: boolean; format?: 1 | 2 } = {},
  ): Promise<{ contentType: string; data: Uint8Array }> {
    return this.client.requestFile(ENDPOINTS.proofAwPrint, {
      awList: awIDs,
      ...(opts.zipped ? { isZipped: true } : {}),
      ...(opts.format != null ? { format: opts.format } : {}),
    });
  }

  /**
   * 排程發票事件 email 通知 — queue notifications for the given invoice ids on an
   * invoice event: ISSUE(1) / CONFIRM(2, 交換) / VOID(4) / VOID_CONFIRM(5, 交換) /
   * WON(20 中獎) / REQUEST(30 索取). `format` (print style) and `action` (1 single /
   * 2 packed) apply only when a proof is attached (ISSUE/CONFIRM).
   */
  async notifyInvoice(
    invIDs: Array<string | number>,
    event: "ISSUE" | "CONFIRM" | "VOID" | "VOID_CONFIRM" | "WON" | "REQUEST",
    opts: { forceToBuyer?: boolean; format?: number; action?: 1 | 2 } = {},
  ): Promise<void> {
    const eventType = { ISSUE: 1, CONFIRM: 2, VOID: 4, VOID_CONFIRM: 5, WON: 20, REQUEST: 30 }[
      event
    ];
    await this.client.request(ENDPOINTS.notificationInvoice, {
      invList: invIDs,
      eventType,
      ...(opts.forceToBuyer ? { forceToBuyer: true } : {}),
      ...(opts.format != null ? { format: opts.format } : {}),
      ...(opts.action != null ? { action: opts.action } : {}),
    });
  }

  // --- 字軌 management (extension — beyond the unified InvoiceProvider) -------

  /**
   * 字軌分段清單 — list this merchant's invoice-number tracks. (字軌 配號 itself is
   * backend-only; the API can only manage existing tracks.)
   */
  async listInvoiceTracks(input: ListInvoiceTracksInput = {}): Promise<InvoiceTrack[]> {
    const r = await this.client.request<{ list?: InvoiceTrack[] }>(
      ENDPOINTS.invNumberList(this.config.stID),
      {
        ...(input.period ? { period: input.period } : {}),
        ...(input.invType ? { invType: input.invType } : {}),
        ...(input.bizType != null ? { bizType: input.bizType } : {}),
        ...(input.forceBiz ? { forceBiz: true } : {}),
        ...(input.activeOnly ? { isActive: 1 } : {}),
        ...(input.platform ? { platform: input.platform } : {}),
        ...(input.order ? { dspOrder: input.order === "ASC" ? 2 : 1 } : {}),
        ...(input.page ? { _pn: input.page } : {}),
        ...(input.pageSize ? { _ps: input.pageSize } : {}),
      },
    );
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
   * 設為預設字軌 — make a track the default for 有統編 (`forGUINo: true`) or 無統編
   * (`false`) invoices. Fails if the track is already pinned to the opposite use
   * (1320/1321).
   */
  async setDefaultTrack(
    inID: string | number,
    opts: { forGUINo?: boolean } = {},
  ): Promise<{ inID: number }> {
    return this.client.request<{ inID: number }>(
      ENDPOINTS.settingsDefaultGUINo(inID),
      opts.forGUINo != null ? { isForGUINo: opts.forGUINo } : {},
    );
  }

  /** 商標識別碼清單 — list this store's uploaded logo ids (sgoID). */
  async listLogos(): Promise<number[]> {
    const r = await this.client.request<{ list?: Array<{ sgoID: number }> }>(
      ENDPOINTS.settingsListLogo,
      {},
    );
    return (r.list ?? []).map((x) => x.sgoID);
  }

  /**
   * 上傳商標圖檔 — store a logo image (printed as the invoice header). Pass
   * `sgoID` to replace an existing logo, omit it to add a new one.
   *
   * NOTE: live-unverified — the TEST environment returns `-100 系統內部錯誤` for
   * this endpoint regardless of a valid multipart PNG; the wire format here is
   * the documented one (`files` field) and is covered by MSW tests.
   */
  async uploadLogo(
    image: { data: Uint8Array | ArrayBuffer; filename?: string; contentType?: string },
    opts: { sgoID?: number } = {},
  ): Promise<{ sgoID: number }> {
    return this.client.requestUpload<{ sgoID: number }>(
      ENDPOINTS.settingsUploadLogo(opts.sgoID),
      () => {
        const form = new FormData();
        form.append(
          "files",
          new Blob([image.data], { type: image.contentType ?? "application/octet-stream" }),
          image.filename ?? "logo.png",
        );
        return form;
      },
    );
  }

  /**
   * 讀取商標圖檔 — the logo image bytes (binary). Optional `w`/`h` resize, or
   * `maxw`/`maxh` to bound the size while keeping the aspect ratio.
   */
  async viewLogo(
    sgoID: string | number,
    opts: { w?: number; h?: number; maxw?: number; maxh?: number } = {},
  ): Promise<{ contentType: string; data: Uint8Array }> {
    return this.client.requestFile(ENDPOINTS.settingsViewLogo(sgoID), {
      ...(opts.w != null ? { w: opts.w } : {}),
      ...(opts.h != null ? { h: opts.h } : {}),
      ...(opts.maxw != null ? { maxw: opts.maxw } : {}),
      ...(opts.maxh != null ? { maxh: opts.maxh } : {}),
    });
  }

  /**
   * 開啟/關閉字軌分段 — a closed track's numbers can't be issued; an exhausted or
   * expired track can't be re-opened.
   */
  async setInvoiceTrackStatus(
    inID: string | number,
    action: "OPEN" | "CLOSE",
  ): Promise<{ inID: number; action: number }> {
    return this.client.request<{ inID: number; action: number }>(ENDPOINTS.invNumberClose(inID), {
      action: action === "CLOSE" ? 1 : 0,
    });
  }

  /**
   * 設定字軌印製發票的商標 (logo) by its `sgoID`. Pass `null` to clear it (printed
   * invoices then use no logo).
   */
  async setInvoiceTrackLogo(
    inID: string | number,
    sgoID: number | null,
  ): Promise<{ inID: number }> {
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
    providerOptions?: Record<string, unknown>,
  ): Promise<string | number> {
    const invID = providerOptions?.invID;
    if (invID != null) return invID as string | number;
    if (!invoiceNumber) throw fail("either invoiceNumber or providerOptions.invID is required");
    const r = await this.client.request<{ list?: Array<{ invNo?: string; invID?: number }> }>(
      ENDPOINTS.list,
      {
        invNo: invoiceNumber,
        _ps: 1,
      },
    );
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
    const r = await this.client.request<{ list?: Array<{ awNo?: string; awID?: number }> }>(
      ENDPOINTS.allowanceList,
      {
        awNo: allowanceNumber,
        _ps: 1,
      },
    );
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
    const invoiceTime = input.date
      ? taipeiDateTime(input.date)
      : (opts.invoiceTime as string | undefined);
    const body: Record<string, unknown> = {
      prodList: input.items.map((item) => toProdItem(item, input)),
      // Record the caller's orderId as the order number (reconciliation); extend
      // with title/discount/xportFee via providerOptions.order.
      order: { orderNo: input.orderId, ...(opts.order as Record<string, unknown>) },
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
        if (carrierType === 1)
          body.buyer = toBuyer(input.buyer, carrierInfo(input.carrier, input.buyer));
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

/** Create an ezReceipt {@link InvoiceProvider}. */
export function createEzreceiptProvider(config: EzreceiptConfig): EzreceiptProvider {
  return new EzreceiptProvider(config);
}

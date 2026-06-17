import {
  type AllowanceInput,
  type AllowanceResult,
  type Buyer,
  Capability,
  type Carrier,
  deriveCategory,
  InvoiceError,
  InvoiceErrorCode,
  isValidMobileBarcode,
  type InvoiceItem,
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
import {
  type AmegoProductTaxType,
  computeAmegoAmounts,
} from "./amounts.js";
import {
  type AmegoResponse,
  type AmegoTimeResponse,
  amegoRequest,
  fetchServerTime,
} from "./client.js";
import type { AmegoConfig } from "./config.js";
import { ENDPOINTS } from "./endpoints.js";
import {
  assertValidAllowancePayload,
  assertValidCustomIssuePayload,
  assertValidIssuePayload,
  isValidUbn,
} from "./validation.js";

/** Amego/MIG carrier type codes (member carrier is the literal `amego`). */
const CARRIER_TYPE: Record<Carrier["type"], string> = {
  MOBILE_BARCODE: "3J0002",
  CITIZEN_CERTIFICATE: "CQ0001",
  MEMBER: "amego",
};

export class AmegoProvider implements InvoiceProvider {
  readonly name = "amego";
  readonly capabilities: ReadonlySet<Capability> = new Set([
    Capability.ISSUE,
    Capability.VOID,
    Capability.ALLOWANCE,
    Capability.VOID_ALLOWANCE,
    Capability.QUERY,
    Capability.B2B,
    Capability.MIXED_TAX,
    Capability.QUERY_BY_ORDER_ID,
  ]);

  constructor(private readonly config: AmegoConfig) {}

  /**
   * Escape hatch: call any Amego endpoint directly with a raw payload. Omit
   * `data` for no-data endpoints (sends an empty data string, as Amego expects).
   */
  raw(path: string, data?: unknown): Promise<AmegoResponse> {
    return amegoRequest(this.config, path, data);
  }

  // -------------------------------------------------------------------------
  // Unified InvoiceProvider
  // -------------------------------------------------------------------------

  async issue(input: IssueInvoiceInput): Promise<IssueInvoiceResult> {
    const parsed = issueInvoiceInputSchema.parse(input);
    const category = parsed.category ?? deriveCategory(parsed.buyer);
    const priceExclusive = parsed.priceMode === "TAX_EXCLUSIVE";

    const lines = parsed.items.map((item) => ({
      amount: item.amount,
      taxType: resolveItemTaxType(item, parsed.taxType),
    }));
    const amounts = computeAmegoAmounts({
      lines,
      buyerHasUbn: category === "B2B",
      taxRate: parsed.taxRate,
      priceExclusive,
    });

    const data: Record<string, unknown> = {
      OrderId: parsed.orderId,
      BuyerIdentifier: parsed.buyer.ubn ?? "0000000000",
      BuyerName: parsed.buyer.name ?? (category === "B2B" ? "" : "消費者"),
      BuyerAddress: parsed.buyer.address,
      BuyerTelephoneNumber: parsed.buyer.phone,
      BuyerEmailAddress: parsed.buyer.email,
      ...carrierFields(parsed.carrier),
      NPOBAN: parsed.donation?.npoban,
      ...amounts,
      // Foreign-currency annotation; statutory amounts above stay TWD.
      ...(parsed.currency && parsed.currency !== "TWD" ? { Currency: parsed.currency } : {}),
      ...(parsed.exchangeRate != null ? { ExchangeRate: parsed.exchangeRate } : {}),
      DetailVat: priceExclusive ? 0 : 1,
      ProductItem: parsed.items.map((item) => ({
        Description: item.description,
        Quantity: item.quantity,
        UnitPrice: item.unitPrice,
        Amount: item.amount,
        Unit: item.unit,
        Remark: item.remark,
        TaxType: resolveItemTaxType(item, parsed.taxType),
      })),
      ...(parsed.providerOptions ?? {}),
    };

    if (this.config.validatePayload !== false) assertValidIssuePayload(data);

    const res = await amegoRequest(this.config, ENDPOINTS.issue, data);
    return {
      invoiceNumber: String(res.invoice_number ?? ""),
      invoiceDate: fromUnix(res.invoice_time),
      randomCode: String(res.random_number ?? ""),
      orderId: parsed.orderId,
      totalAmount: amounts.TotalAmount,
      status: InvoiceStatus.ISSUED,
      raw: res,
    };
  }

  async void(input: VoidInvoiceInput): Promise<VoidInvoiceResult> {
    const parsed = voidInvoiceInputSchema.parse(input);
    // f0501 takes an ARRAY of { CancelInvoiceNumber }.
    const res = await amegoRequest(this.config, ENDPOINTS.void, [
      { CancelInvoiceNumber: parsed.invoiceNumber },
    ]);
    return {
      invoiceNumber: parsed.invoiceNumber,
      status: InvoiceStatus.VOIDED,
      raw: res,
    };
  }

  async allowance(input: AllowanceInput): Promise<AllowanceResult> {
    const parsed = allowanceInputSchema.parse(input);
    const opts = (parsed.providerOptions ?? {}) as Record<string, unknown>;
    const taxRate = typeof opts.taxRate === "number" ? opts.taxRate : 0.05;

    // Original invoice date (YYYYMMDD) is required by Amego; accept it via
    // providerOptions, otherwise resolve it from invoice_query.
    const originalDate =
      (opts.originalInvoiceDate as number | string | undefined) ??
      (await this.resolveInvoiceDate(parsed.invoiceNumber));
    const allowanceDate = (opts.allowanceDate as number | string) ?? originalDate;

    const buyer = (opts.buyer as Buyer | undefined) ?? {};

    // g0401 takes an ARRAY; amounts are tax-EXCLUSIVE with a per-line Tax.
    const data = [
      {
        AllowanceNumber: parsed.allowanceId,
        AllowanceDate: allowanceDate,
        AllowanceType: (opts.allowanceType as string) ?? "2",
        BuyerIdentifier: buyer.ubn ?? "0000000000",
        BuyerName: buyer.name ?? "消費者",
        BuyerEmailAddress: buyer.email,
        ProductItem: parsed.items.map((item) => {
          const tt = resolveItemTaxType(item, "TAXABLE");
          return {
            OriginalInvoiceNumber: parsed.invoiceNumber,
            OriginalInvoiceDate: originalDate,
            OriginalDescription: item.description,
            Quantity: item.quantity,
            UnitPrice: item.unitPrice,
            Amount: item.amount,
            Tax: amegoLineTax(item.amount, tt, taxRate),
            TaxType: tt,
          };
        }),
        TaxAmount: parsed.amount.taxAmount,
        TotalAmount: parsed.amount.salesAmount, // 未稅 合計
        ...(opts.extra as Record<string, unknown> | undefined),
      },
    ];

    if (this.config.validatePayload !== false) assertValidAllowancePayload(data[0]);

    const res = await amegoRequest(this.config, ENDPOINTS.allowance, data);
    return {
      // g0401 returns no number; the supplied AllowanceNumber is the id.
      allowanceNumber: parsed.allowanceId,
      invoiceNumber: parsed.invoiceNumber,
      allowanceDate: fromYmd(allowanceDate),
      totalAmount: parsed.amount.totalAmount,
      raw: res,
    };
  }

  async voidAllowance(input: VoidAllowanceInput): Promise<VoidAllowanceResult> {
    const parsed = voidAllowanceInputSchema.parse(input);
    // g0501 takes an ARRAY of { CancelAllowanceNumber }.
    const res = await amegoRequest(this.config, ENDPOINTS.voidAllowance, [
      { CancelAllowanceNumber: parsed.allowanceNumber },
    ]);
    return { allowanceNumber: parsed.allowanceNumber, raw: res };
  }

  async query(input: QueryInvoiceInput): Promise<QueryInvoiceResult> {
    const parsed = queryInvoiceInputSchema.parse(input);
    // invoice_query supports both invoice-number and order-id lookups via the
    // `type` discriminator (verified live).
    const payload = parsed.invoiceNumber
      ? { type: "invoice", invoice_number: parsed.invoiceNumber }
      : { type: "order", order_id: parsed.orderId };
    const res = await amegoRequest(this.config, ENDPOINTS.invoiceQuery, payload);
    const d = (res.data ?? {}) as Record<string, unknown>;
    return {
      invoiceNumber: String(d.invoice_number ?? parsed.invoiceNumber),
      invoiceDate: fromYmd(d.invoice_date),
      randomCode: String(d.random_number ?? ""),
      orderId: d.order_id ? String(d.order_id) : parsed.orderId,
      status: deriveStatus(d),
      amount: {
        salesAmount: Number(d.sales_amount ?? 0),
        taxAmount: Number(d.tax_amount ?? 0),
        totalAmount: Number(d.total_amount ?? 0),
      },
      buyer: {
        name: d.buyer_name ? String(d.buyer_name) : undefined,
        ubn:
          d.buyer_identifier && d.buyer_identifier !== "0000000000"
            ? String(d.buyer_identifier)
            : undefined,
        email: d.buyer_email_address ? String(d.buyer_email_address) : undefined,
      },
      items: Array.isArray(d.product_item)
        ? (d.product_item as Array<Record<string, unknown>>).map((it) => ({
            description: String(it.description ?? ""),
            quantity: Number(it.quantity ?? 0),
            unitPrice: Number(it.unit_price ?? 0),
            amount: Number(it.amount ?? 0),
            unit: it.unit ? String(it.unit) : undefined,
            taxType: fromAmegoTaxType(it.tax_type),
            remark: it.remark ? String(it.remark) : undefined,
          }))
        : [],
      raw: res,
    };
  }

  /** Fetch an invoice's 開立日期 (YYYYMMDD) — used to fill allowance fields. */
  private async resolveInvoiceDate(invoiceNumber: string): Promise<number> {
    const res = await amegoRequest(this.config, ENDPOINTS.invoiceQuery, {
      type: "invoice",
      invoice_number: invoiceNumber,
    });
    const d = (res.data ?? {}) as Record<string, unknown>;
    return Number(d.invoice_date ?? 0);
  }

  // -------------------------------------------------------------------------
  // Amego-specific extensions (verified field shapes; not cross-provider)
  // -------------------------------------------------------------------------

  /** 發票 management endpoints. */
  readonly invoice = {
    /**
     * 發票查詢 — look up by `invoiceNumber` or `orderId` (snake_case + `type`
     * discriminator). Returns the full nested `data` (incl. product_item[],
     * wait[], allowance[]).
     */
    query: (opts: { invoiceNumber?: string; orderId?: string }) =>
      this.raw(
        ENDPOINTS.invoiceQuery,
        opts.orderId
          ? { type: "order", order_id: opts.orderId }
          : { type: "invoice", invoice_number: opts.invoiceNumber },
      ),
    /**
     * 發票列表. Fields are `date_select` + `date_start`/`date_end` (numeric
     * YYYYMMDD) + `limit` (20–500) + `page`; response paginates as
     * `page_total`/`page_now`/`data_total` (verified live).
     */
    list: (opts: {
      startDate?: string | number;
      endDate?: string | number;
      page?: number;
      limit?: number;
      /** 1: 發票日期 (default), 2: 建立日期. */
      dateSelect?: 1 | 2;
    } = {}) =>
      this.raw(ENDPOINTS.invoiceList, {
        date_select: opts.dateSelect ?? 1,
        ...(opts.startDate != null ? { date_start: toYmdNumber(opts.startDate) } : {}),
        ...(opts.endDate != null ? { date_end: toYmdNumber(opts.endDate) } : {}),
        limit: opts.limit ?? 20,
        page: opts.page ?? 1,
      }),
    /**
     * 發票列印 — generate a printer-format string. Look up by `invoiceNumber` or
     * `orderId` (snake_case + `type` discriminator; verified live). Returns
     * `data.base64_data` (XML for printerType 1, ESC/POS for ≥2). NOTE: a $0
     * invoice cannot be printed.
     */
    print: (opts: {
      invoiceNumber?: string;
      orderId?: string;
      printerType: number;
      printerLang?: 1 | 2 | 3;
      /** 1 發票正本 / 2 發票補印 / 3 單印明細. */
      printInvoiceType?: 1 | 2 | 3;
      /** 0 不列印明細 / 1 明細(裁切, default) / 2 明細(不裁切). */
      printInvoiceDetail?: 0 | 1 | 2;
    }) =>
      this.raw(ENDPOINTS.invoicePrint, {
        ...(opts.orderId
          ? { type: "order", order_id: opts.orderId }
          : { type: "invoice", invoice_number: opts.invoiceNumber }),
        printer_type: opts.printerType,
        ...(opts.printerLang !== undefined ? { printer_lang: opts.printerLang } : {}),
        ...(opts.printInvoiceType !== undefined ? { print_invoice_type: opts.printInvoiceType } : {}),
        ...(opts.printInvoiceDetail !== undefined ? { print_invoice_detail: opts.printInvoiceDetail } : {}),
      }),
    /**
     * 發票檔案 (PDF) — look up by `invoiceNumber` or `orderId`. Returns
     * `data.file_url` (valid 10 minutes). `downloadStyle` (有統編): 0 A4整張 /
     * 1 A4(地址+A5) / 2 A4(A5x2) / 3 A5 / 5 QRcode_A4 (no-統編 supports only 0).
     * Carrier invoices can only be downloaded after winning the lottery.
     */
    file: (opts: {
      invoiceNumber?: string;
      orderId?: string;
      downloadStyle?: 0 | 1 | 2 | 3 | 5;
    }) =>
      this.raw(ENDPOINTS.invoiceFile, {
        ...(opts.orderId
          ? { type: "order", order_id: opts.orderId }
          : { type: "invoice", invoice_number: opts.invoiceNumber }),
        download_style: opts.downloadStyle ?? 0,
      }),
    /** 發票狀態 — ARRAY payload, nested `data[]`. */
    status: (invoiceNumbers: string[]) =>
      this.raw(ENDPOINTS.invoiceStatus, invoiceNumbers.map((InvoiceNumber) => ({ InvoiceNumber }))),
    /**
     * 開立發票 (自訂配號). Takes an ARRAY payload (verified live); validates the
     * record (InvoiceNumber/InvoiceDate YYYYMMDD/InvoiceTime hh:mm:ss, etc.).
     */
    issueCustom: async (invoiceNumber: string, data: Record<string, unknown>) => {
      const record = { ...data, InvoiceNumber: invoiceNumber };
      if (this.config.validatePayload !== false) assertValidCustomIssuePayload(record);
      return this.raw(ENDPOINTS.issueCustom, [record]);
    },
  };

  /** 折讓 management endpoints. */
  readonly allowances = {
    /** 折讓查詢 — snake_case `allowance_number`; returns nested `data`. */
    query: (allowanceNumber: string) =>
      this.raw(ENDPOINTS.allowanceQuery, { allowance_number: allowanceNumber }),
    /** 折讓列表 — same `date_select`/`date_start`/`date_end`/`limit`/`page` shape as invoice_list. */
    list: (opts: {
      startDate?: string | number;
      endDate?: string | number;
      page?: number;
      limit?: number;
      dateSelect?: 1 | 2;
    } = {}) =>
      this.raw(ENDPOINTS.allowanceList, {
        date_select: opts.dateSelect ?? 1,
        ...(opts.startDate != null ? { date_start: toYmdNumber(opts.startDate) } : {}),
        ...(opts.endDate != null ? { date_end: toYmdNumber(opts.endDate) } : {}),
        limit: opts.limit ?? 20,
        page: opts.page ?? 1,
      }),
    /**
     * 折讓列印 — snake_case (verified live; PascalCase gives "allowance_number
     * 不可為空"). Returns `data.base64_data` for printer_type ≥ 2.
     */
    print: (allowanceNumber: string, printerType: number, lang?: 1 | 2 | 3) =>
      this.raw(ENDPOINTS.allowancePrint, {
        allowance_number: allowanceNumber,
        printer_type: printerType,
        ...(lang !== undefined ? { printer_lang: lang } : {}),
      }),
    /**
     * 折讓檔案 (PDF). Returns `data.file_url` (valid 10 minutes). `downloadStyle`:
     * 0 A4整張 / 1 A4(地址+A5) / 3 A5.
     */
    file: (allowanceNumber: string, downloadStyle: 0 | 1 | 3 = 0) =>
      this.raw(ENDPOINTS.allowanceFile, {
        allowance_number: allowanceNumber,
        download_style: downloadStyle,
      }),
    /** 折讓狀態 — ARRAY payload, nested `data[]`. */
    status: (allowanceNumbers: string[]) =>
      this.raw(
        ENDPOINTS.allowanceStatus,
        allowanceNumbers.map((AllowanceNumber) => ({ AllowanceNumber })),
      ),
  };

  /** 中獎 endpoints. */
  readonly lottery = {
    /** 中獎發票 — Year + Period (0:01-02 … 5:11-12). */
    status: (year: number, period: 0 | 1 | 2 | 3 | 4 | 5) =>
      this.raw(ENDPOINTS.lotteryStatus, { Year: year, Period: period }),
    /**
     * 獎項定義 (prize-type definitions). Takes NO data — the request must send an
     * empty data string (passing `{}` fails sign verification with code 16).
     */
    type: () => this.raw(ENDPOINTS.lotteryType),
  };

  /** 字軌 (number track) endpoints for self-numbering merchants. */
  readonly track = {
    /**
     * 所有字軌資料 — the full 3-layer track tree (1 財政部 / 2 光貿 / 3 字軌列表;
     * leaf nodes carry category, TrackApiCode, source, status). `period` is
     * 0:01-02 … 5:11-12; `Year` is PascalCase (lowercase yields no data).
     */
    all: (opts: { year: number; period?: 0 | 1 | 2 | 3 | 4 | 5 }) =>
      this.raw(ENDPOINTS.trackAll, {
        Year: opts.year,
        ...(opts.period !== undefined ? { Period: opts.period } : {}),
      }),
    /**
     * 字軌取號 — allocate a booklet of "API 配號" numbers. ⚠️ Mutating &
     * irreversible: each `book` reserves 50 invoice numbers. Returns
     * `data: { code, start, end }` (the allocated range). `period` is 0:01-02 …
     * 5:11-12; the `Book`/`Year`/`Period` fields are PascalCase.
     */
    get: (opts: { year: number; period: 0 | 1 | 2 | 3 | 4 | 5; book: number; trackApiCode?: string }) =>
      this.raw(ENDPOINTS.trackGet, {
        Year: opts.year,
        Period: opts.period,
        Book: opts.book,
        ...(opts.trackApiCode ? { TrackApiCode: opts.trackApiCode } : {}),
      }),
    /**
     * 字軌狀態 — status of "API 配號" tracks. `period` is 0:01-02 … 5:11-12.
     * Returns `data[]` of { code, start, end, now, total_booklet, used_booklet,
     * status } where status is 1 使用 / 2 停用 / 3 過期 / 9 用畢 (verified live;
     * note: the field is `Year` PascalCase — lowercase yields an empty list).
     */
    status: (opts: { year: number; period?: 0 | 1 | 2 | 3 | 4 | 5; trackApiCode?: string }) =>
      this.raw(ENDPOINTS.trackStatus, {
        Year: opts.year,
        ...(opts.period !== undefined ? { Period: opts.period } : {}),
        ...(opts.trackApiCode ? { TrackApiCode: opts.trackApiCode } : {}),
      }),
  };

  /**
   * 公司名稱查詢 — look up company names by 統一編號 (batch). Each id is checksum-
   * validated locally first (Amego rejects bad checksums with 統一編號格式錯誤).
   * An empty `name` in the response means "no company found", not an error.
   */
  async banQuery(...bans: string[]): Promise<AmegoResponse> {
    if (this.config.validatePayload !== false) {
      const bad = bans.filter((b) => !isValidUbn(b));
      if (bad.length > 0) {
        throw new InvoiceError(`Invalid 統一編號: ${bad.join(", ")}`, {
          provider: "amego",
          code: InvoiceErrorCode.VALIDATION,
          rawMessage: `Invalid 統一編號 checksum: ${bad.join(", ")}`,
        });
      }
    }
    return this.raw(ENDPOINTS.banQuery, bans.map((ban) => ({ ban })));
  }

  /**
   * 手機條碼查詢 — check whether a mobile barcode is valid/registered. The format
   * is checked locally first (Amego returns 9000112 for malformed input); a
   * well-formed but unregistered barcode comes back as 9000113 → NOT_FOUND.
   */
  async barcodeQuery(barCode: string): Promise<AmegoResponse> {
    if (this.config.validatePayload !== false && !isValidMobileBarcode(barCode)) {
      throw new InvoiceError(`Invalid 手機條碼 format: ${barCode}`, {
        provider: "amego",
        code: InvoiceErrorCode.VALIDATION,
        rawMessage: "手機條碼 must be '/' followed by 7 chars [0-9A-Z.+-]",
      });
    }
    return this.raw(ENDPOINTS.barcode, { barCode });
  }

  /** 伺服器時間 — a plain GET (no signing); returns the full time breakdown. */
  time(): Promise<AmegoTimeResponse> {
    return fetchServerTime(this.config);
  }
}

/** Create an Amego-backed {@link InvoiceProvider}. */
export function createAmegoProvider(config: AmegoConfig): AmegoProvider {
  return new AmegoProvider(config);
}

// --- helpers ---------------------------------------------------------------

/** Amego per-item tax_type number → unified TaxType. */
function fromAmegoTaxType(value: unknown): TaxType | undefined {
  switch (Number(value)) {
    case 1:
      return "TAXABLE";
    case 2:
      return "ZERO_RATED";
    case 3:
      return "TAX_FREE";
    default:
      return undefined;
  }
}

function resolveItemTaxType(item: InvoiceItem, fallback: TaxType): AmegoProductTaxType {
  const t = item.taxType ?? fallback;
  if (t === "ZERO_RATED") return 2;
  if (t === "TAX_FREE") return 3;
  return 1; // TAXABLE / SPECIAL → 應稅 line
}

function amegoLineTax(amount: number, taxType: AmegoProductTaxType, rate: number): number {
  return taxType === 1 ? Math.round(amount * rate) : 0;
}

function carrierFields(carrier?: Carrier): Record<string, unknown> {
  if (!carrier) return {};
  return {
    CarrierType: CARRIER_TYPE[carrier.type],
    CarrierId1: carrier.code, // 顯碼
    CarrierId2: carrier.code, // 隱碼 (same as 顯碼 for mobile barcode)
  };
}

/** Amego unix `*_time` → Date. */
function fromUnix(value: unknown): Date {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

/** Coerce a date input (`Date` not accepted here) to a numeric `YYYYMMDD`. */
function toYmdNumber(value: string | number): number {
  if (typeof value === "number") return value;
  const digits = value.replace(/\D/g, ""); // "2026-06-01" → "20260601"
  return Number(digits);
}

/** Amego `YYYYMMDD` (int or string) → Date at Asia/Taipei midnight. */
function fromYmd(value: unknown): Date {
  const s = String(value ?? "");
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return new Date();
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+08:00`);
}

function deriveStatus(d: Record<string, unknown>): InvoiceStatus {
  if (Number(d.cancel_date ?? 0) > 0) return InvoiceStatus.VOIDED;
  if (Array.isArray(d.allowance) && d.allowance.length > 0)
    return InvoiceStatus.ALLOWANCE;
  return InvoiceStatus.ISSUED;
}

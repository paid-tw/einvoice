import { InvoiceError, InvoiceErrorCode } from "@paid-tw/einvoice";
import { z } from "zod";

/**
 * Field-level validation for the Amego f0401 (開立發票) payload.
 *
 * Two kinds of rules are enforced here:
 *  1. Rules Amego's server enforces (so we fail fast with a clear message
 *     instead of a numeric code), e.g. BuyerIdentifier 8 digits, MainRemark
 *     ≤200, Description ≤256, Unit ≤6, item TaxType ∈ {1,2,3}, zero-rated needs
 *     CustomsClearanceMark + ZeroTaxRateReason, DetailVat 0 only with 統編.
 *  2. Rules Amego's server SILENTLY ACCEPTS but the docs forbid — verified live:
 *     BuyerName "0000", a malformed email, Currency "US"/"usd", a non-numeric
 *     ExchangeRate, PrinterLang 9 all returned code 0. We reject them locally so
 *     bad data never reaches the invoice.
 *
 * The schema is `.passthrough()` so provider-specific extras (via
 * `providerOptions`) are not rejected.
 */

/** ≤ `max` decimal places. */
const maxDecimals = (max: number) => (v: number) => {
  if (!Number.isFinite(v)) return false;
  const s = String(v);
  const dot = s.indexOf(".");
  return dot < 0 || s.length - dot - 1 <= max;
};

const amount7 = z
  .number()
  .refine(maxDecimals(7), "must have at most 7 decimal places");

const nonNegativeAmount = z
  .number()
  .nonnegative("must not be negative")
  .refine(maxDecimals(7), "must have at most 7 decimal places");

export const amegoProductItemSchema = z
  .object({
    Description: z.string().min(1, "Description is required").max(256, "Description must be ≤256 chars"),
    Quantity: amount7,
    UnitPrice: amount7, // line prices may be negative (e.g. discounts)
    Amount: amount7,
    Unit: z.string().max(6, "Unit must be ≤6 chars").optional(),
    Remark: z.string().max(120, "Remark must be ≤120 chars").optional(),
    RelateNumber: z.string().max(50, "RelateNumber must be ≤50 chars").optional(),
    TaxType: z
      .union([z.literal(1), z.literal(2), z.literal(3)])
      .describe("item TaxType: 1 應稅, 2 零稅率, 3 免稅"),
  })
  .passthrough();

const carrierTypes = ["3J0002", "CQ0001", "amego"] as const;

/** Shared f0401 / f0401_custom fields. */
const issueBaseObject = z.object({
  OrderId: z.string().min(1, "OrderId is required").max(40, "OrderId must be ≤40 chars"),
  TrackApiCode: z.string().optional(),
  BrandName: z.string().optional(),
  BuyerIdentifier: z
    .string()
    .refine((v) => v === "0000000000" || /^\d{8}$/.test(v), "BuyerIdentifier must be 8 digits or 0000000000"),
  BuyerName: z
    .string()
    .min(1, "BuyerName is required")
    .refine((v) => !["0", "00", "000", "0000"].includes(v), "BuyerName cannot be 0/00/000/0000"),
  BuyerAddress: z.string().optional(),
  BuyerTelephoneNumber: z.string().optional(),
  BuyerEmailAddress: z.string().email("BuyerEmailAddress must be a valid email").optional(),
  MainRemark: z.string().max(200, "MainRemark must be ≤200 chars").optional(),
  CarrierType: z.string().optional(),
  CarrierId1: z.string().optional(),
  CarrierId2: z.string().optional(),
  NPOBAN: z.string().regex(/^\d{3,7}$/, "NPOBAN must be 3–7 digits").optional(),
  ProductItem: z
    .array(amegoProductItemSchema)
    .min(1, "at least one ProductItem is required")
    .max(9999, "at most 9999 ProductItems"),
  SalesAmount: nonNegativeAmount,
  FreeTaxSalesAmount: nonNegativeAmount,
  ZeroTaxSalesAmount: nonNegativeAmount,
  TaxType: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(9)])
    .describe("invoice TaxType: 1 應稅, 2 零稅率, 3 免稅, 4 特種, 9 混合"),
  TaxRate: z.union([z.string(), z.number()]),
  TaxAmount: nonNegativeAmount,
  TotalAmount: nonNegativeAmount,
  Currency: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code").optional(),
  ExchangeRate: z.number().positive("ExchangeRate must be a positive number").optional(),
  CustomsClearanceMark: z.union([z.literal(1), z.literal(2)]).optional(),
  ZeroTaxRateReason: z
    .number()
    .int()
    .min(71, "ZeroTaxRateReason must be 71–79")
    .max(79, "ZeroTaxRateReason must be 71–79")
    .optional(),
  BondedAreaConfirm: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  GroupMark: z.enum(["*", ""]).optional(),
  PrintMark: z.enum(["Y", "N"]).optional(),
  // PrinterType is a model code (1, 2, …) — not limited to {1,2}; PrinterLang
  // is 1 BIG5 / 2 GBK / 3 UTF-8 (verified live).
  PrinterType: z.number().int().positive().optional(),
  PrinterLang: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  PrintDetail: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  DetailVat: z.union([z.literal(0), z.literal(1)]).optional(),
  DetailAmountRound: z.union([z.literal(0), z.literal(1)]).optional(),
  TaxAdjustment: z.union([z.literal(0), z.literal(1)]).optional(),
});

type IssueLike = {
  BuyerIdentifier: string;
  CarrierType?: string;
  CarrierId1?: string;
  DetailVat?: number;
  TaxType: number;
  TaxAdjustment?: number;
  SalesAmount: number;
  CustomsClearanceMark?: number;
  ZeroTaxRateReason?: number;
  ProductItem: Array<{ TaxType: number }>;
};

/** Cross-field rules shared by both issue payloads. */
function refineIssue(p: IssueLike, ctx: z.RefinementCtx): void {
  const hasTaxId = p.BuyerIdentifier !== "0000000000";

  // DetailVat 0 (未稅明細) only allowed when the invoice carries a 統編 (verified live: 3040162).
  if (p.DetailVat === 0 && !hasTaxId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "DetailVat=0 (tax-exclusive detail) is only allowed for invoices with a 統編",
      path: ["DetailVat"],
    });
  }

  // Carrier code is required (and member carrier has a specific format).
  if (p.CarrierType && (carrierTypes as readonly string[]).includes(p.CarrierType)) {
    if (!p.CarrierId1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `CarrierId1 is required for carrier ${p.CarrierType}`,
        path: ["CarrierId1"],
      });
    }
    if (p.CarrierType === "amego" && p.CarrierId1) {
      const ok = /^a\d+$/.test(p.CarrierId1) || /.+@.+\..+/.test(p.CarrierId1);
      if (!ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "member carrier (amego) CarrierId must be 'a'+phone or an email",
          path: ["CarrierId1"],
        });
      }
    }
  }

  // TaxAdjustment=1 (營業稅額減 1) is only valid for a 統編 invoice with
  // DetailVat=0 (未稅) whose SalesAmount ends in 10/30/50/70/90 (where 5% lands
  // on x.5). Amego silently accepts violations (verified live) — we reject them.
  if (p.TaxAdjustment === 1) {
    const tail = Math.abs(Math.round(p.SalesAmount)) % 100;
    if (!hasTaxId || p.DetailVat !== 0 || ![10, 30, 50, 70, 90].includes(tail)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "TaxAdjustment=1 requires a 統編 invoice with DetailVat=0 and SalesAmount ending in 10/30/50/70/90",
        path: ["TaxAdjustment"],
      });
    }
  }

  // Zero-rated invoices require CustomsClearanceMark + ZeroTaxRateReason (verified live: 3040179).
  const isZeroRated = p.TaxType === 2 || p.ProductItem.some((it) => it.TaxType === 2);
  if (isZeroRated) {
    if (p.CustomsClearanceMark === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CustomsClearanceMark is required for zero-rated invoices",
        path: ["CustomsClearanceMark"],
      });
    }
    if (p.ZeroTaxRateReason === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ZeroTaxRateReason is required for zero-rated invoices",
        path: ["ZeroTaxRateReason"],
      });
    }
  }
}

/** Payload for `/json/f0401` (auto-numbered issue). */
export const amegoIssuePayloadSchema = issueBaseObject
  .passthrough()
  .superRefine(refineIssue);

/**
 * One record for `/json/f0401_custom` (self-numbered issue). Adds the
 * merchant-supplied number/date/time/random-code and uses snake_case `order_id`
 * (verified live: InvoiceDate must be YYYYMMDD, InvoiceTime hh:mm:ss).
 */
export const amegoCustomIssuePayloadSchema = issueBaseObject
  .extend({
    OrderId: z.string().min(1).max(40).optional(),
    order_id: z.string().min(1, "order_id is required").max(40, "order_id must be ≤40 chars").optional(),
    InvoiceNumber: z.string().min(1, "InvoiceNumber is required"),
    InvoiceDate: z.union([
      z.string().regex(/^\d{8}$/, "InvoiceDate must be YYYYMMDD"),
      z.number().int(),
    ]),
    InvoiceTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/, "InvoiceTime must be hh:mm:ss"),
    RandomNumber: z.string().regex(/^\d{4}$/, "RandomNumber must be 4 digits").optional(),
    SellerPersonInCharge: z.string().max(30, "SellerPersonInCharge must be ≤30 chars").optional(),
    // f0401_custom requires PrintMark (verified live: omitting it → "PrintMark 錯誤").
    PrintMark: z.enum(["Y", "N"], { required_error: "PrintMark (Y/N) is required for f0401_custom" }),
  })
  .passthrough()
  .superRefine((p, ctx) => {
    refineIssue(p, ctx);
    if (!p.OrderId && !p.order_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "order_id is required",
        path: ["order_id"],
      });
    }
    // A non-printed invoice (PrintMark=N) must have somewhere to go: a carrier
    // or a donation (verified live: otherwise "載具類型錯誤").
    if (p.PrintMark === "N" && !p.CarrierType && !p.NPOBAN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "PrintMark=N requires a carrier or a donation (NPOBAN)",
        path: ["PrintMark"],
      });
    }
  });

export type AmegoIssuePayload = z.input<typeof amegoIssuePayloadSchema>;
export type AmegoCustomIssuePayload = z.input<typeof amegoCustomIssuePayloadSchema>;

function assertValid(
  schema: { safeParse: (v: unknown) => z.SafeParseReturnType<unknown, unknown> },
  data: unknown,
): void {
  const result = schema.safeParse(data);
  if (result.success) return;
  const detail = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new InvoiceError(`Invalid Amego invoice payload — ${detail}`, {
    provider: "amego",
    code: InvoiceErrorCode.VALIDATION,
    rawMessage: detail,
    cause: result.error,
  });
}

/**
 * Validate a built f0401 payload, throwing an {@link InvoiceError} (code
 * VALIDATION) listing every failing field. No-op on success.
 */
export function assertValidIssuePayload(data: unknown): void {
  assertValid(amegoIssuePayloadSchema, data);
}

/** Validate one f0401_custom record. */
export function assertValidCustomIssuePayload(data: unknown): void {
  assertValid(amegoCustomIssuePayloadSchema, data);
}

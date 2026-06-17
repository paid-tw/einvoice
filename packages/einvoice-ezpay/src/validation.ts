import { InvoiceError, InvoiceErrorCode } from "@paid-tw/einvoice";
import { z } from "zod";

/**
 * Field-level validation for the ezPay `invoice_issue` PostData_, per the
 * official spec. Numeric fields may be strings or numbers (the params object
 * mixes both), so they're coerced.
 */

const intLike = z.coerce.number().int();
const nonNegInt = z.coerce.number().int().nonnegative();

export const ezpayIssuePayloadSchema = z
  .object({
    MerchantOrderNo: z
      .string()
      .min(1, "MerchantOrderNo is required")
      .max(20, "MerchantOrderNo must be ≤20 chars")
      .regex(/^[A-Za-z0-9_]+$/, "MerchantOrderNo allows only letters, digits and _"),
    Category: z.enum(["B2B", "B2C"]),
    BuyerName: z.string().min(1, "BuyerName is required").max(60, "BuyerName must be ≤60 chars"),
    BuyerUBN: z.string().regex(/^\d{8}$/, "BuyerUBN must be 8 digits").optional(),
    BuyerAddress: z.string().max(100, "BuyerAddress must be ≤100 chars").optional(),
    BuyerEmail: z
      .string()
      .email("BuyerEmail must be a valid email")
      .max(50, "BuyerEmail must be ≤50 chars")
      .optional()
      .or(z.literal("")),
    CarrierType: z.enum(["0", "1", "2"]).optional(),
    CarrierNum: z.string().max(50).optional(),
    LoveCode: z.string().regex(/^\d{3,7}$/, "LoveCode must be 3–7 digits").optional(),
    PrintFlag: z.enum(["Y", "N"]),
    TaxType: z.enum(["1", "2", "3", "9"]),
    TaxRate: intLike,
    Amt: nonNegInt,
    TaxAmt: nonNegInt,
    TotalAmt: nonNegInt,
    ItemName: z.string().min(1, "ItemName is required"),
    ItemCount: z.string().min(1, "ItemCount is required"),
    ItemUnit: z.string().min(1, "ItemUnit is required"),
    ItemPrice: z.string().min(1, "ItemPrice is required"),
    ItemAmt: z.string().min(1, "ItemAmt is required"),
    ItemTaxType: z.string().optional(), // pipe-joined 1/2/3 for mixed (TaxType=9)
    Comment: z.string().max(200, "Comment must be ≤200 chars").optional(),
    // 開立方式 / 預約 / 通關 / 超商 Kiosk / 混合稅率 銷售額 — documented optional fields.
    Status: z.enum(["0", "1", "3"]).optional(),
    CreateStatusTime: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "CreateStatusTime must be YYYY-MM-DD")
      .optional(),
    CustomsClearance: z.enum(["1", "2"]).optional(),
    KioskPrintFlag: z.literal("1").optional(),
    AmtSales: nonNegInt.optional(),
    AmtZero: nonNegInt.optional(),
    AmtFree: nonNegInt.optional(),
  })
  .passthrough()
  .superRefine((p, ctx) => {
    // 發票金額 = 銷售額 + 稅額.
    if (Number(p.Amt) + Number(p.TaxAmt) !== Number(p.TotalAmt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "TotalAmt must equal Amt + TaxAmt",
        path: ["TotalAmt"],
      });
    }
    // B2B requires a buyer 統編.
    if (p.Category === "B2B" && !p.BuyerUBN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "BuyerUBN is required for B2B",
        path: ["BuyerUBN"],
      });
    }
    // ezPay carrier (type 2) requires BuyerEmail.
    if (p.CarrierType === "2" && !p.BuyerEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "BuyerEmail is required for the ezPay carrier (CarrierType=2)",
        path: ["BuyerEmail"],
      });
    }
    // Carrier and donation are mutually exclusive.
    if (p.CarrierType && p.LoveCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A carrier and a donation (LoveCode) cannot both be set",
        path: ["LoveCode"],
      });
    }
    // Each pipe-delimited item field must have the same number of segments.
    const counts = ["ItemName", "ItemCount", "ItemUnit", "ItemPrice", "ItemAmt"].map(
      (k) => String(p[k as keyof typeof p]).split("|").length,
    );
    if (new Set(counts).size > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Item fields (ItemName/Count/Unit/Price/Amt) must have equal segment counts",
        path: ["ItemName"],
      });
    }
    // 零稅率 (TaxType=2) requires the customs-clearance mark.
    if (p.TaxType === "2" && !p.CustomsClearance) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CustomsClearance is required for zero-rated invoices (TaxType=2)",
        path: ["CustomsClearance"],
      });
    }
    // 預約自動開立 (Status=3) requires the scheduled date.
    if (p.Status === "3" && !p.CreateStatusTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CreateStatusTime is required for scheduled issue (Status=3)",
        path: ["CreateStatusTime"],
      });
    }
    // 混合稅率 (TaxType=9, B2C only): needs the per-tax-type sales amounts and
    // a per-item tax type so the platform can split the invoice.
    if (p.TaxType === "9") {
      if (p.AmtSales === undefined && p.AmtZero === undefined && p.AmtFree === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Mixed tax (TaxType=9) requires at least one of AmtSales/AmtZero/AmtFree",
          path: ["AmtSales"],
        });
      }
      if (!p.ItemTaxType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Mixed tax (TaxType=9) requires per-item ItemTaxType",
          path: ["ItemTaxType"],
        });
      }
    }
  });

export type EzpayIssuePayload = z.input<typeof ezpayIssuePayloadSchema>;

/** UTF-8 byte length (ezPay length limits like "中文6字/英文20字" are byte-ish). */
function utf8Len(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** 作廢原因: required, 中文6字 / 英文20字 ⇒ ≤20 UTF-8 bytes. */
const invalidReasonSchema = z
  .string()
  .min(1, "InvalidReason is required")
  .refine((s) => utf8Len(s) <= 20, "InvalidReason must be ≤20 bytes (中文6字/英文20字)");

/** ezPay 發票號碼: 2 letters + 8 digits, but the field is just Varchar(10). */
const invoiceNumberField = z
  .string()
  .min(1, "InvoiceNumber is required")
  .max(10, "InvoiceNumber must be ≤10 chars");

const merchantOrderNoField = z
  .string()
  .min(1, "MerchantOrderNo is required")
  .max(20, "MerchantOrderNo must be ≤20 chars")
  .regex(/^[A-Za-z0-9_]+$/, "MerchantOrderNo allows only letters, digits and _");

/** Assert that the | -delimited item fields all have the same segment count. */
function refineEqualItemSegments(keys: string[]) {
  return (p: Record<string, unknown>, ctx: z.RefinementCtx) => {
    const counts = keys.map((k) => String(p[k] ?? "").split("|").length);
    if (new Set(counts).size > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Item fields (${keys.join("/")}) must have equal segment counts`,
        path: [keys[0] ?? "ItemName"],
      });
    }
  };
}

// --- invoice_invalid (作廢發票) -------------------------------------------------
export const ezpayVoidPayloadSchema = z
  .object({ InvoiceNumber: invoiceNumberField, InvalidReason: invalidReasonSchema })
  .passthrough();

// --- invoice_touch_issue (觸發開立發票) ----------------------------------------
export const ezpayTouchIssuePayloadSchema = z
  .object({
    InvoiceTransNo: z
      .string()
      .min(1, "InvoiceTransNo is required")
      .max(20, "InvoiceTransNo must be ≤20 chars"),
    MerchantOrderNo: merchantOrderNoField,
    TotalAmt: nonNegInt,
  })
  .passthrough();

// --- allowance_issue (開立折讓) ------------------------------------------------
export const ezpayAllowancePayloadSchema = z
  .object({
    InvoiceNo: invoiceNumberField,
    MerchantOrderNo: merchantOrderNoField,
    ItemName: z.string().min(1, "ItemName is required"),
    ItemCount: z.string().min(1, "ItemCount is required"),
    ItemUnit: z.string().min(1, "ItemUnit is required"),
    ItemPrice: z.string().min(1, "ItemPrice is required"),
    ItemAmt: z.string().min(1, "ItemAmt is required"),
    ItemTaxAmt: z.string().min(1, "ItemTaxAmt is required"),
    TotalAmt: nonNegInt,
    Status: z.enum(["0", "1"]),
    BuyerEmail: z
      .string()
      .email("BuyerEmail must be a valid email")
      .max(50)
      .optional()
      .or(z.literal("")),
    TaxTypeForMixed: z.string().optional(), // pipe-joined 1/2/3, only when TaxType=9
  })
  .passthrough()
  .superRefine((p, ctx) => {
    refineEqualItemSegments(["ItemName", "ItemCount", "ItemUnit", "ItemPrice", "ItemAmt", "ItemTaxAmt"])(
      p,
      ctx,
    );
    // ItemUnit: 中文2字 / 英數6字 ⇒ ≤6 UTF-8 bytes per segment.
    for (const seg of String(p.ItemUnit ?? "").split("|")) {
      if (utf8Len(seg) > 6) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each ItemUnit must be ≤2 中文字 / 6 英數字",
          path: ["ItemUnit"],
        });
        break;
      }
    }
  });

// --- allowance_touch_issue (觸發確認/取消折讓) --------------------------------
export const ezpayAllowanceTouchPayloadSchema = z
  .object({
    AllowanceStatus: z.enum(["C", "D"]),
    AllowanceNo: z.string().min(1, "AllowanceNo is required").max(25, "AllowanceNo must be ≤25 chars"),
    MerchantOrderNo: merchantOrderNoField,
    TotalAmt: nonNegInt,
  })
  .passthrough();

// --- allowanceInvalid (作廢折讓) ----------------------------------------------
export const ezpayVoidAllowancePayloadSchema = z
  .object({
    AllowanceNo: z.string().min(1, "AllowanceNo is required").max(25, "AllowanceNo must be ≤25 chars"),
    InvalidReason: invalidReasonSchema,
  })
  .passthrough();

// --- invoice_search (查詢發票) ------------------------------------------------
export const ezpaySearchPayloadSchema = z
  .object({
    SearchType: z.enum(["0", "1"]).optional(),
    InvoiceNumber: z.string().max(10).optional().or(z.literal("")),
    RandomNum: z.string().regex(/^\d{4}$/, "RandomNum must be 4 digits").optional(),
    MerchantOrderNo: z.string().max(20).optional().or(z.literal("")),
    TotalAmt: z.coerce.number().int().nonnegative().optional(),
    DisplayFlag: z.enum(["", "1"]).optional(),
  })
  .passthrough()
  .superRefine((p, ctx) => {
    const type = p.SearchType ?? "0";
    if (type === "1") {
      // 以訂單編號 + 發票金額查詢.
      if (!p.MerchantOrderNo)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MerchantOrderNo is required for SearchType 1", path: ["MerchantOrderNo"] });
      if (p.TotalAmt === undefined)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "TotalAmt is required for SearchType 1", path: ["TotalAmt"] });
    } else {
      // 以發票號碼 + 隨機碼查詢.
      if (!p.InvoiceNumber)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "InvoiceNumber is required for SearchType 0", path: ["InvoiceNumber"] });
      if (!p.RandomNum)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "RandomNum is required for SearchType 0", path: ["RandomNum"] });
    }
  });

/** Validate a built payload against `schema`, throwing {@link InvoiceError} on failure. */
function assertValid(label: string, schema: z.ZodTypeAny, data: unknown): void {
  const result = schema.safeParse(data);
  if (result.success) return;
  const detail = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new InvoiceError(`Invalid ezPay ${label} payload — ${detail}`, {
    provider: "ezpay",
    code: InvoiceErrorCode.VALIDATION,
    rawMessage: detail,
    cause: result.error,
  });
}

/** Validate a built issue payload, throwing an {@link InvoiceError} on failure. */
export function assertValidIssuePayload(data: unknown): void {
  assertValid("invoice", ezpayIssuePayloadSchema, data);
}

export function assertValidVoidPayload(data: unknown): void {
  assertValid("void", ezpayVoidPayloadSchema, data);
}

export function assertValidTouchIssuePayload(data: unknown): void {
  assertValid("touch-issue", ezpayTouchIssuePayloadSchema, data);
}

export function assertValidAllowancePayload(data: unknown): void {
  assertValid("allowance", ezpayAllowancePayloadSchema, data);
}

export function assertValidAllowanceTouchPayload(data: unknown): void {
  assertValid("allowance-touch", ezpayAllowanceTouchPayloadSchema, data);
}

export function assertValidVoidAllowancePayload(data: unknown): void {
  assertValid("void-allowance", ezpayVoidAllowancePayloadSchema, data);
}

export function assertValidSearchPayload(data: unknown): void {
  assertValid("search", ezpaySearchPayloadSchema, data);
}

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
    BuyerEmail: z.string().email("BuyerEmail must be a valid email").optional().or(z.literal("")),
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
  });

export type EzpayIssuePayload = z.input<typeof ezpayIssuePayloadSchema>;

/** Validate a built issue payload, throwing an {@link InvoiceError} on failure. */
export function assertValidIssuePayload(data: unknown): void {
  const result = ezpayIssuePayloadSchema.safeParse(data);
  if (result.success) return;
  const detail = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new InvoiceError(`Invalid ezPay invoice payload — ${detail}`, {
    provider: "ezpay",
    code: InvoiceErrorCode.VALIDATION,
    rawMessage: detail,
    cause: result.error,
  });
}

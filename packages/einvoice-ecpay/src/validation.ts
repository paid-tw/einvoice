import { InvoiceError, InvoiceErrorCode } from "@paid-tw/einvoice";
import { z } from "zod";

/**
 * Field-level validation for the built ECPay `Issue` Data payload, per the spec
 * plus the business rules confirmed live on stage (paper invoices need an
 * address + email/phone; carrier invoices must not print; amounts must add up).
 */

const nonNegInt = z.coerce.number().int().nonnegative();

const itemSchema = z.object({
  ItemSeq: z.number().int().positive(),
  ItemName: z.string().min(1, "ItemName is required"),
  ItemCount: z.coerce.number().positive(),
  ItemWord: z.string().min(1, "ItemWord is required"),
  ItemPrice: z.coerce.number(),
  ItemAmount: z.coerce.number(),
  ItemTaxType: z.enum(["1", "2", "3"]).optional(),
});

export const ecpayIssuePayloadSchema = z
  .object({
    RelateNumber: z
      .string()
      .min(1, "RelateNumber is required")
      .max(30, "RelateNumber must be ≤30 chars"),
    CustomerIdentifier: z
      .string()
      .regex(/^\d{8}$/, "CustomerIdentifier must be 8 digits")
      .optional()
      .or(z.literal("")),
    CustomerName: z.string().max(60).optional().or(z.literal("")),
    CustomerAddr: z.string().max(100).optional().or(z.literal("")),
    CustomerEmail: z.string().max(200).optional().or(z.literal("")),
    CustomerPhone: z.string().max(20).optional().or(z.literal("")),
    Print: z.enum(["0", "1"]),
    Donation: z.enum(["0", "1", "2"]),
    LoveCode: z.string().regex(/^\d{3,7}$/, "LoveCode must be 3–7 digits").optional().or(z.literal("")),
    CarrierType: z.enum(["", "1", "2", "3"]),
    CarrierNum: z.string().max(64).optional().or(z.literal("")),
    TaxType: z.enum(["1", "2", "3", "9"]),
    SalesAmount: nonNegInt,
    InvType: z.enum(["07", "08"]),
    Items: z.array(itemSchema).min(1, "at least one item is required"),
  })
  .passthrough()
  .superRefine((p, ctx) => {
    // 發票金額 = Σ(單價 × 數量).
    const itemsTotal = p.Items.reduce((sum, it) => sum + Number(it.ItemPrice) * Number(it.ItemCount), 0);
    if (Math.round(itemsTotal) !== Number(p.SalesAmount)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `SalesAmount (${p.SalesAmount}) must equal Σ ItemPrice×ItemCount (${itemsTotal})`,
        path: ["SalesAmount"],
      });
    }
    // Donation requires a love code, and is mutually exclusive with a carrier.
    if (p.Donation === "1" && !p.LoveCode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "LoveCode is required when Donation=1", path: ["LoveCode"] });
    }
    if (p.Donation === "1" && p.CarrierType) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A carrier and a donation cannot both be set", path: ["CarrierType"] });
    }
    // A carrier / donation invoice is electronic — it must not print.
    if ((p.CarrierType || p.Donation === "1") && p.Print === "1") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Print must be 0 for a carrier/donation invoice", path: ["Print"] });
    }
    // Paper invoices (Print=1) need a name, an address, and an email or phone.
    if (p.Print === "1") {
      if (!p.CustomerName)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "CustomerName is required for a printed invoice", path: ["CustomerName"] });
      if (!p.CustomerAddr)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "CustomerAddr is required for a printed invoice", path: ["CustomerAddr"] });
      if (!p.CustomerEmail && !p.CustomerPhone)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "CustomerEmail or CustomerPhone is required for a printed invoice", path: ["CustomerEmail"] });
    }
    // B2B (統編) must print a triplicate invoice.
    if (p.CustomerIdentifier && p.CarrierType)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "B2B (CustomerIdentifier) cannot use a carrier", path: ["CarrierType"] });
  });

export type EcpayIssuePayload = z.input<typeof ecpayIssuePayloadSchema>;

/** Validate a built issue payload, throwing an {@link InvoiceError} on failure. */
export function assertValidIssuePayload(data: unknown): void {
  const result = ecpayIssuePayloadSchema.safeParse(data);
  if (result.success) return;
  const detail = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new InvoiceError(`Invalid ECPay invoice payload — ${detail}`, {
    provider: "ecpay",
    code: InvoiceErrorCode.VALIDATION,
    rawMessage: detail,
    cause: result.error,
  });
}

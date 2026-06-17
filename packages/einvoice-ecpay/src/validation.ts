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
      .max(50, "RelateNumber must be ≤50 chars"),
    CustomerIdentifier: z
      .string()
      .regex(/^\d{8}$/, "CustomerIdentifier must be 8 digits")
      .optional()
      .or(z.literal("")),
    CustomerName: z.string().max(60).optional().or(z.literal("")),
    CustomerAddr: z.string().max(100).optional().or(z.literal("")),
    CustomerEmail: z.string().max(80).optional().or(z.literal("")),
    CustomerPhone: z.string().max(20).optional().or(z.literal("")),
    Print: z.enum(["0", "1"]),
    Donation: z.enum(["0", "1", "2"]),
    LoveCode: z.string().regex(/^\d{3,7}$/, "LoveCode must be 3–7 digits").optional().or(z.literal("")),
    CarrierType: z.enum(["", "1", "2", "3"]),
    CarrierNum: z.string().max(64).optional().or(z.literal("")),
    TaxType: z.enum(["1", "2", "3", "4", "9"]),
    SalesAmount: nonNegInt,
    InvType: z.enum(["07", "08"]),
    ClearanceMark: z.enum(["1", "2"]).optional().or(z.literal("")), // 通關方式 (零稅率)
    ZeroTaxRateReason: z.string().optional().or(z.literal("")), // 零稅率原因 71–79
    SpecialTaxType: z.union([z.string(), z.number()]).optional(),
    Items: z.array(itemSchema).min(1, "at least one item is required"),
  })
  .passthrough()
  // All rules below are confirmed against the live stage API (the source of
  // truth) — the ECPay docs over-state some requirements the API doesn't enforce
  // (ZeroTaxRateReason, TAX_FREE SpecialTaxType, vat=0 amount match) and forbid
  // combinations it actually accepts (carrier+donation, B2B+carrier).
  .superRefine((p, ctx) => {
    const fail = (message: string, path: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });

    // 發票金額(含稅) = round(Σ ItemAmount). The API enforces this for 含稅 (vat=1);
    // for 未稅 (vat=0) it recomputes and tolerates a mismatch, so skip it there.
    if (String(p.vat ?? "1") !== "0") {
      const itemsTotal = p.Items.reduce((sum, it) => sum + Number(it.ItemAmount), 0);
      if (Math.round(itemsTotal) !== Number(p.SalesAmount))
        fail(`SalesAmount (${p.SalesAmount}) must equal round(Σ ItemAmount) (${itemsTotal})`, "SalesAmount");
    }

    // 捐贈 needs a love code. (A carrier may coexist — the invoice sits in the
    // carrier then gets donated; live-verified.)
    if (p.Donation === "1" && !p.LoveCode) fail("LoveCode is required when Donation=1", "LoveCode");

    // 列印 (Print=1) needs a name, an address, and an email or phone.
    if (p.Print === "1") {
      if (!p.CustomerName) fail("CustomerName is required for a printed invoice", "CustomerName");
      if (!p.CustomerAddr) fail("CustomerAddr is required for a printed invoice", "CustomerAddr");
      if (!p.CustomerEmail && !p.CustomerPhone)
        fail("CustomerEmail or CustomerPhone is required for a printed invoice", "CustomerEmail");
    }

    if (p.CustomerIdentifier) {
      // B2B (統編) without printing must store the invoice in a carrier (5000028).
      if (p.Print === "0" && !p.CarrierType) fail("A non-printed B2B invoice must use a carrier", "CarrierType");
    } else {
      // B2C carrier invoices are electronic — they cannot print (5000015).
      if (p.CarrierType && p.Print === "1") fail("Print must be 0 for a B2C carrier invoice", "Print");
    }

    // 零稅率 (TaxType 2 / 9) requires the customs-clearance mark (5000007).
    // (ZeroTaxRateReason is NOT enforced by the API, so it is not required here.)
    if ((p.TaxType === "2" || p.TaxType === "9") && !p.ClearanceMark)
      fail("ClearanceMark is required for zero-rated invoices (TaxType 2/9)", "ClearanceMark");

    // 混合稅率 (TaxType=9): every item needs a per-item tax type.
    if (p.TaxType === "9" && p.Items.some((it) => !it.ItemTaxType))
      fail("Each item needs ItemTaxType when TaxType=9", "Items");
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

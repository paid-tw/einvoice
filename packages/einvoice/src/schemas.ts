import { z } from "zod";

/**
 * Runtime validation for the unified inputs. Adapters call these before mapping
 * to the wire format, so every provider rejects bad input consistently.
 */

export const taxTypeSchema = z.enum([
  "TAXABLE",
  "ZERO_RATED",
  "TAX_FREE",
  "SPECIAL",
]);

export const priceModeSchema = z.enum(["TAX_INCLUSIVE", "TAX_EXCLUSIVE"]);

export const invoiceCategorySchema = z.enum(["B2B", "B2C"]);

export const carrierTypeSchema = z.enum([
  "MOBILE_BARCODE",
  "CITIZEN_CERTIFICATE",
  "MEMBER",
]);

/** 統一編號: 8 digits. */
export const taxIdSchema = z
  .string()
  .regex(/^\d{8}$/, "統一編號 must be 8 digits");

export const buyerSchema = z.object({
  name: z.string().min(1).optional(),
  taxId: taxIdSchema.optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
});

export const carrierSchema = z
  .object({
    type: carrierTypeSchema,
    code: z.string().optional(),
  })
  .superRefine((c, ctx) => {
    if (c.type === "MOBILE_BARCODE" && c.code && !/^\/[0-9A-Z.\-+]{7}$/.test(c.code)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "手機條碼 must be '/' followed by 7 chars",
        path: ["code"],
      });
    }
    if (
      c.type === "CITIZEN_CERTIFICATE" &&
      c.code &&
      !/^[A-Z0-9]{16}$/.test(c.code)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "自然人憑證 must be 16 alphanumeric chars",
        path: ["code"],
      });
    }
  });

export const donationSchema = z.object({
  npoban: z.string().regex(/^\d{3,7}$/, "愛心碼 must be 3–7 digits"),
});

export const invoiceItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number(),
  amount: z.number(),
  unit: z.string().optional(),
  taxType: taxTypeSchema.optional(),
  remark: z.string().optional(),
});

export const amountSummarySchema = z.object({
  salesAmount: z.number().int(),
  taxAmount: z.number().int(),
  totalAmount: z.number().int(),
});

export const issueInvoiceInputSchema = z
  .object({
    orderId: z.string().min(1),
    buyer: buyerSchema,
    items: z.array(invoiceItemSchema).min(1),
    amount: amountSummarySchema,
    taxType: taxTypeSchema,
    taxRate: z.number().min(0).max(1).optional(),
    priceMode: priceModeSchema,
    category: invoiceCategorySchema.optional(),
    carrier: carrierSchema.optional(),
    donation: donationSchema.optional(),
    remark: z.string().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO 4217 code")
      .optional(),
    exchangeRate: z.number().positive().optional(),
    date: z.date().optional(),
    providerOptions: z.record(z.unknown()).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.currency && input.currency !== "TWD" && input.exchangeRate == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "exchangeRate is required when currency is not TWD",
        path: ["exchangeRate"],
      });
    }
    if (input.carrier && input.donation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An invoice cannot use both a carrier and a donation",
        path: ["donation"],
      });
    }
    if (input.donation && input.buyer.taxId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "B2B invoices (with 統一編號) cannot be donated",
        path: ["donation"],
      });
    }
    const { salesAmount, taxAmount, totalAmount } = input.amount;
    if (salesAmount + taxAmount !== totalAmount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount.totalAmount must equal salesAmount + taxAmount",
        path: ["amount", "totalAmount"],
      });
    }
  });

export const voidInvoiceInputSchema = z.object({
  invoiceNumber: z.string().min(1),
  reason: z.string().min(1),
  date: z.date().optional(),
  providerOptions: z.record(z.unknown()).optional(),
});

export const allowanceInputSchema = z.object({
  invoiceNumber: z.string().min(1),
  allowanceId: z.string().min(1),
  items: z.array(invoiceItemSchema).min(1),
  amount: amountSummarySchema,
  date: z.date().optional(),
  providerOptions: z.record(z.unknown()).optional(),
});

export const voidAllowanceInputSchema = z.object({
  invoiceNumber: z.string().min(1),
  allowanceNumber: z.string().min(1),
  reason: z.string().optional(),
  providerOptions: z.record(z.unknown()).optional(),
});

export const queryInvoiceInputSchema = z
  .object({
    invoiceNumber: z.string().min(1).optional(),
    orderId: z.string().min(1).optional(),
    providerOptions: z.record(z.unknown()).optional(),
  })
  .refine((q) => q.invoiceNumber || q.orderId, {
    message: "Provide invoiceNumber or orderId",
  });

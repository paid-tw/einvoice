import type { InvoiceCategory } from "./types.js";
import { InvoiceCategory as Category } from "./types.js";

/** Derive B2B vs B2C from the buyer's 統一編號. */
export function deriveCategory(buyer: { taxId?: string }): InvoiceCategory {
  return buyer.taxId ? Category.B2B : Category.B2C;
}

/**
 * Split a tax-inclusive total into untaxed sales + tax at the given rate,
 * rounding the tax to the nearest integer (the MOF convention). Returns
 * integer NTD amounts.
 */
export function splitTaxInclusive(total: number, rate = 0.05) {
  const salesAmount = Math.round(total / (1 + rate));
  const taxAmount = total - salesAmount;
  return { salesAmount, taxAmount, totalAmount: total };
}

/** Compose a tax-exclusive sales amount into the full summary. */
export function composeTaxExclusive(salesAmount: number, rate = 0.05) {
  const taxAmount = Math.round(salesAmount * rate);
  return { salesAmount, taxAmount, totalAmount: salesAmount + taxAmount };
}

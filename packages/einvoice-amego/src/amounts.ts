import type { InvoiceCategory, TaxType } from "@paid-tw/einvoice";

/**
 * The amount block Amego's f0401 expects. Verified against the live sandbox:
 *
 *  - 應稅 (TAXABLE) B2B 三聯式: SalesAmount = round(total / (1+rate)) (未稅),
 *    TaxAmount = total − SalesAmount.
 *  - 應稅 (TAXABLE) B2C 二聯式: SalesAmount = total (含稅), TaxAmount = 0
 *    (Amego derives the embedded tax internally for the QR code).
 *  - 免稅 (TAX_FREE): FreeTaxSalesAmount = total, SalesAmount = 0, TaxAmount = 0.
 *  - 零稅率 (ZERO_RATED): ZeroTaxSalesAmount = total, SalesAmount = 0, TaxAmount = 0.
 *
 * In all cases `ProductItem` amounts are tax-inclusive and must sum to
 * `TotalAmount`. We treat the caller's grand total as the source of truth and
 * derive Amego's split from it, because each value-added center splits tax its
 * own way.
 */
export interface AmegoAmounts {
  SalesAmount: number;
  FreeTaxSalesAmount: number;
  ZeroTaxSalesAmount: number;
  TaxType: number;
  TaxRate: number;
  TaxAmount: number;
  TotalAmount: number;
}

/** Amego/MIG numeric TaxType code. */
export function amegoTaxType(taxType: TaxType): number {
  switch (taxType) {
    case "TAXABLE":
      return 1;
    case "ZERO_RATED":
      return 2;
    case "TAX_FREE":
      return 3;
    case "SPECIAL":
      return 4;
  }
}

export function computeAmegoAmounts(opts: {
  total: number;
  taxType: TaxType;
  category: InvoiceCategory;
  taxRate?: number;
}): AmegoAmounts {
  const { total, taxType, category } = opts;
  const taxRate = opts.taxRate ?? 0.05;
  const base = {
    SalesAmount: 0,
    FreeTaxSalesAmount: 0,
    ZeroTaxSalesAmount: 0,
    TaxType: amegoTaxType(taxType),
    TaxRate: taxRate,
    TaxAmount: 0,
    TotalAmount: total,
  } satisfies AmegoAmounts;

  switch (taxType) {
    case "TAXABLE":
    case "SPECIAL": {
      if (category === "B2B") {
        const sales = Math.round(total / (1 + taxRate));
        return { ...base, SalesAmount: sales, TaxAmount: total - sales };
      }
      // B2C 二聯式: report the tax-inclusive total as SalesAmount, tax = 0.
      return { ...base, SalesAmount: total, TaxAmount: 0 };
    }
    case "TAX_FREE":
      return { ...base, FreeTaxSalesAmount: total, TaxRate: 0 };
    case "ZERO_RATED":
      return { ...base, ZeroTaxSalesAmount: total, TaxRate: 0 };
  }
}

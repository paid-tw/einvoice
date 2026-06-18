import type { TaxType } from "@paid-tw/einvoice";

/** Amego/MIG per-item tax type: 1 應稅, 2 零稅率, 3 免稅. */
export type AmegoProductTaxType = 1 | 2 | 3;

/** Amego/MIG invoice-level tax type, incl. 9 混合 (mixed). */
export type AmegoInvoiceTaxType = 1 | 2 | 3 | 4 | 9;

/**
 * The amount block Amego's f0401 expects. Verified against the live sandbox:
 *
 *  - 應稅 (TAXABLE) B2B 三聯式: SalesAmount = round(taxable / (1+rate)) (未稅),
 *    TaxAmount = taxable − SalesAmount.
 *  - 應稅 (TAXABLE) B2C 二聯式: SalesAmount = taxable (含稅), TaxAmount = 0.
 *  - 免稅 / 零稅率: their item sums go to FreeTaxSalesAmount / ZeroTaxSalesAmount.
 *  - Mixed item tax types ⇒ invoice TaxType = 9.
 *
 * Amounts are computed per-item from the resolved item tax types, which is the
 * only correct way to handle mixed-tax baskets.
 */
export interface AmegoAmounts {
  SalesAmount: number;
  FreeTaxSalesAmount: number;
  ZeroTaxSalesAmount: number;
  TaxType: AmegoInvoiceTaxType;
  TaxRate: number;
  TaxAmount: number;
  TotalAmount: number;
}

/** Map a unified line/invoice tax type to Amego's per-item numeric code. */
export function amegoTaxType(taxType: TaxType): AmegoProductTaxType | 4 {
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

export interface AmegoLineAmount {
  /** Line amount, interpreted per `priceExclusive`. */
  amount: number;
  /** Resolved per-item tax type (1/2/3). */
  taxType: AmegoProductTaxType;
}

export function computeAmegoAmounts(opts: {
  lines: AmegoLineAmount[];
  buyerHasUbn: boolean;
  taxRate?: number;
  /** true when line amounts are tax-exclusive (未稅). Default false (含稅). */
  priceExclusive?: boolean;
}): AmegoAmounts {
  const { lines, buyerHasUbn, priceExclusive = false } = opts;
  const taxRate = opts.taxRate ?? 0.05;

  let taxableSum = 0; // tax type 1
  let zeroRateSum = 0; // tax type 2
  let exemptSum = 0; // tax type 3
  const seen = new Set<AmegoProductTaxType>();
  for (const line of lines) {
    seen.add(line.taxType);
    if (line.taxType === 1) taxableSum += line.amount;
    else if (line.taxType === 2) zeroRateSum += line.amount;
    else exemptSum += line.amount;
  }

  let salesAmount = Math.round(taxableSum);
  const freeTaxSalesAmount = Math.round(exemptSum);
  const zeroTaxSalesAmount = Math.round(zeroRateSum);
  let taxAmount = 0;

  if (buyerHasUbn && salesAmount > 0) {
    if (priceExclusive) {
      taxAmount = Math.round(salesAmount * taxRate);
    } else {
      // 含稅 → split out the embedded tax (verified: 105 → 100 + 5).
      taxAmount = salesAmount - Math.round(salesAmount / (1 + taxRate));
      salesAmount = salesAmount - taxAmount;
    }
  }
  // B2C keeps the 含稅 total as SalesAmount with TaxAmount = 0 (verified live).

  const totalAmount = salesAmount + freeTaxSalesAmount + zeroTaxSalesAmount + taxAmount;

  return {
    SalesAmount: salesAmount,
    FreeTaxSalesAmount: freeTaxSalesAmount,
    ZeroTaxSalesAmount: zeroTaxSalesAmount,
    TaxType: invoiceTaxType(seen),
    TaxRate: taxRate,
    TaxAmount: taxAmount,
    TotalAmount: totalAmount,
  };
}

function invoiceTaxType(seen: Set<AmegoProductTaxType>): AmegoInvoiceTaxType {
  if (seen.size <= 1) {
    const [only] = seen;
    return (only ?? 1) as AmegoInvoiceTaxType;
  }
  return 9; // 混合稅率
}

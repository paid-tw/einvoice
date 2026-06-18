// Pure unified-model → ezReceipt wire-field mappers (no client / no `this`).
import type { Buyer, Carrier, InvoiceItem, IssueInvoiceInput, TaxType } from "@paid-tw/einvoice";

/** ezReceipt carrierType: 1 會員 / 2 手機條碼 / 3 自然人憑證 / 5 捐贈 / 10 紙本 / 20 境外電商. */
export const CARRIER_TYPE: Record<Carrier["type"], number> = {
  MEMBER: 1,
  MOBILE_BARCODE: 2,
  CITIZEN_CERTIFICATE: 3,
};

/** Unified TaxType → ezReceipt taxType (1 應稅 / 2 零稅率 / 3 免稅). 特種 issues as 應稅 + trCode. */
export function ezreceiptTaxType(taxType: TaxType): number {
  switch (taxType) {
    case "ZERO_RATED":
      return 2;
    case "TAX_FREE":
      return 3;
    default:
      return 1; // TAXABLE / SPECIAL
  }
}

/** Map a unified item → ezReceipt prodList entry. */
export function toProdItem(item: InvoiceItem, input: IssueInvoiceInput): Record<string, unknown> {
  return {
    title: item.description,
    qty: item.quantity,
    sales: item.unitPrice,
    incTax: input.priceMode === "TAX_INCLUSIVE",
    taxType: ezreceiptTaxType(item.taxType ?? input.taxType),
    ...(item.unit ? { unit: item.unit } : {}),
    ...(item.remark ? { remarks: item.remark } : {}),
    // A negative-priced line must be flagged as a discount (mcType 100); otherwise
    // the API rejects the sub-zero price (1057/1062).
    ...(item.unitPrice < 0 || item.amount < 0 ? { mcType: 100 } : {}),
  };
}

/** The carrierInfo for a unified carrier (member id / barcode / cert number). */
export function carrierInfo(carrier: Carrier, buyer: Buyer): string | undefined {
  if (carrier.type === "MEMBER") return carrier.code ?? buyer.email ?? buyer.phone;
  return carrier.code;
}

export function toBuyer(buyer: Buyer, accName: string | undefined): Record<string, unknown> {
  return {
    accName: accName ?? buyer.email ?? buyer.phone,
    name: buyer.name ?? "消費者",
    ...(buyer.address ? { addr: buyer.address } : {}),
    ...(buyer.phone ? { phone: buyer.phone } : {}),
  };
}

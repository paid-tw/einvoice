import type { InvoiceCategory } from "./types.js";
import { InvoiceCategory as Category } from "./types.js";

/** Derive B2B vs B2C from the buyer's 統一編號. */
export function deriveCategory(buyer: { ubn?: string }): InvoiceCategory {
  return buyer.ubn ? Category.B2B : Category.B2C;
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

/**
 * Parse a Taiwan datetime string (`YYYY-MM-DD HH:mm:ss`, interpreted as
 * Asia/Taipei, UTC+8) into a Date. Returns the current time for unparseable
 * input. Shared by the providers, which all receive dates in this shape.
 */
export function parseTaipeiDate(value: unknown): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(value ?? "").trim());
  if (!m) return new Date();
  const [, y, mo, d, hh, mi, ss] = m;
  return new Date(`${y}-${mo}-${d}T${hh}:${mi}:${ss}+08:00`);
}

/**
 * Format a Date as `YYYY-MM-DD HH:mm:ss` in Asia/Taipei (24-hour). The `"sv-SE"`
 * locale is intentional — Swedish formats dates ISO-style, the exact shape the
 * providers' wire formats expect.
 */
export function taipeiDateTime(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace("T", " ");
}

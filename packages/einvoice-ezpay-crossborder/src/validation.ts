import { InvoiceError, InvoiceErrorCode, type IssueInvoiceInput } from "@paid-tw/einvoice";

/** Small tolerance for foreign-currency (2-decimal) amount comparisons. */
const EPS = 0.005;

function fail(message: string, code: InvoiceErrorCode = InvoiceErrorCode.VALIDATION): InvoiceError {
  return new InvoiceError(message, { provider: "ezpay-crossborder", code, rawMessage: message });
}

/** The invoice currency, defaulting to TWD. */
export function resolveCurrency(input: { currency?: string }): string {
  return (input.currency ?? "TWD").toUpperCase();
}

/** A non-TWD currency carries ≤2-decimal amounts; TWD is integer-only. */
function isValidAmount(value: number, foreign: boolean): boolean {
  if (!Number.isFinite(value) || value < 0) return false;
  return foreign ? Math.abs(Math.round(value * 100) - value * 100) < 1e-6 : Number.isInteger(value);
}

/**
 * Validate a unified issue payload against the cross-border (CES) rules. The
 * provider is B2C-email-only and foreign-currency-native, so it rejects the
 * features it structurally can't represent (統編 / 載具 / 捐贈 / 混合稅率) as
 * `UNSUPPORTED`, and the amount/format problems as `VALIDATION`.
 */
export function assertValidCrossBorderIssue(input: IssueInvoiceInput): void {
  const currency = resolveCurrency(input);
  const foreign = currency !== "TWD";

  // --- capability rejections (structurally unrepresentable) ----------------
  if (input.buyer.ubn) {
    throw fail("ezPay cross-border invoices are B2C only; a 統一編號 (buyer.ubn) is not supported", InvoiceErrorCode.UNSUPPORTED);
  }
  if (input.carrier) {
    throw fail("ezPay cross-border uses an e-mail carrier only; buyer.carrier is not supported", InvoiceErrorCode.UNSUPPORTED);
  }
  if (input.donation) {
    throw fail("ezPay cross-border invoices cannot be donated; donation is not supported", InvoiceErrorCode.UNSUPPORTED);
  }
  // Cross-border has no per-item tax type field, so a genuinely mixed-rate
  // invoice (items declaring differing taxTypes) can't be represented.
  if (new Set(input.items.map((i) => i.taxType).filter(Boolean)).size > 1) {
    throw fail("ezPay cross-border invoices do not support mixed tax rates", InvoiceErrorCode.UNSUPPORTED);
  }

  // --- structural / format -------------------------------------------------
  if (!/^[A-Za-z0-9_]{1,20}$/.test(input.orderId)) {
    throw fail("orderId must be 1–20 chars of [A-Za-z0-9_] (maps to MerchantOrderNo)");
  }
  if (!input.buyer.email) {
    throw fail("buyer.email is required — it is the cross-border e-mail carrier");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw fail("currency must be a 3-letter ISO 4217 code");
  }
  if (foreign && input.exchangeRate == null) {
    throw fail("exchangeRate is required when currency is not TWD");
  }
  if (!input.items.length) {
    throw fail("at least one item is required");
  }

  // --- amounts -------------------------------------------------------------
  const { salesAmount, taxAmount, totalAmount } = input.amount;
  for (const [name, v] of [["salesAmount", salesAmount], ["taxAmount", taxAmount], ["totalAmount", totalAmount]] as const) {
    if (!isValidAmount(v, foreign)) {
      throw fail(`amount.${name} must be ${foreign ? "a number with ≤2 decimals" : "an integer"} for currency ${currency}`);
    }
  }
  if (Math.abs(salesAmount + taxAmount - totalAmount) > EPS) {
    throw fail("amount.totalAmount must equal salesAmount + taxAmount");
  }

  let itemSum = 0;
  for (const item of input.items) {
    if (!isValidAmount(item.unitPrice, foreign) || !isValidAmount(item.amount, foreign)) {
      throw fail(`item "${item.description}" price/amount must be ${foreign ? "≤2-decimal numbers" : "integers"} for currency ${currency}`);
    }
    if (Math.abs(item.quantity * item.unitPrice - item.amount) > EPS) {
      throw fail(`item "${item.description}": amount must equal quantity × unitPrice (tax-inclusive)`);
    }
    itemSum += item.amount;
  }
  if (Math.abs(itemSum - totalAmount) > EPS) {
    throw fail("the items' tax-inclusive amounts must sum to amount.totalAmount");
  }
}

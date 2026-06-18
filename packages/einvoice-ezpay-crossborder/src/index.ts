// @paid-tw/einvoice-ezpay-crossborder — ezPay 境外電商 (CES) adapter.
export { EZPAY_CB_CURRENCIES } from "./currencies.js";
export type { EzpayCbCurrency } from "./currencies.js";
export { CB_ENDPOINTS as EZPAY_CB_ENDPOINTS } from "./endpoints.js";
export type { CrossBorderEndpointKey } from "./endpoints.js";
export { assertValidCrossBorderIssue, resolveCurrency } from "./validation.js";
export { createEzpayCrossBorderProvider, EzpayCrossBorderProvider } from "./provider.js";
export type {
  EzpayCrossBorderConfig,
  CrossBorderPendingInvoice,
  IssuePendingOptions,
} from "./provider.js";

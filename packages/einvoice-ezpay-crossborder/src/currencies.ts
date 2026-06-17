/**
 * The 20 currency codes ezPay's 境外電商 API accepts (附件三 幣別碼列表). Verified
 * live: every code here issues successfully, while any code NOT in this list is
 * rejected by ezPay with `INV10002 欄位資料格式錯誤-Currency`. The list is exposed
 * for convenience; the API itself remains the source of truth (this adapter does
 * not pre-reject, so a code ezPay adds later still works).
 *
 * Zero-decimal currencies (JPY / KRW / VND / IDR) are still sent with 2-decimal
 * amounts — the cross-border API pads every non-TWD amount to 2 decimals.
 */
export const EZPAY_CB_CURRENCIES = [
  "USD", // United States, Dollars
  "HKD", // Hong Kong, Dollars
  "GBP", // United Kingdom, Pounds
  "AUD", // Australia, Dollars
  "CAD", // Canada, Dollars
  "SGD", // Singapore, Dollars
  "CHF", // Switzerland, Francs
  "JPY", // Japan, Yen
  "ZAR", // South Africa, Rand
  "SEK", // Sweden, Kronor
  "NZD", // New Zealand, Dollars
  "THB", // Thailand, Baht
  "PHP", // Philippines, Pesos
  "IDR", // Indonesia, Rupiahs
  "EUR", // Euro Member Countries
  "KRW", // Korea (South), Won
  "VND", // Viet Nam, Dong
  "MYR", // Malaysia, Ringgits
  "CNY", // China, Yuan Renminbi
  "TWD", // Taiwan, New Dollars
] as const;

export type EzpayCbCurrency = (typeof EZPAY_CB_CURRENCIES)[number];

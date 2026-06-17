/**
 * ezPay 境外電商 (CES) endpoints. Same wire format as standard ezPay
 * (`MerchantID_` + AES-encrypted `PostData_`), but issue / allowance / search
 * are cross-border-specific paths, while trigger / void / allowance-touch /
 * allowance-invalid are SHARED with the standard ezPay API. Each PostData_
 * carries the `Version` shown here.
 */
export const CB_ENDPOINTS = {
  /** 開立發票 (cross-border). */
  issue: { path: "/Api/crossBorderInvoiceIssue", version: "1.0" },
  /** 觸發開立 (shared with standard ezPay). */
  triggerIssue: { path: "/Api/invoice_touch_issue", version: "1.0" },
  /** 作廢發票 (shared). */
  void: { path: "/Api/invoice_invalid", version: "1.0" },
  /** 開立折讓 (cross-border). */
  allowance: { path: "/Api/crossBorderAllowanceIssue", version: "1.0" },
  /** 觸發確認/取消折讓 (shared, version 1.3). */
  allowanceTouch: { path: "/Api/allowance_touch_issue", version: "1.3" },
  /** 作廢折讓 (shared). */
  voidAllowance: { path: "/Api/allowanceInvalid", version: "1.0" },
  /** 查詢發票 (cross-border). */
  search: { path: "/Api/crossBorderInvoiceSearch", version: "1.0" },
} as const;

export type CrossBorderEndpointKey = keyof typeof CB_ENDPOINTS;

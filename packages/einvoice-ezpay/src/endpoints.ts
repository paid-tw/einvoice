/**
 * ezPay JSON API endpoints. The `Version` each PostData_ must carry differs per
 * endpoint. Invoice operations live under `/Api/`; the 手機條碼/愛心碼 lookups
 * live under `/Api_inv_application/` and return an AES-encrypted Result.
 */
export const ENDPOINTS = {
  issue: { path: "/Api/invoice_issue", version: "1.5" },
  touchIssue: { path: "/Api/invoice_touch_issue", version: "1.0" },
  void: { path: "/Api/invoice_invalid", version: "1.0" },
  allowance: { path: "/Api/allowance_issue", version: "1.3" },
  allowanceTouch: { path: "/Api/allowance_touch_issue", version: "1.0" },
  voidAllowance: { path: "/Api/allowanceInvalid", version: "1.0" },
  search: { path: "/Api/invoice_search", version: "1.3" },
  checkBarcode: { path: "/Api_inv_application/checkBarCode", version: "1.0" },
  checkLoveCode: { path: "/Api_inv_application/checkLoveCode", version: "1.0" },
} as const;

export type EndpointKey = keyof typeof ENDPOINTS;

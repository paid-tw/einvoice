/**
 * ezPay JSON API endpoints (under `/Api/`). The `Version` each PostData_ must
 * carry differs per endpoint (per the official spec).
 */
export const ENDPOINTS = {
  issue: { path: "/Api/invoice_issue", version: "1.5" },
  touchIssue: { path: "/Api/invoice_touch_issue", version: "1.0" },
  void: { path: "/Api/invoice_invalid", version: "1.0" },
  allowance: { path: "/Api/allowance_issue", version: "1.3" },
  allowanceTouch: { path: "/Api/allowance_touch_issue", version: "1.0" },
  voidAllowance: { path: "/Api/allowanceInvalid", version: "1.0" },
  search: { path: "/Api/invoice_search", version: "1.3" },
} as const;

export type EndpointKey = keyof typeof ENDPOINTS;

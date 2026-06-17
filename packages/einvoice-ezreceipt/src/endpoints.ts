/**
 * ezReceipt 易發票 (COIMOTION) endpoints. All are POST with a JSON body. Some take
 * an identifier in the URL PATH (the internal `invID` / `awID`, not the 發票號碼).
 */
export const ENDPOINTS = {
  /** 登入取得 access token. */
  login: "/admin/user/login",
  /** 開立發票 (all-in-one: creates the order + issues). */
  issue: "/eInvoice/invoice/issue",
  /** 查詢發票明細 (by internal invID, in the path). */
  view: (invID: string | number) => `/eInvoice/invoice/view/${invID}`,
  /** 條列發票 (paginated). */
  list: "/eInvoice/invoice/list",
  /** 作廢發票 (by invID, in the path). Body: `{ voidReason }`. */
  void: (invID: string | number) => `/eInvoice/invoice/void/${invID}`,
  /** 開立折讓證明單 (by the credited invoice's invID, in the path). */
  allowanceCreate: (invID: string | number) => `/eInvoice/allowance/create/${invID}`,
  /** 作廢折讓 (by the allowance's awID, in the path). Body: `{ voidReason }`. */
  allowanceVoid: (awID: string | number) => `/eInvoice/allowance/void/${awID}`,
  /** 字軌分段清單 (一般用戶不帶 stID；合作廠商帶 stID 查指定店家). */
  invNumberList: (stID?: string | number) => `/eInvoice/invNumber/list${stID != null ? `/${stID}` : ""}`,
} as const;

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
  /**
   * 開立折讓證明單. The credited invoice is determined PER prodList item (its
   * `soiID`, or `invID`+`title`+`taxType` for a custom line) — NOT a path id.
   */
  allowanceCreate: "/eInvoice/allowance/create",
  /** 作廢折讓 (by the allowance's awID, in the path). Body: `{ voidReason }`. */
  allowanceVoid: (awID: string | number) => `/eInvoice/allowance/void/${awID}`,
  /**
   * 確認折讓單 (by awID). Only for 交換 (msgType=2) allowances — a 存證 allowance is
   * confirmed on creation. Body: `{ allowTime? }`.
   */
  allowanceConfirm: (awID: string | number) => `/eInvoice/allowance/confirm/${awID}`,
  /** 買方確認/不同意「存證」折讓單 (非財政部標準作法). */
  allowanceBuyerConfirm: (awID: string | number) => `/eInvoice/allowance/buyerConfirm/${awID}`,
  /** 賣方確認折讓作廢 (by awID). Only for 交換 allowances — after the buyer voids it. */
  allowanceConfirmVoid: (awID: string | number) => `/eInvoice/allowance/confirmVoid/${awID}`,
  /** 折讓單明細 (by awID). Body: `{ byOperator? }`. */
  allowanceView: (awID: string | number) => `/eInvoice/allowance/view/${awID}`,
  /** 條列折讓單 (filters: invNo / awNo / isVoid / msgType / …, paginated). */
  allowanceList: "/eInvoice/allowance/list",
  /** 修改折讓單品項 (by awID; replaces all items). 交換 allowances only, before confirm. */
  allowanceUpdateItems: (awID: string | number) => `/eInvoice/allowance/updateItems/${awID}`,
  /** 字軌分段清單 (一般用戶不帶 stID；合作廠商帶 stID 查指定店家). */
  invNumberList: (stID?: string | number) => `/eInvoice/invNumber/list${stID != null ? `/${stID}` : ""}`,
  /** 調整字軌分段的起始/結束號碼 (by inID). Body: `{ startNo?, endNo? }`. */
  invNumberAdjustNo: (inID: string | number) => `/eInvoice/invNumber/adjustNo/${inID}`,
  /** 開啟/關閉字軌分段 (by inID). Body: `{ action }` (1 close / 0 open). */
  invNumberClose: (inID: string | number) => `/eInvoice/invNumber/close/${inID}`,
  /** 設定字軌印製發票的商標 (by inID). Body: `{ sgoID }` (null clears it). */
  invNumberSetLogo: (inID: string | number) => `/eInvoice/invNumber/setLogo/${inID}`,
  /** 字軌分段 (by inID; closed tracks only). Body: `{ startNo, bizType?, memo? }`. */
  invNumberSplit: (inID: string | number) => `/eInvoice/invNumber/split/${inID}`,
  /** 異動分段字軌資訊 (by inID). Body: `{ bizType?, platform?, memo? }` (in-use → memo only; platform once-only). */
  invNumberUpdate: (inID: string | number) => `/eInvoice/invNumber/update/${inID}`,
} as const;

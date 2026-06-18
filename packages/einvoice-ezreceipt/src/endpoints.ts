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
  /** 各品項尚餘可折讓的數量/金額 (by invID). */
  allowQuota: (invID: string | number) => `/eInvoice/invoice/allowQuota/${invID}`,
  /** 作廢發票 (by invID, in the path). Body: `{ voidReason }`. */
  void: (invID: string | number) => `/eInvoice/invoice/void/${invID}`,
  /** 確認交換(msgType=2)發票 (by invID). Body: `{ action, buyerRemark? }`. */
  invoiceReply: (invID: string | number) => `/eInvoice/invoice/reply/${invID}`,
  /** 註銷發票 (by invID) — distinct from 作廢/void. Body: `{ revokeReason, revokeTime? }`. */
  invoiceRevoke: (invID: string | number) => `/eInvoice/invoice/revoke/${invID}`,
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
  /** 排程折讓事件的 email 通知. Body: `{ awList, eventType, forceToBuyer? }`. */
  notificationAllowance: "/eInvoice/notification/allowance",
  /** 排程發票事件的 email 通知. Body: `{ invList, eventType, forceToBuyer?, format?, action? }`. */
  notificationInvoice: "/eInvoice/notification/invoice",
  /** 取得折讓單列印檔 (PDF/ZIP — binary, not JSON). Body: `{ awList, isZipped?, format? }`. */
  proofAwPrint: "/eInvoice/proof/awPrint",
  /** 取得列印發票所需的資料 (by invID) — JSON: barcode / QR / logo / prodList. */
  proofInvInfo: (invID: string | number) => `/eInvoice/proof/invInfo/${invID}`,
  /** 取得發票列印檔 (PDF/ZIP — binary). Body: `{ invList, isCopy?, isZipped?, format?, printTime?, device? }`. */
  proofInvPrint: "/eInvoice/proof/invPrint",
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
  /** 設為預設字軌 (by inID). Body: `{ isForGUINo? }` (true 有統編 / false 無統編). */
  settingsDefaultGUINo: (inID: string | number) => `/eInvoice/settings/defaultGUINo/${inID}`,
  /** 商標識別碼清單 → `{ list: [{ sgoID }] }`. */
  settingsListLogo: "/eInvoice/settings/listLogo",
  /** 讀取商標圖檔 (by sgoID) — BINARY image. Body: `{ w?, h?, maxw?, maxh? }`. */
  settingsViewLogo: (sgoID: string | number) => `/eInvoice/settings/viewLogo/${sgoID}`,
} as const;

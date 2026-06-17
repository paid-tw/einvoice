/**
 * Every documented Amego JSON endpoint, grouped by area.
 * Source: https://invoice.amego.tw/api_doc/.
 */
export const ENDPOINTS = {
  // 發票 (invoice)
  issue: "/json/f0401", // 開立發票 (自動配號)
  issueCustom: "/json/f0401_custom", // 開立發票 (自訂配號)
  void: "/json/f0501", // 作廢發票
  invoiceQuery: "/json/invoice_query", // 發票查詢
  invoiceList: "/json/invoice_list", // 發票列表
  invoicePrint: "/json/invoice_print", // 發票列印
  invoiceFile: "/json/invoice_file", // 發票檔案
  invoiceStatus: "/json/invoice_status", // 發票狀態

  // 折讓 (allowance)
  allowance: "/json/g0401", // 開立折讓
  voidAllowance: "/json/g0501", // 作廢折讓
  allowanceQuery: "/json/allowance_query", // 折讓查詢
  allowanceList: "/json/allowance_list", // 折讓列表
  allowancePrint: "/json/allowance_print", // 折讓列印
  allowanceFile: "/json/allowance_file", // 折讓檔案
  allowanceStatus: "/json/allowance_status", // 折讓狀態

  // 中獎 (lottery)
  lotteryStatus: "/json/lottery_status", // 中獎發票
  lotteryType: "/json/lottery_type", // 獎項定義

  // 字軌 (number track — self-numbering merchants)
  trackAll: "/json/track_all", // 所有字軌資料
  trackGet: "/json/track_get", // 字軌取號
  trackStatus: "/json/track_status", // 字軌狀態

  // 其他 (misc)
  banQuery: "/json/ban_query", // 公司名稱查詢
  barcode: "/json/barcode", // 手機條碼查詢
  time: "/json/time", // 伺服器時間
} as const;

export type EndpointKey = keyof typeof ENDPOINTS;

/** 字軌狀態 codes returned by `track_status` / `track_all`. */
export const TRACK_STATUS = {
  IN_USE: 1, // 使用
  DISABLED: 2, // 停用
  EXPIRED: 3, // 過期
  EXHAUSTED: 9, // 用畢
} as const;
export type TrackStatus = (typeof TRACK_STATUS)[keyof typeof TRACK_STATUS];

/** `track_all` tree layers. */
export const TRACK_LAYER = {
  MOF: 1, // 財政部配給的字軌
  AMEGO: 2, // 給光貿用的字軌
  LIST: 3, // 發票字軌列表的內容
} as const;

/** `track_all` leaf 配號方式. */
export const TRACK_CATEGORY = {
  AUTO: 1, // 自動配號
  API: 2, // API 配號
} as const;

/** `track_all` leaf 字軌來源. */
export const TRACK_SOURCE = {
  SYSTEM_IMPORT: 1, // 系統匯入
  MANUAL: 2, // 人工輸入
} as const;

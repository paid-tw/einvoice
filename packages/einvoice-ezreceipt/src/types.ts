// Public types for the ezReceipt adapter (extension surfaces beyond the unified
// InvoiceProvider). Re-exported from the package root.

/** One used/unused number range within a 字軌 segment's `usage`. */
export interface InvoiceTrackUsage {
  startNo: number;
  endNo: number;
  /** -1 非易發票使用 / 0 未使用 / 1 已使用. */
  status: number;
}

/** One 字軌 segment (分段字軌) from {@link EzreceiptProvider.listInvoiceTracks}. */
export interface InvoiceTrack {
  /** 字軌識別碼 (inID) — key for {@link EzreceiptProvider.adjustInvoiceTrack}. */
  inID: number;
  /** 期別 YYYYMM (起始月). */
  period: string;
  /** 字軌名稱, e.g. `"SX"`. */
  lead: string;
  /** 起始 8-digit 號碼. */
  startNo: number;
  /** 結束 8-digit 號碼. */
  endNo: number;
  /** 字軌類別: 7 一般稅額 / 8 特種稅額. */
  invType: number;
  /** 0 不限 / 1 無統編 / 2 有統編. */
  bizType: number;
  /** 備註. */
  memo?: string | null;
  /** 是否已關閉 (0/1). */
  isClosed: number;
  /** 0 使用中 / 1 未來期別 / 2 過期 / 3 用盡 (不可開啟). */
  closedCode?: number;
  /** 字軌所屬平台 (1 易發票 / 100 其他 / null 未設定). */
  platform: number | null;
  /** 商標識別碼. */
  sgoID?: number | null;
  /** 空白號碼上傳財政部的時間. */
  uploadTime?: string | null;
  /** 上傳狀態: -2 未知錯誤 / -1 處理中 / 0 成功 / 1 合約到期 / 51 字軌授權到期. */
  resultCode?: number;
  /** 各號碼區間的使用狀況. */
  usage?: InvoiceTrackUsage[];
  /** 最後修改者 ({ userID, dspName 膩稱 }). */
  modifier?: { userID?: number; dspName?: string | null } | null;
  /** 最後修改日期. */
  modifyTime?: string | null;
}

/** Filters for {@link EzreceiptProvider.listInvoiceTracks}. */
export interface ListInvoiceTracksInput {
  /** 期別 YYYYMM. Defaults to the current period. */
  period?: string;
  /** 7 一般稅額 / 8 特種稅額. */
  invType?: 7 | 8;
  /** 0 不限 / 1 無統編 / 2 有統編. */
  bizType?: 0 | 1 | 2;
  /** Strict-match the `bizType` (forceBiz=true). */
  forceBiz?: boolean;
  /** Only the currently-open 字軌 (isActive=1). */
  activeOnly?: boolean;
  /** Only tracks used on a platform: 1 易發票 / 100 其他. */
  platform?: 1 | 100;
  /** Sort order by 字軌 year/month/number. `"DESC"` (default) / `"ASC"`. */
  order?: "ASC" | "DESC";
  /** Page number (1-based). */
  page?: number;
  /** Page size (default 10). */
  pageSize?: number;
}

/** Filters for {@link EzreceiptProvider.listInvoices}. period (or fromTime/toTime) is required by the API. */
export interface ListInvoicesInput {
  /**
   * 期別 YYYYMM — a BIMONTHLY code starting on an ODD month (01=Jan–Feb,
   * 03=Mar–Apr, 05=May–Jun, …); e.g. June 2026 → `"202605"`, not `"202606"`.
   * Defaults to the current period; ignored when fromTime is set.
   */
  period?: string;
  /** Issue-time range start `YYYY-MM-DD HH:mm:ss` (overrides period). */
  fromTime?: string;
  /** Issue-time range end `YYYY-MM-DD HH:mm:ss`. */
  toTime?: string;
  /** Field to filter on; append `%` to propValue for a partial match. */
  prop?: "invNo" | "nid" | "orderNo" | "boNo" | "devNo" | "winNo" | "accName" | "extID" | "storeName" | "storeNID" | "carrierInfo" | "buyerName";
  /** Value for {@link prop}. */
  propValue?: string;
  /** 1 會員 / 2 手機條碼 / 3 自然人憑證 / 5 捐贈 / 10 紙本 / 20 境外. */
  carrierType?: 1 | 2 | 3 | 5 | 10 | 20;
  /** Only voided (true) / only non-voided (false). */
  voided?: boolean;
  /** 1 存證 / 2 交換. */
  msgType?: 1 | 2;
  /** Has 統編 (true) / no 統編 (false). */
  withUbn?: boolean;
  /** Page number (1-based). */
  page?: number;
  /** Page size (default 10). */
  pageSize?: number;
}

/** A public business/organisation record from {@link EzreceiptProvider.lookupBusiness}. */
export interface BusinessInfo {
  /** 1 稅籍登記 / 2 非營利事業團體 / 3 全國各級學校. */
  compType: number;
  nid: string;
  name: string;
  /** 登記地址 — only for 稅籍登記 (compType 1). */
  addr?: string;
  /** 所在地區 — only for 非營利團體 / 學校 (compType 2/3). */
  district?: string;
}

/** Everything needed to print a paper proof, from {@link EzreceiptProvider.getInvoicePrintInfo}. */
export interface InvoicePrintInfo {
  invNo: string;
  /** 期別 YYYYMM (bimonthly, odd start month). */
  period: string;
  randNo: string;
  /** Only when the print setting includes the order number. */
  orderNo?: string;
  invoiceTime: string;
  /** 未稅銷售總額. */
  salesAmount: number;
  taxAmount: number;
  /** 一維條碼 data. */
  barCode: string;
  /** 左二維條碼 data. */
  qrCodeL: string;
  /** 右二維條碼 data. */
  qrCodeR: string;
  sellerNID: string;
  /** Only when the invoice carries a 統編. */
  buyerNID?: string;
  remark?: string;
  /** base64 logo when the 字軌 uses one (then title1/title2 are omitted). */
  logoEncoded?: string;
  /** 自訂抬頭 line 1 (falls back to the store name). */
  title1?: string;
  title2?: string;
  /** Seller address / phone — only when the print setting includes them. */
  addr?: string;
  phone?: string;
  prodList: Array<{ title: string; qty: number; sales: number; saleTax: number; taxType: number }>;
}

/** One line's remaining creditable (折讓) quota from {@link EzreceiptProvider.getAllowanceQuota}. */
export interface AllowanceQuotaItem {
  /** 原發票品項識別碼 (soiID) — use it in an allowance's prodList. */
  soiID: number;
  /** 商品編號. */
  prodNo?: string | null;
  /** 商品名稱. */
  title?: string | null;
  /** 建議數量 (not strictly enforced by the tax authority). */
  qty: number;
  /** 尚餘可折讓金額 (未稅). */
  amount: number;
  /** 尚餘可折讓稅額. */
  tax: number;
}

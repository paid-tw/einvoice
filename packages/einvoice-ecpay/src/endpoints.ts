/**
 * ECPay B2C 電子發票 2.0 endpoints (all under `/B2CInvoice/`). Every request is
 * the same envelope `{ MerchantID, RqHeader: { Timestamp }, Data }`; only the
 * path and the inner Data payload differ.
 */
export const ENDPOINTS = {
  issue: "/B2CInvoice/Issue", // 一般開立
  delayIssue: "/B2CInvoice/DelayIssue", // 延遲(預約/觸發待開)開立
  editDelayIssue: "/B2CInvoice/EditDelayIssue", // 編輯延遲開立
  triggerIssue: "/B2CInvoice/TriggerIssue", // 觸發延遲開立
  cancelDelayIssue: "/B2CInvoice/CancelDelayIssue", // 取消延遲開立
  invalid: "/B2CInvoice/Invalid", // 作廢
  voidWithReIssue: "/B2CInvoice/VoidWithReIssue", // 註銷重開
  allowance: "/B2CInvoice/Allowance", // 一般開立折讓(紙本, 隔日上傳, 立即可作廢)
  allowanceByCollegiate: "/B2CInvoice/AllowanceByCollegiate", // 線上折讓(買方 email 點連結確認)
  allowanceInvalid: "/B2CInvoice/AllowanceInvalid", // 作廢折讓(已確認)
  allowanceInvalidByCollegiate: "/B2CInvoice/AllowanceInvalidByCollegiate", // 取消線上折讓(買方確認前)
  getIssue: "/B2CInvoice/GetIssue", // 查詢開立(單筆)
  getIssueList: "/B2CInvoice/GetIssueList", // 查詢多筆(分頁, 回應 Data 為未加密 JSON)
  getAllowance: "/B2CInvoice/GetAllowance", // 查詢折讓(單筆)
  getAllowanceList: "/B2CInvoice/GetAllowanceList", // 查詢折讓明細(Data 加密)
  getInvalid: "/B2CInvoice/GetInvalid", // 查詢作廢
  getAllowanceInvalid: "/B2CInvoice/GetAllowanceInvalid", // 查詢作廢折讓
  checkBarcode: "/B2CInvoice/CheckBarcode", // 手機條碼驗證
  checkLoveCode: "/B2CInvoice/CheckLoveCode", // 愛心碼驗證
  getCompanyNameByTaxID: "/B2CInvoice/GetCompanyNameByTaxID", // 統一編號驗證 + 公司名稱
  invoiceNotify: "/B2CInvoice/InvoiceNotify", // 發送通知
  invoicePrint: "/B2CInvoice/InvoicePrint", // 列印
  getInvoiceWordSetting: "/B2CInvoice/GetInvoiceWordSetting", // 查詢字軌
  getGovInvoiceWordSetting: "/B2CInvoice/GetGovInvoiceWordSetting", // 查詢財政部配號結果
  updateInvoiceWordStatus: "/B2CInvoice/UpdateInvoiceWordStatus", // 設定字軌號碼狀態
} as const;

export type EndpointKey = keyof typeof ENDPOINTS;

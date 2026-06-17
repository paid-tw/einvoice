/**
 * ECPay B2C 電子發票 2.0 endpoints (all under `/B2CInvoice/`). Every request is
 * the same envelope `{ MerchantID, RqHeader: { Timestamp }, Data }`; only the
 * path and the inner Data payload differ.
 */
export const ENDPOINTS = {
  issue: "/B2CInvoice/Issue", // 一般開立
  delayIssue: "/B2CInvoice/DelayIssue", // 延遲(預約/觸發待開)開立
  triggerIssue: "/B2CInvoice/TriggerIssue", // 觸發延遲開立
  cancelDelayIssue: "/B2CInvoice/CancelDelayIssue", // 取消延遲開立
  invalid: "/B2CInvoice/Invalid", // 作廢
  voidWithReIssue: "/B2CInvoice/VoidWithReIssue", // 註銷重開
  allowance: "/B2CInvoice/AllowanceByCollegiate", // 協議折讓(賣方自行)
  allowanceOnline: "/B2CInvoice/AllowanceOnline", // 線上折讓(買方確認)
  allowanceInvalid: "/B2CInvoice/AllowanceInvalid", // 作廢折讓
  getIssue: "/B2CInvoice/GetIssue", // 查詢開立
  getAllowance: "/B2CInvoice/GetAllowance", // 查詢折讓
  getInvalid: "/B2CInvoice/GetInvalid", // 查詢作廢
  getAllowanceInvalid: "/B2CInvoice/GetAllowanceInvalid", // 查詢作廢折讓
  checkBarcode: "/B2CInvoice/CheckBarcode", // 手機條碼驗證
  checkLoveCode: "/B2CInvoice/CheckLoveCode", // 愛心碼驗證
  checkUnifiedBusinessNo: "/B2CInvoice/CheckUnifiedBussinesNo", // 統編驗證 (ECPay's spelling)
  invoiceNotify: "/B2CInvoice/InvoiceNotify", // 發送通知
  invoicePrint: "/B2CInvoice/InvoicePrint", // 列印
} as const;

export type EndpointKey = keyof typeof ENDPOINTS;

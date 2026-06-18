// Public types + wire-code maps for the ECPay adapter. The interfaces/type
// aliases are re-exported from the package root; the const maps are internal.
import type { Carrier, InvoiceItem, IssueInvoiceInput } from "@paid-tw/einvoice";
import type { EcpayResult } from "./client.js";

/** 字軌狀態: 停用 / 暫停 / 啟用. */
export type EcpayWordStatus = "DISABLE" | "PAUSE" | "ENABLE";
export const WORD_STATUS_CODE: Record<EcpayWordStatus, number> = { DISABLE: 0, PAUSE: 1, ENABLE: 2 };

/** A 字軌's use status (UseStatus 1–6). */
export type EcpayWordTrackStatus =
  | "INACTIVE" // 1 未啟用
  | "IN_USE" // 2 使用中
  | "DISABLED" // 3 已停用
  | "PAUSED" // 4 暫停中
  | "PENDING_REVIEW" // 5 待審核
  | "REJECTED"; // 6 審核不通過
export const TRACK_STATUS: Record<number, EcpayWordTrackStatus> = {
  1: "INACTIVE",
  2: "IN_USE",
  3: "DISABLED",
  4: "PAUSED",
  5: "PENDING_REVIEW",
  6: "REJECTED",
};
export const TRACK_STATUS_CODE: Record<EcpayWordTrackStatus, number> = {
  INACTIVE: 1,
  IN_USE: 2,
  DISABLED: 3,
  PAUSED: 4,
  PENDING_REVIEW: 5,
  REJECTED: 6,
};

/** A merchant 字軌 from 查詢字軌 (GetInvoiceWordSetting). */
export interface EcpayWordTrack {
  /** 字軌號碼ID (use with {@link EcpayProvider.setInvoiceWordStatus}). */
  trackId: string;
  /** 發票年度 (民國年). */
  year: string;
  /** 期別 1–6. */
  term: number;
  /** 07 一般稅額 / 08 特種稅額. */
  invType: string;
  /** 字軌名稱, e.g. `"JU"`. */
  header: string;
  /** 起始 / 結束 8-digit 發票號碼. */
  start: string;
  end: string;
  /** 目前已使用號碼 (可空). */
  currentNumber: string;
  status: EcpayWordTrackStatus;
  /** 產品服務別代號 (多組字軌時). */
  productServiceId?: string;
}

/** Filter for 查詢字軌 (GetInvoiceWordSetting). */
export interface GetWordSettingInput {
  /** 發票年度 (民國年, e.g. "115"). */
  invoiceYear: string;
  /** 期別 1–6; omit for all. */
  term?: number;
  /** Use status; omit for all. */
  useStatus?: EcpayWordTrackStatus;
  invType?: "07" | "08";
  invoiceHeader?: string;
  productServiceId?: string;
}

/** One allocated invoice-number range (字軌) from 查詢財政部配號結果. */
export interface EcpayWordSetting {
  /** 期別 1–6 (1=1-2月, 2=3-4月, …). */
  term: number;
  /** 字軌類別: 07 一般稅額 / 08 特種稅額. */
  invType: string;
  /** 發票字軌, e.g. `"GI"`. */
  header: string;
  /** 起始 8-digit 發票號碼 (尾數 00/50). */
  start: string;
  /** 結束 8-digit 發票號碼 (尾數 49/99). */
  end: string;
  /** 申請本數 (1 本 = 50 numbers). */
  count: number;
}

/** Result of {@link EcpayProvider.allowanceOnline} (線上折讓, pending buyer confirmation). */
export interface OnlineAllowanceResult {
  /** 折讓單號 — pending until the buyer confirms via the email link. */
  allowanceNumber: string;
  invoiceNumber: string;
  /** When the online allowance was created (IA_TempDate). */
  createdAt: Date;
  /** The buyer must confirm before this (72h, IA_TempExpireDate). */
  expiresAt: Date;
  /** 折讓剩餘金額. */
  remainingAmount: number;
  raw: EcpayResult;
}

/** What to notify about (→ ECPay `InvoiceTag`). */
export type NotifyTag =
  | "ISSUE" // I 發票開立
  | "VOID" // II 發票作廢
  | "ALLOWANCE" // A 折讓開立
  | "ALLOWANCE_VOID" // AI 折讓作廢
  | "AWARD" // AW 發票中獎
  | "ONLINE_ALLOWANCE"; // OA 線上折讓
export const NOTIFY_TAG: Record<NotifyTag, string> = {
  ISSUE: "I",
  VOID: "II",
  ALLOWANCE: "A",
  ALLOWANCE_VOID: "AI",
  AWARD: "AW",
  ONLINE_ALLOWANCE: "OA",
};
export const NOTIFY_METHOD = { SMS: "S", EMAIL: "E", BOTH: "A" } as const;
export const NOTIFY_RECIPIENT = { CUSTOMER: "C", MERCHANT: "M", BOTH: "A" } as const;

/** Input for {@link EcpayProvider.sendNotification} (發送發票通知). */
export interface SendNotifyInput {
  invoiceNumber: string;
  /** Required when `tag` is ALLOWANCE / ALLOWANCE_VOID / ONLINE_ALLOWANCE. */
  allowanceNumber?: string;
  tag: NotifyTag;
  /** Channel. `ONLINE_ALLOWANCE` must use `"EMAIL"`. */
  method: keyof typeof NOTIFY_METHOD;
  /** Recipient. `ONLINE_ALLOWANCE` must use `"CUSTOMER"`. */
  recipient: keyof typeof NOTIFY_RECIPIENT;
  /** At least one of email / phone is required. */
  email?: string;
  phone?: string;
}

/** Print layout (→ ECPay `PrintStyle`). B2B styles require an invoice with a 統編. */
export type PrintStyle = "SINGLE" | "DOUBLE" | "THERMAL" | "B2B_A4" | "B2B_A5";
export const PRINT_STYLE: Record<PrintStyle, number> = {
  SINGLE: 1,
  DOUBLE: 2,
  THERMAL: 3,
  B2B_A4: 4,
  B2B_A5: 5,
};

/** Input for {@link EcpayProvider.getPrintUrl} (發票列印). */
export interface PrintInvoiceInput {
  invoiceNumber: string;
  /** `yyyy-MM-dd` (or `yyyy/MM/dd`). Defaults to today (Asia/Taipei). */
  invoiceDate?: string;
  /** Layout; defaults to `SINGLE`. */
  style?: PrintStyle;
  /** Show the line-item detail. B2B / 統編 invoices always show it. */
  showDetail?: boolean;
  /** Stamp the print as 補印 (電子發票證明聯補印). Ignored for B2B styles. */
  reprint?: boolean;
}

/** Input for {@link EcpayProvider.voidWithReissue} (註銷重開). */
export interface VoidReissueInput {
  /** Original invoice number to void. */
  invoiceNumber: string;
  /** Reason for voiding (≤20 chars). */
  voidReason: string;
  /** Original issue time (`yyyy-MM-dd HH:mm:ss`, or a Date) — must match the original. */
  invoiceDate: string | Date;
  /** The reissue payload — same shape as `issue()`; `orderId` must be the original RelateNumber. */
  reissue: IssueInvoiceInput;
}

/** Result of {@link EcpayProvider.voidWithReissue} — keeps the original number/date. */
export interface VoidReissueResult {
  invoiceNumber: string;
  invoiceDate: Date;
  randomCode: string;
  raw: EcpayResult;
}

/** Detail of a voided invoice from {@link EcpayProvider.getInvalid} (查詢作廢發票明細). */
export interface InvalidDetail {
  invoiceNumber: string; // II_Invoice_No
  /** 作廢時間 (II_Date). */
  voidedAt: Date;
  reason: string; // Reason
  uploaded: boolean; // II_Upload_Status
  uploadedAt?: Date; // II_Upload_Date
  sellerUbn?: string; // II_Seller_Identifier
  buyerUbn?: string; // II_Buyer_Identifier
  raw: Record<string, unknown>;
}

/** Detail of a voided allowance from {@link EcpayProvider.getAllowanceInvalid} (查詢作廢折讓明細). */
export interface InvalidAllowanceDetail {
  allowanceNumber: string; // AI_Allow_No
  invoiceNumber: string; // AI_Invoice_No
  /** 折讓單日期 (AI_Allow_Date). */
  allowanceDate: Date;
  /** 作廢時間 (AI_Date). */
  voidedAt: Date;
  reason: string; // Reason
  uploaded: boolean; // AI_Upload_Status
  uploadedAt?: Date; // AI_Upload_Date
  sellerUbn?: string; // AI_Seller_Identifier
  buyerUbn?: string; // AI_Buyer_Identifier
  raw: Record<string, unknown>;
}

/** Lookup for {@link EcpayProvider.getAllowanceList} (查詢折讓明細). */
export interface GetAllowanceListInput {
  /** 折讓編號 — SearchType 0. */
  allowanceNumber?: string;
  /** 發票號碼 — SearchType 1/2 (needs `date`). */
  invoiceNumber?: string;
  /** yyyy-MM-dd — the invoice's issue date (dateType ISSUE) or allowance date (ALLOWANCE). */
  date?: string;
  /** `"ISSUE"` (SearchType 1, default) or `"ALLOWANCE"` (SearchType 2). */
  dateType?: "ISSUE" | "ALLOWANCE";
}

/** One row from {@link EcpayProvider.getAllowanceList}. */
export interface AllowanceDetail {
  allowanceNumber: string; // IA_Allow_No
  invoiceNumber: string; // IA_Invoice_No
  allowanceDate: Date; // IA_Date
  invoiceIssueDate: Date; // IA_Invoice_Issue_Date
  voided: boolean; // IA_Invalid_Status
  uploaded: boolean; // IA_Upload_Status
  taxType: string; // IA_Tax_Type
  /** 不含稅進貨額 (IA_Total_Amount). */
  amount: number;
  taxAmount: number; // IA_Tax_Amount
  /** 含稅折讓總額 (IA_Total_Tax_Amount). */
  totalAmount: number;
  ubn?: string; // IA_Identifier
  customerName?: string; // IIS_Customer_Name
  notifyMail?: string; // IA_Send_Mail
  notifyPhone?: string; // IA_Send_Phone
  items: InvoiceItem[];
  raw: Record<string, unknown>;
}

/** Filter for {@link EcpayProvider.listInvoices} (查詢多筆發票). */
export interface ListInvoicesInput {
  /** 查詢起始日期 yyyy-MM-dd (by issue date). */
  beginDate: string;
  /** 查詢結束日期 yyyy-MM-dd. */
  endDate: string;
  /** 單頁筆數 (≤200; recommend ≤30). Default 30. */
  numPerPage?: number;
  /** 頁數 (1-based). Default 1. Sorted newest issue date first. */
  page?: number;
  /** Raw ECPay `Query_*` filters, passed through (e.g. `{ Query_Invalid: "1" }`). */
  filters?: Record<string, string | number>;
}

/** One row from {@link EcpayProvider.listInvoices}. */
export interface InvoiceListItem {
  invoiceNumber: string;
  orderId: string;
  ubn?: string;
  category: string; // B2B / B2C
  taxType: string;
  taxAmount: number;
  salesAmount: number; // 含稅 total
  createdAt: Date;
  voided: boolean;
  uploaded: boolean;
  remainingAllowance: number;
  raw: Record<string, unknown>;
}

/** A page of {@link EcpayProvider.listInvoices} results. */
export interface InvoiceListPage {
  /** Total rows across all pages (use to drive pagination). */
  totalCount: number;
  page: number;
  invoices: InvoiceListItem[];
}

/** Outcome of {@link EcpayProvider.triggerIssue} (觸發開立). */
export interface TriggerIssueResult {
  /** `true` when issued immediately (4000004); `false` when it will auto-issue after the delay (4000003). */
  issued: boolean;
  /** The assigned 發票號碼 — present only when `issued` is true. */
  invoiceNumber?: string;
  invoiceDate?: Date;
  randomCode?: string;
  relateNumber: string;
  raw: EcpayResult;
}

/** Options for {@link EcpayProvider.issuePending} (延遲開立). */
export interface IssuePendingOptions {
  /** `"SCHEDULE"` (預約, auto-issues after delayDay) or `"TRIGGER"` (待觸發, default). */
  mode?: "SCHEDULE" | "TRIGGER";
  /** Delay days. SCHEDULE: 1–15 (default 1). TRIGGER: 0–15 (default 0). */
  delayDay?: number;
  /** Production callback URL fired when the invoice issues (no-op on stage). */
  notifyUrl?: string;
  /** PayAct override (default `"ECPAY"`). */
  payAct?: string;
}

/** Unified carrier type → ECPay CarrierType (空=紙本/1=綠界/2=自然人/3=手機). */
export const CARRIER_TYPE: Record<Carrier["type"], string> = {
  MEMBER: "1",
  CITIZEN_CERTIFICATE: "2",
  MOBILE_BARCODE: "3",
};

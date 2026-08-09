// Synthetic canned responses for the ezPay backend (shapes mirror cinv test data,
// values are fake). Response envelopes are `{ status, message, result }`.

export const SEARCH_SUCCESS = {
  status: "SUCCESS",
  message: "",
  result: {
    InvoiceCount: 12,
    Page: 2,
    NowPage: 1,
    Limit: 10,
    InvoiceData: [
      {
        II_Invoice_Number: "CC00000068",
        II_Check_Num: "007A",
        II_Random_Num: "6700",
        II_Com_UBN: "12345678",
        II_Com_Name: "測試商店",
        II_Merchant_ID: "10000001",
        II_User_Name: "Test Buyer",
        II_User_Email: "buyer@example.com",
        II_Category: "B2C",
        II_Tax_Amt: "136",
        II_Amt: "2,714",
        II_Total_Amt: "2,850",
        II_Invoice_Status: "1",
        II_Upload_Status: "1",
        II_Carruer_Type: "2",
        II_Create_Date: "2026-08-05 16:48:22",
        post_data: "aa11bb22cc33",
      },
    ],
  },
};

export const SEARCH_PAGE2 = {
  status: "SUCCESS",
  message: "",
  result: { InvoiceCount: 12, Page: 2, NowPage: 2, Limit: 10, InvoiceData: [{ II_Invoice_Number: "CC00000058", post_data: "dd44ee55" }] },
};

export const SEARCH_EMPTY = { status: "MOD10003", message: "查無資料", result: [] };
export const RANGE_TOO_LONG = { status: "INV20002", message: "查詢區間過長", result: [] };
export const SESSION_EXPIRED = { status: "KEY10008", message: "", result: "https://backend.test/main/Login_center/single_login" };

export const DETAIL_SUCCESS = {
  status: "SUCCESS",
  message: "",
  result: {
    Issue: {
      II_Invoice_Number: "CC00000068",
      II_Check_Num: "007A",
      II_Random_Num: "6700",
      II_Com_UBN: "12345678",
      II_User_Name: "Test Buyer",
      II_Total_Amt: "2,850",
      II_Item_Detail: JSON.stringify([{ Name: "課程", Qty: "1", Price: "2850" }]),
    },
    Notify: [
      { IN_Type: "1", IN_Notice_Status: "1", IN_Email: "buyer@example.com", IN_Phone: "", IN_Create_Date: "2026-08-05 16:48:25" },
      { IN_Type: "1", IN_Notice_Status: "2", IN_Email: "buyer2@example.com", IN_Phone: "", IN_Create_Date: "2026-08-06 09:00:00" },
    ],
    Allowance: [],
    Invalid: "",
    Allowance_Invalid: "",
  },
};

export const NOTICE_SUCCESS = {
  status: "SUCCESS",
  message: "",
  result: {
    invoice: { invoiceNumber: "CC00000068", invoiceType: "1", Post_data: "aa11bb22cc33" },
    notice: [
      { IN_Invoice_Number: "CC00000068", IN_Type: "1", IN_Notice_Status: "1", IN_Email: "buyer@example.com", IN_Phone: "", IN_Create_Date: "2026-08-05 16:48:25" },
    ],
  },
};

export const RESEND_SUCCESS = { status: "SUCCESS", message: "已重新寄送發票通知", result: [] };

export const CSV_HEADER =
  "商店代號,商店中文名稱,ezPay電子發票開立序號,商店自訂編號,發票號碼,買受人統編,買受人名稱,買受人E-mail,買受人地址,防偽隨機碼,發票類別,課稅別,稅額,銷售額(不含稅),發票金額,幣別,發票備註,開立發票時間,上傳發票時間,載具類別,捐贈碼,是否捐贈,是否作廢,是否折讓,目前可折讓金額,發票通知,IP位址 ";
export const CSV_ROW =
  '"10000001",測試商店,"26080516482244466","DEM2608058D7C68740F2",CC00000068,"-","Test Buyer","buyer@example.com","-","6700",B2C,應稅,136,2714,2850,TWD,"","2026-08-05 16:48:22","2026-08-05 16:48:22",ezPay電子發票載具,-,否,否,是,0,"-",203.0.113.1';
export const CSV_SUCCESS = `${CSV_HEADER}\n${CSV_ROW}\n`;
// No-data export: ezPay dumps a PHP print_r of the error into the file.
export const CSV_EMPTY = `${CSV_HEADER}\nArray\n(\n    [status] => INV10017\n    [message] => 查無資料\n    [result] => Array\n        (\n        )\n\n)\n`;

export const EXPECTED_CAPTCHA = "ABCDE";

// ---- 列印電子發票 / PDF ----
export const PRINT_LIST_SUCCESS = {
  status: "SUCCESS",
  message: "查詢成功",
  result: {
    InvoiceCount: 5,
    Page: 1,
    NowPage: 1,
    InvoiceData: [
      { II_Invoice_Number: "CC00000059", II_Category: "B2C", II_Print: "2", II_User_Name: "Test Buyer", post_data: "listtoken123" },
    ],
  },
};
export const PRINT_BY_DB_SUCCESS = {
  status: "SUCCESS",
  message: "列印發票確認",
  result: { First: "", FirstCount: "", Printed: ["CC00000059"], PrintedCount: 1, PostData: "combinedtoken456" },
};
// A wrong MemPW returns an HTML page carrying KEY10016 instead of a PDF.
export const PRINT_KEY10016_HTML = "<html><body>請輸入企業會員密碼 錯誤代碼：KEY10016</body></html>";
// Minimal well-formed-enough PDF (only the %PDF- magic matters to the client).
export const FAKE_PDF = "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n";
export const EXPECTED_MEMPW = "s3cr3t-p@ss"; // == the makeClient login password

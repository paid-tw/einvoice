/**
 * Real Amego API responses captured from the live sandbox, used as MSW fixtures
 * so the offline suite matches production payloads exactly (field names, nesting,
 * unix vs YYYYMMDD dates, snake_case data blocks).
 */

export const ISSUE_OK = {
  code: 0,
  msg: "",
  invoice_number: "AA26513024",
  invoice_time: 1781650039,
  random_number: "7081",
  barcode: "11506AA265130247081",
  qrcode_left: "AA265130241150617708100000064000000692808062312345678...==:**********:1:1:0:",
  qrcode_right: "**測試商品:1:105",
};

export const INVOICE_QUERY_OK = {
  code: 0,
  msg: "",
  data: {
    invoice_number: "AA26513024",
    invoice_type: "C0401",
    invoice_status: 1,
    invoice_date: 20260617,
    invoice_time: "06:47:19",
    buyer_identifier: "28080623",
    buyer_name: "光貿科技有限公司",
    buyer_address: "",
    buyer_email_address: "",
    sales_amount: 100,
    free_tax_sales_amount: 0,
    zero_tax_sales_amount: 0,
    tax_type: 1,
    tax_rate: "0.05",
    tax_amount: 5,
    total_amount: 105,
    random_number: "7081",
    carrier_type: "",
    npoban: "",
    cancel_date: 0,
    order_id: "LC1781650039",
    detail_vat: 1,
    product_item: [
      { tax_type: 1, description: "測試商品", unit_price: 105, quantity: 1, unit: "", amount: 105, remark: "" },
    ],
    allowance: [],
  },
};

export const INVOICE_STATUS_OK = {
  code: 0,
  msg: "",
  data: [{ invoice_number: "AA26513024", type: "C0401", status: 1, total_amount: 105 }],
};

/** g0401 success returns no allowance number — the supplied one is the id. */
export const ALLOWANCE_OK = { code: 0, msg: "" };

export const ALLOWANCE_STATUS_OK = {
  code: 0,
  msg: "",
  data: [{ allowance_number: "ALW1781650040", type: "D0401", status: 1, tax_amount: 5, total_amount: 100 }],
};

export const ALLOWANCE_QUERY_OK = {
  code: 0,
  msg: "",
  data: {
    allowance_number: "ALW1781650040",
    invoice_type: "D0401",
    allowance_date: 20260617,
    allowance_type: 2,
    buyer_identifier: "28080623",
    tax_amount: 5,
    total_amount: 100,
    cancel_date: 0,
    product_item: [
      {
        original_invoice_number: "AA26513024",
        original_invoice_date: 20260617,
        tax_type: 1,
        description: "測試商品",
        unit_price: 100,
        quantity: 1,
        amount: 100,
        tax: 5,
      },
    ],
  },
};

export const INVOICE_LIST_OK = {
  code: 0,
  msg: "",
  page_total: 299,
  page_now: 1,
  data_total: 5968,
  data: [
    {
      invoice_number: "AA26505593",
      invoice_type: "C0401",
      invoice_status: 99,
      invoice_date: 20260601,
      invoice_time: "09:50:59",
      total_amount: 105,
    },
  ],
};

/**
 * Real f0401_custom success, captured live (invoice EE00006850, allocated via
 * track_get). Unlike f0401, the response is a `data[]` array (one entry per
 * uploaded invoice) and carries NO invoice_time / random_number — those are
 * merchant-supplied.
 */
export const CUSTOM_ISSUE_OK = {
  code: 0,
  msg: "",
  data: [
    {
      invoice_number: "EE00006850",
      barcode: "11506EE000068504321",
      qrcode_left: "EE000068501150617432100000064000000690000000012345678goMz1DO3V133QXLaMhZpDQ==:**********:1:1:0:",
      qrcode_right: "**自訂配號測試:1:105",
      base64_data: "",
    },
  ],
};

/** Real track_all response (Year 2026, Period 2) — nested 3-layer tree. */
export const TRACK_ALL_OK = {
  code: 0,
  msg: "",
  data: [
    {
      layer: 1,
      code: "AA",
      start: "00000000",
      end: "00009999",
      total_booklet: 200,
      data: [
        {
          layer: 2,
          code: "AA",
          start: "00000000",
          end: "00009999",
          total_booklet: 200,
          data: [
            {
              layer: 3,
              category: 1,
              code: "AA",
              start: "00000000",
              end: "00009999",
              now: "00000009",
              total_booklet: 200,
              remark: "",
              TrackApiCode: "FSM",
              source: 2,
              status: 1,
            },
          ],
        },
      ],
    },
  ],
};

/** Real track_get success (allocates a 50-number booklet). data is an OBJECT. */
export const TRACK_GET_OK = {
  code: 0,
  msg: "",
  data: { code: "EE", start: "00006850", end: "00006899" },
};

/** Real track_status response (Year 2026, Period 2) — current-period API tracks. */
export const TRACK_STATUS_OK = {
  code: 0,
  msg: "",
  data: [
    { code: "EE", start: "00000000", end: "00009999", now: "00006849", total_booklet: 200, used_booklet: 137, status: 1 },
    { code: "EF", start: "00000000", end: "00009999", now: "", total_booklet: 200, used_booklet: 0, status: 1 },
    { code: "IT", start: "62008000", end: "62009099", now: "62009099", total_booklet: 22, used_booklet: 22, status: 3 },
  ],
};

export const VOID_OK = { code: 0, msg: "" };
export const BAN_QUERY_OK = {
  code: 0,
  msg: "",
  data: [{ ban: "28080623", name: "光貿科技股份有限公司" }],
};
/** Real GET /json/time response (no `code` envelope). */
export const TIME_OK = {
  timestamp: 1781654751,
  text: "2026/06/17 08:05:51",
  year: 2026,
  month: 6,
  day: 17,
  hour: 8,
  minute: 5,
  second: 51,
};

/** Real error envelopes (code !== 0), captured live by sending invalid values. */
export const ERR_VOID_NOT_ARRAY = { code: 3050112, msg: "此 API 支援傳輸多張發票，data 欄位資料應為陣列字串" };
export const ERR_QUERY_NO_TYPE = { code: 31, msg: "type 查詢類型不存在" };
export const ERR_ALREADY_ALLOWANCE = { code: 3050141, msg: "AA26513024 已存在折讓單" };
export const ERR_BUYER_NAME = { code: 3040123, msg: "BuyerName 不可為空或過長" };
export const ERR_BUYER_ID_LEN = { code: 3040121, msg: "BuyerIdentifier 字數錯誤" };
export const ERR_BUYER_ID_FMT = { code: 3040122, msg: "BuyerIdentifier 格式錯誤" };
export const ERR_ITEM_TAXTYPE = { code: 3040144, msg: "第1品項 TaxType 錯誤" };
export const ERR_DETAILVAT = { code: 3040162, msg: "只有打統編發票， 才可以用未稅單價及小計" };
export const ERR_ZERORATE_CCM = { code: 3040179, msg: "若為零稅率發票，通關方式註記必填" };
export const ERR_CARRIER = { code: 3040132, msg: "載具號碼不存在" };
export const ERR_NPOBAN = { code: 3040137, msg: "NPOBAN 不存在" };
export const ERR_CUSTOM_INVOICEDATE = { code: 99, msg: "第1筆 發票號碼AA00000010 InvoiceDate 錯誤", data: [] };

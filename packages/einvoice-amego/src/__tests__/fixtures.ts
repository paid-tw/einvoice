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
    print_mark: "Y",
    main_remark: "",
    customs_clearance_mark: 0,
    cancel_date: 0,
    invoice_lottery: 0,
    order_id: "LC1781650039",
    detail_vat: 1,
    detail_amount_round: 0,
    create_date: 1781650039,
    product_item: [
      {
        tax_type: 1,
        description: "測試商品",
        unit_price: 105,
        quantity: 1,
        unit: "",
        amount: 105,
        remark: "",
      },
    ],
    wait: [],
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

/** Real allowance_list response (one row) — amounts are 未稅 + separate tax. */
export const ALLOWANCE_LIST_OK = {
  code: 0,
  msg: "",
  page_total: 16,
  page_now: 1,
  data_total: 302,
  data: [
    {
      allowance_number: "AA26507438_001",
      invoice_type: "D0401",
      invoice_status: 99,
      allowance_date: 20260601,
      allowance_type: 2,
      buyer_identifier: "0000000000",
      buyer_name: "客戶",
      tax_amount: 41,
      total_amount: 819, // 未稅
      cancel_date: 0,
      create_date: 1780293784,
      product_item: [
        {
          original_invoice_date: 20260601,
          original_invoice_number: "AA26507438",
          tax_type: 1,
          description: "怪獸OK!益生菌",
          unit_price: 819,
          quantity: 1,
          unit: "",
          amount: 819,
          tax: 41,
        },
      ],
    },
  ],
};

export const ALLOWANCE_STATUS_OK = {
  code: 0,
  msg: "",
  data: [
    {
      allowance_number: "ALW1781650040",
      type: "D0401",
      status: 1,
      tax_amount: 5,
      total_amount: 100,
    },
  ],
};

/**
 * Real allowance_query response (nested `data`). Captured live — includes the
 * `wait[]` schedule (here a pending D0501 void) and amounts that are 未稅 + tax.
 */
export const ALLOWANCE_QUERY_OK = {
  code: 0,
  msg: "",
  data: {
    allowance_number: "ALW1781650040",
    invoice_type: "D0401",
    invoice_status: 1,
    allowance_date: 20260617,
    allowance_type: 2,
    buyer_identifier: "28080623",
    buyer_name: "光貿科技有限公司",
    buyer_zip: 0,
    buyer_address: "",
    buyer_telephone_number: "",
    buyer_email_address: "",
    tax_amount: 5,
    total_amount: 100, // 未稅
    cancel_date: 0,
    detail_vat: 0,
    create_date: 1781650040,
    product_item: [
      {
        original_invoice_number: "AA26513024",
        original_invoice_date: 20260617,
        tax_type: 1,
        description: "測試商品",
        unit_price: 100,
        quantity: 1,
        unit: "",
        amount: 100,
        tax: 5,
      },
    ],
    wait: [{ invoice_type: "D0501", create_date: 1781650041 }],
  },
};

/** Real invoice_list response (one full row), captured live. */
export const INVOICE_LIST_OK = {
  code: 0,
  msg: "",
  page_total: 303,
  page_now: 1,
  data_total: 6041,
  data: [
    {
      invoice_number: "AA26505593",
      invoice_type: "C0401",
      invoice_status: 99,
      invoice_date: 20260601,
      invoice_time: "09:50:59",
      buyer_identifier: "28080623",
      buyer_name: "光貿科技股份有限公司",
      buyer_zip: 404,
      buyer_address: "進化北路238號14樓之5",
      sales_amount: 66,
      free_tax_sales_amount: 0,
      zero_tax_sales_amount: 0,
      tax_type: 1,
      tax_rate: "0.05",
      tax_amount: 3,
      total_amount: 69,
      print_mark: "Y",
      random_number: "1711",
      main_remark: "如需作廢發票，請於5號前通知~",
      customs_clearance_mark: 0,
      zero_tax_rate_reason: 0,
      carrier_type: "",
      carrier_id1: "",
      carrier_id2: "",
      npoban: "",
      cancel_date: 0,
      invoice_lottery: 0,
      order_id: "202605260953542841",
      create_date: 1779760433,
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
      qrcode_left:
        "EE000068501150617432100000064000000690000000012345678goMz1DO3V133QXLaMhZpDQ==:**********:1:1:0:",
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
    {
      code: "EE",
      start: "00000000",
      end: "00009999",
      now: "00006849",
      total_booklet: 200,
      used_booklet: 137,
      status: 1,
    },
    {
      code: "EF",
      start: "00000000",
      end: "00009999",
      now: "",
      total_booklet: 200,
      used_booklet: 0,
      status: 1,
    },
    {
      code: "IT",
      start: "62008000",
      end: "62009099",
      now: "62009099",
      total_booklet: 22,
      used_booklet: 22,
      status: 3,
    },
  ],
};

/**
 * lottery_status (winning invoices) response. The envelope `{code:0, data:[]}` is
 * verified live (the sandbox merchant has no winners); the winning-row shape is
 * from the official spec (`type` references the lottery_type definitions).
 */
export const LOTTERY_STATUS_OK = {
  code: 0,
  msg: "",
  data: [
    { invoice_date: "20220819", invoice_number: "DF73530001", type: "22" },
    { invoice_date: "20220819", invoice_number: "DF73530002", type: "18" },
  ],
};
export const LOTTERY_STATUS_EMPTY = { code: 0, msg: "", data: [] };

/** Real lottery_type response (prize-type definitions). Takes no request data. */
export const LOTTERY_TYPE_OK = {
  code: 0,
  msg: "",
  data: [
    { type: 11, name: "特別獎(1,000萬)" },
    { type: 12, name: "特獎(200萬元)" },
    { type: 13, name: "頭獎(20萬元)" },
  ],
};

/** Real invoice_file success — `data.file_url` (link valid 10 minutes). */
export const FILE_URL_OK = {
  code: 0,
  msg: "",
  data: {
    file_url:
      "https://invoice.amego.tw/user/invoice_print_type?token=1781657356_65e6f89b3ed08441931fc647eab8e6a0&type=0",
  },
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
export const ERR_VOID_NOT_ARRAY = {
  code: 3050112,
  msg: "此 API 支援傳輸多張發票，data 欄位資料應為陣列字串",
};
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
export const ERR_CUSTOM_INVOICEDATE = {
  code: 99,
  msg: "第1筆 發票號碼AA00000010 InvoiceDate 錯誤",
  data: [],
};

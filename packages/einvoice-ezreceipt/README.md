# @paid-tw/einvoice-ezreceipt

[![npm version](https://img.shields.io/npm/v/@paid-tw/einvoice-ezreceipt.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ezreceipt)
[![npm downloads](https://img.shields.io/npm/dm/@paid-tw/einvoice-ezreceipt.svg)](https://www.npmjs.com/package/@paid-tw/einvoice-ezreceipt)
[![types: TypeScript](https://img.shields.io/npm/types/@paid-tw/einvoice-ezreceipt.svg)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/npm/l/@paid-tw/einvoice-ezreceipt.svg)](https://github.com/paid-tw/einvoice/blob/main/LICENSE)

[English](./README.en.md) ｜ **繁體中文**

[`@paid-tw/einvoice`](https://www.npmjs.com/package/@paid-tw/einvoice) 的
[ezReceipt 易發票](https://www.ezreceipt.cc/)（底層為 **COIMOTION** 平台）轉接器。
與其他加密 form-post 的供應商不同，ezReceipt 是**訂單導向的 REST + JSON** API、採
**token 認證**。

```bash
pnpm add @paid-tw/einvoice @paid-tw/einvoice-ezreceipt
```

```ts
import { createEzreceiptProvider } from "@paid-tw/einvoice-ezreceipt";

const invoices = createEzreceiptProvider({
  appCode: process.env.EZRECEIPT_APPCODE!, // x-deva-appcode（統編）
  appKey: process.env.EZRECEIPT_APPKEY!, // x-deva-appkey
  accName: process.env.EZRECEIPT_ACCNAME!, // 專用 API 帳號
  password: process.env.EZRECEIPT_PASSWORD!, // 明文 —— 送出前在本地雜湊
  mode: "TEST", // tryapi 主機；"PRODUCTION" → api 主機
});

await invoices.issue({ /* IssueInvoiceInput */ });
```

## 認證（已自動處理）

每次呼叫都會帶 `x-deva-appcode` + `x-deva-appkey`；特權操作另需 `x-deva-token`。
client 會延遲登入（`sha1(sha1(accName)+password)`，明文不離開程式）、**快取 token**，
並在遇到 **`-3 Invalid token` 時自動重新登入一次**。

> ⚠️ **請使用專用的 API 帳號**。COIMOTION 每個帳號只允許一組有效 token，因此 API
> 登入會讓同帳號的後台網頁 session 失效（反之亦然）。請給整合程式自己的 `accName`。

## 運作方式（已於測試環境實機驗證）

| 項目 | 說明 |
| --- | --- |
| 傳輸 | `POST` JSON 至 `{host}{endpoint}`；回應 `{ code, message, value }`（`code 0` 為成功）。 |
| 開立 | all-in-one 的 `eInvoice/invoice/issue` —— 訂單由 `prodList` 隱式建立（只有 `prodList` 必要，`order` 選用）。 |
| 識別 | 操作以內部 `invID` / `awID` 為鍵（非發票號碼）。provider 會用 `invoice/list` 由發票號碼解析 invID，或你也可傳 `providerOptions.invID`（開立結果的 `raw.id`）省去查詢。 |
| 金額 | 稅額由平台計算（`trCode` 0 = 5%）；`prodList[].sales` 為單價，`incTax` 依 `priceMode`。 |

## 各項操作

```ts
// 開立 —— B2C（會員載具）、B2B（統編）、捐贈、手機條碼、混合稅率…
const inv = await invoices.issue({
  orderId: "ORDER_1",
  buyer: { name: "買受人", email: "m@x.com" },
  items: [{ description: "商品", quantity: 1, unitPrice: 100, amount: 100 }],
  amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
  taxType: "TAXABLE",
  priceMode: "TAX_EXCLUSIVE",
  carrier: { type: "MEMBER", code: "member_001" },
});

await invoices.query({ invoiceNumber: inv.invoiceNumber }); // 以發票號碼解析 invID
await invoices.void({ invoiceNumber: inv.invoiceNumber, reason: "客戶取消" });

const al = await invoices.allowance({
  invoiceNumber: inv.invoiceNumber,
  allowanceId: "A1",
  items: [{ description: "商品", quantity: 1, unitPrice: 100, amount: 100 }],
  amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
});
await invoices.voidAllowance({
  invoiceNumber: inv.invoiceNumber,
  allowanceNumber: al.allowanceNumber,
  providerOptions: { awID: (al.raw as { awID: number }).awID },
});
```

- **B2B**：傳入 `buyer.ubn` → 對應到 `issueTo`（不需載具）。
- **捐贈**：傳入 `donation.npoban` → carrierType 5。
- **混合稅率**：設定逐項 `taxType`（應稅 / 零稅率 / 免稅）。

## 能力

`ISSUE` · `VOID` · `ALLOWANCE` · `VOID_ALLOWANCE` · `QUERY` · `B2B` · `MIXED_TAX`。

未宣告：`FOREIGN_CURRENCY`（真正的境外電商 / carrierType 20 需要境外電商類型帳號 ——
一般帳號會回 `1052`）、`SCHEDULED_ISSUE`、`CARRIER_VALIDATION`。

## 設定

| 選項 | 必填 | 說明 |
| --- | --- | --- |
| `appCode` | ✅ | `x-deva-appcode`（統一編號 / app code） |
| `appKey` | ✅ | `x-deva-appkey` |
| `accName` | ✅ | 登入帳號（專用 API 帳號） |
| `password` | ✅* | 明文登入密碼（*或改提供已取得的 `token`） |
| `token` | | 已取得的 access token，可跳過登入 |
| `stID` | | 合作廠商用的店家代號（`x-deva-stid`） |
| `mode` | | `"TEST"`（預設，`tryapi`）或 `"PRODUCTION"`（`api`） |
| `validatePayload` | | 在本地端驗證開立 payload（預設 `true`） |

補充：字軌「配號」（取得發票號碼區段）**只能在後台操作** —— API 僅能管理既有字軌。
實機測試以 `EZRECEIPT_LIVE=1` 對專用 API 帳號執行。

## 授權條款

MIT

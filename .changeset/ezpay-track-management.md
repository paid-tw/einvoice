---
"@paid-tw/einvoice-ezpay": minor
---

Add the ezPay 字軌管理 API as `provider.track`: `create` (新增字軌), `setStatus` (暫停/啟用/停用), and `search` (字軌查詢). These endpoints are keyed by the platform member, so they need the new `companyId` config option (會員編號, `CompanyID_`), plus `companyHashKey`/`companyHashIV` when the member keys differ from the store's. Each returned range's CheckCode is verified (`HashIv` variant, per EZP_Track 附件二).

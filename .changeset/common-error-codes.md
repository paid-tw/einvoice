---
"@paid-tw/einvoice-amego": patch
---

Map the remaining 通用/系統 error codes: `13` (status 未啟用), `19` (公司停權), and
`22` (尚未申請 API 串接) → AUTH (alongside 11/12/14/15/16); `10` (維護中), `18`
(無法建立資料庫連線), `21` (人數過多) → PROVIDER (transient, retry later). A test
locks in the full common code family (10–23).

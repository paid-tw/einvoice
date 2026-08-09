// MSW mock of the ezPay 加值中心 backend + helpers, mirroring the monorepo's
// per-adapter src/__tests__/server.ts pattern.
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ezpayUrls, webBaseDecode } from "../lib.ts";
import { EzpayBackendClient } from "../client.ts";
import * as fx from "./fixtures.ts";

export const TEST_BASE = "https://backend.test/";
export const u = ezpayUrls(TEST_BASE);

/** Decode a POST body's `send_data_` back into the inner name/value pairs. */
export function decodeSendData(body: string): URLSearchParams {
  const outer = new URLSearchParams(body).get("send_data_") ?? "";
  return new URLSearchParams(webBaseDecode(outer));
}

/** Records the last decoded payload the server saw, per endpoint, for assertions. */
export const captured: Record<string, URLSearchParams> = {};
async function capture(key: string, request: Request): Promise<URLSearchParams> {
  const decoded = decodeSendData(await request.text());
  captured[key] = decoded;
  return decoded;
}
export function resetCaptured() {
  for (const k of Object.keys(captured)) delete captured[k];
}

export const handlers = [
  // ---- login handshake ----
  http.get(u.loginPage, () =>
    HttpResponse.html("<html>login</html>", { headers: { "Set-Cookie": "PHPSESSID=testsid123; path=/" } }),
  ),
  http.get(u.captcha, () => HttpResponse.arrayBuffer(new Uint8Array([137, 80, 78, 71]).buffer, { headers: { "Content-Type": "image/png" } })),
  http.post(u.loginCheck, async ({ request }) => {
    const p = await capture("login", request);
    const code = p.get("CheckCode");
    if (code !== fx.EXPECTED_CAPTCHA) {
      return HttpResponse.html(
        `<script>alert("圖形驗證碼錯誤 (正確應為：${fx.EXPECTED_CAPTCHA})");location.href="${u.loginPage}?postData=deadbeef";</script>`,
      );
    }
    return new HttpResponse(null, {
      status: 302,
      headers: { Location: `${u.base}main/Login_notice/noticeCheck`, "Set-Cookie": "inv_login_company_infocom=authcookie; path=/" },
    });
  }),

  // ---- authenticated JSON endpoints ----
  http.post(u.searchByDb, async ({ request }) => {
    const p = await capture("search", request);
    // send_search_invoice appends a trailing &NowPage=n, so the last value wins.
    return HttpResponse.json(p.getAll("NowPage").at(-1) === "2" ? fx.SEARCH_PAGE2 : fx.SEARCH_SUCCESS);
  }),
  http.post(u.detailByDb, async ({ request }) => {
    await capture("detail", request);
    return HttpResponse.json(fx.DETAIL_SUCCESS);
  }),
  http.post(u.noticeByDb, async ({ request }) => {
    await capture("notice", request);
    return HttpResponse.json(fx.NOTICE_SUCCESS);
  }),
  http.post(u.createNotice, async ({ request }) => {
    await capture("resend", request);
    return HttpResponse.json(fx.RESEND_SUCCESS);
  }),

  // ---- print / PDF ----
  http.post(u.printListByDb, async ({ request }) => {
    await capture("printList", request);
    return HttpResponse.json(fx.PRINT_LIST_SUCCESS);
  }),
  http.post(u.printByDb, async ({ request }) => {
    await capture("printBy", request);
    return HttpResponse.json(fx.PRINT_BY_DB_SUCCESS);
  }),
  http.post(u.invoicePrint, async ({ request }) => {
    const p = await capture("invoicePrint", request);
    if (p.get("MemPW") !== fx.EXPECTED_MEMPW) return HttpResponse.html(fx.PRINT_KEY10016_HTML);
    return new HttpResponse(new TextEncoder().encode(fx.FAKE_PDF), { headers: { "Content-Type": "application/pdf" } });
  }),

  // ---- CSV export ----
  http.post(u.searchCsv, async ({ request }) => {
    await capture("csv", request);
    return new HttpResponse(fx.CSV_SUCCESS, {
      headers: {
        "Content-Type": "text/x-csv;charset=UTF-8",
        "Content-Disposition": "attachment; filename=ezPay_Invoice_20260808100457.csv;",
      },
    });
  }),
];

export const server = setupServer(...handlers);

/** A client wired to the mock base with valid test credentials. */
export function makeClient(overrides: Partial<ConstructorParameters<typeof EzpayBackendClient>[0]> = {}) {
  return new EzpayBackendClient({
    baseUrl: TEST_BASE,
    ubn: "12345678",
    account: "tester",
    password: "s3cr3t-p@ss",
    ...overrides,
  });
}

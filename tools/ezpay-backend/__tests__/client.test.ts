import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server, u, captured, resetCaptured, makeClient, decodeSendData } from "./server.ts";
import { EzpayBackendError } from "../client.ts";
import { webBaseDecode, webBaseEncode, buildSendData } from "../lib.ts";
import * as fx from "./fixtures.ts";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  resetCaptured();
});
afterAll(() => server.close());

describe("login (captcha-leak handshake)", () => {
  it("logs in by reading the leaked code and resubmitting", async () => {
    const client = makeClient();
    await client.login();

    expect(client.loggedIn).toBe(true);
    // credentials were send_data_-encoded correctly (incl. the '@' in the password)
    expect(captured.login.get("LoginUBN")).toBe("12345678");
    expect(captured.login.get("Account")).toBe("tester");
    expect(captured.login.get("Password")).toBe("s3cr3t-p@ss");
    // final submit carried the leaked code
    expect(captured.login.get("CheckCode")).toBe(fx.EXPECTED_CAPTCHA);
    // both session + auth cookies were absorbed
    expect(client.cookieHeader()).toContain("PHPSESSID=testsid123");
    expect(client.cookieHeader()).toContain("inv_login_company_infocom=authcookie");
  });

  it("uses a provided captchaSolver instead of the leak (single submit)", async () => {
    const solver = vi.fn(() => fx.EXPECTED_CAPTCHA);
    const client = makeClient({ captchaSolver: solver });
    await client.login();

    expect(client.loggedIn).toBe(true);
    expect(solver).toHaveBeenCalledOnce();
    expect(solver.mock.calls[0][0]).toBeInstanceOf(Uint8Array); // received the PNG bytes
  });

  it("throws with the server's alert message when the captcha is wrong", async () => {
    const client = makeClient({ captchaSolver: () => "WRONG" });
    await expect(client.login()).rejects.toThrowError(/圖形驗證碼錯誤/);
    expect(client.loggedIn).toBe(false);
  });
});

describe("searchInvoices", () => {
  it("parses a SUCCESS page and encodes the query", async () => {
    const client = makeClient();
    const res = await client.searchInvoices({ startInvDate: "2026-08-01", endInvDate: "2026-08-31", invoiceStatus: "1" });

    expect(res.status).toBe("SUCCESS");
    expect(res.count).toBe(12);
    expect(res.limit).toBe(10);
    expect(res.rows[0].II_Invoice_Number).toBe("CC00000068");
    // query round-trips through send_data_
    expect(captured.search.get("StartInvDate")).toBe("2026-08-01");
    expect(captured.search.get("EndInvDate")).toBe("2026-08-31");
    expect(captured.search.get("InvoiceStatus")).toBe("1");
    expect(captured.search.getAll("NowPage").at(-1)).toBe("1");
  });

  it("treats MOD10003 as an empty result (not an error)", async () => {
    server.use(http.post(u.searchByDb, () => HttpResponse.json(fx.SEARCH_EMPTY)));
    const res = await makeClient().searchInvoices({ startInvDate: "2026-07-01", endInvDate: "2026-07-31" });
    expect(res.status).toBe("MOD10003");
    expect(res.rows).toEqual([]);
    expect(res.count).toBe(0);
  });

  it("throws on a range-too-long (INV20002)", async () => {
    server.use(http.post(u.searchByDb, () => HttpResponse.json(fx.RANGE_TOO_LONG)));
    await expect(makeClient().searchInvoices({ startInvDate: "2026-01-01", endInvDate: "2026-12-31" })).rejects.toMatchObject({
      name: "EzpayBackendError",
      status: "INV20002",
    });
  });

  it("searchAllInvoices follows pagination", async () => {
    const rows = await makeClient().searchAllInvoices({ startInvDate: "2026-08-01", endInvDate: "2026-08-31" });
    expect(rows.map((r) => r.II_Invoice_Number)).toEqual(["CC00000068", "CC00000058"]);
    expect(captured.search.getAll("NowPage").at(-1)).toBe("2"); // last request was page 2
  });
});

describe("exportCsv", () => {
  it("returns filename + csv and marks a populated export non-empty", async () => {
    const res = await makeClient().exportCsv({ startInvDate: "2026-08-01", endInvDate: "2026-08-31" });
    expect(res.filename).toBe("ezPay_Invoice_20260808100457.csv");
    expect(res.empty).toBe(false);
    expect(res.csv).toContain("發票號碼");
    expect(res.csv).toContain("CC00000068");
    // CsvType=CSV appended by the formWork path
    expect(captured.csv.get("CsvType")).toBe("CSV");
    expect(captured.csv.get("StartInvDate")).toBe("2026-08-01");
  });

  it("detects the no-data print_r dump as empty", async () => {
    server.use(
      http.post(u.searchCsv, () =>
        new HttpResponse(fx.CSV_EMPTY, { headers: { "Content-Type": "text/x-csv;charset=UTF-8", "Content-Disposition": "attachment; filename=x.csv;" } }),
      ),
    );
    const res = await makeClient().exportCsv({ startInvDate: "2026-07-01", endInvDate: "2026-07-31" });
    expect(res.empty).toBe(true);
  });

  it("scopes to one store via SearchItem=MerID + SearchWord", async () => {
    await makeClient().exportCsv({ startInvDate: "2026-08-01", endInvDate: "2026-08-31", searchItem: "MerID", searchWord: "10000001" });
    expect(captured.csv.get("SearchItem")).toBe("MerID");
    expect(captured.csv.get("SearchWord")).toBe("10000001");
  });
});

describe("detail & notify lookups", () => {
  it("getInvoiceDetail returns Issue (codes) + Notify and sends Post_data", async () => {
    const d = await makeClient().getInvoiceDetail("aa11bb22cc33");
    expect(d.issue.II_Check_Num).toBe("007A");
    expect(d.issue.II_Random_Num).toBe("6700");
    expect(d.notify).toHaveLength(2);
    expect(d.allowance).toEqual([]);
    expect(captured.detail.get("Post_data")).toBe("aa11bb22cc33");
  });

  it("getNotifyHistory returns invoice + notice records", async () => {
    const n = await makeClient().getNotifyHistory("aa11bb22cc33");
    expect(n.invoice.invoiceNumber).toBe("CC00000068");
    expect(n.notice[0].IN_Email).toBe("buyer@example.com");
    expect(n.notice[0].IN_Notice_Status).toBe("1");
  });
});

describe("resendNotification (補發通知)", () => {
  it("sends BuyerMail + Post_data and returns the message", async () => {
    const r = await makeClient().resendNotification("aa11bb22cc33", { email: "new@example.com" });
    expect(r.message).toBe("已重新寄送發票通知");
    expect(captured.resend.get("BuyerMail")).toBe("new@example.com");
    expect(captured.resend.get("Post_data")).toBe("aa11bb22cc33");
  });

  it("includes BuyerMobile when provided", async () => {
    await makeClient().resendNotification("aa11bb22cc33", { email: "new@example.com", mobile: "0912345678" });
    expect(captured.resend.get("BuyerMobile")).toBe("0912345678");
  });

  it("validates the email before any request", async () => {
    const client = makeClient();
    await expect(client.resendNotification("x", { email: "" })).rejects.toMatchObject({ status: "VALIDATION" });
    await expect(client.resendNotification("x", { email: "a".repeat(301) })).rejects.toMatchObject({ status: "VALIDATION" });
    expect(captured.resend).toBeUndefined(); // never hit the network
  });
});

describe("monthlyStats", () => {
  it("returns per-month counts and records (not throws) empty/blocked months", async () => {
    // count 100 for 2024-01, 查無資料 for 2024-02, lookback-blocked for 2024-03
    const ranges: Array<[string, string]> = [];
    server.use(
      http.post(u.searchByDb, async ({ request }) => {
        const p = decodeSendData(await request.text());
        ranges.push([p.get("StartInvDate") ?? "", p.get("EndInvDate") ?? ""]);
        const start = p.get("StartInvDate");
        if (start === "2024-01-01") return HttpResponse.json({ status: "SUCCESS", result: { InvoiceCount: 100, Limit: 10, InvoiceData: [] } });
        if (start === "2024-02-01") return HttpResponse.json(fx.SEARCH_EMPTY); // MOD10003
        return HttpResponse.json(fx.RANGE_TOO_LONG); // INV20002 (too old / range)
      }),
    );
    const stats = await makeClient().monthlyStats("2024-01", "2024-03");
    expect(stats).toEqual([
      { month: "2024-01", count: 100, status: "SUCCESS" },
      { month: "2024-02", count: 0, status: "MOD10003" },
      { month: "2024-03", count: 0, status: "INV20002" },
    ]);
    // each query used a whole-month range
    expect(ranges).toEqual([
      ["2024-01-01", "2024-01-31"],
      ["2024-02-01", "2024-02-29"], // 2024 is a leap year
      ["2024-03-01", "2024-03-31"],
    ]);
  });

  it("streams each month via onMonth", async () => {
    const seen: string[] = [];
    await makeClient().monthlyStats("2026-01", "2026-03", { onMonth: (e) => seen.push(e.month) });
    expect(seen).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
});

describe("print / PDF (證明聯)", () => {
  it("lists printable invoices and encodes the print query", async () => {
    const r = await makeClient().listPrintableInvoices({ startInvDate: "2026-08-01", endInvDate: "2026-08-31", printMark: "" });
    expect(r.count).toBe(5);
    expect(r.rows[0].II_Invoice_Number).toBe("CC00000059");
    expect(captured.printList.get("StartInvDate")).toBe("2026-08-01");
    expect(captured.printList.get("PageLimit")).toBe("10");
    expect(captured.printList.get("Sort")).toBe("desc");
  });

  it("downloads a server-generated PDF (MemPW defaults to the login password)", async () => {
    const pdf = await makeClient().printInvoicePdf({ postDataTokens: ["listtoken123"], noPrintMark: true });
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
    // print_by_db received the list token as Postdata[]
    expect(captured.printBy.getAll("Postdata[]")).toEqual(["listtoken123"]);
    // Invoice_print received the resolved token + defaults + login password as MemPW
    expect(captured.invoicePrint.get("Post_data")).toBe("combinedtoken456");
    expect(captured.invoicePrint.get("printType")).toBe("page");
    expect(captured.invoicePrint.get("detail")).toBe("YES");
    expect(captured.invoicePrint.get("NoPrintMark")).toBe("1");
    expect(captured.invoicePrint.get("MemPW")).toBe("s3cr3t-p@ss");
  });

  it("throws a clear error when MemPW is wrong (KEY10016)", async () => {
    await expect(makeClient().printInvoicePdf({ postDataTokens: ["listtoken123"], memPw: "wrong" })).rejects.toMatchObject({
      name: "EzpayBackendError",
      status: "KEY10016",
    });
  });

  it("rejects an empty selection before any request", async () => {
    await expect(makeClient().printInvoicePdf({ postDataTokens: [] })).rejects.toMatchObject({ status: "VALIDATION" });
    expect(captured.printBy).toBeUndefined();
  });
});

describe("session expiry", () => {
  it("maps KEY10008 to an error and clears loggedIn", async () => {
    server.use(http.post(u.detailByDb, () => HttpResponse.json(fx.SESSION_EXPIRED)));
    const client = makeClient();
    await client.login();
    expect(client.loggedIn).toBe(true);
    await expect(client.getInvoiceDetail("aa11bb22cc33")).rejects.toMatchObject({ status: "KEY10008" });
    expect(client.loggedIn).toBe(false);
  });
});

describe("web_base_encode round-trip", () => {
  it("decode(encode(x)) === x for tricky strings", () => {
    for (const s of ["a=1&b=2", "p@ss w0rd!/+", "中文=值&x=~!*'()"]) {
      expect(webBaseDecode(webBaseEncode(s))).toBe(s);
    }
  });

  it("buildSendData is reversible into the login field set", () => {
    const sd = buildSendData({ LoginUBN: "12345678", Account: "admin", Password: "p@ss w0rd", backUrl: "", CheckCode: "AB12" });
    const p = new URLSearchParams(webBaseDecode(sd));
    expect(p.get("LoginUBN")).toBe("12345678");
    expect(p.get("Password")).toBe("p@ss w0rd");
    expect(p.get("CheckCode")).toBe("AB12");
  });
});

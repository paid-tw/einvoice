// Offline tests for the online query / job list transport. A fake page stands in for the
// Playwright page: its evaluate() answers by URL instead of running the in-browser fetch.
// All data is fabricated.
import { describe, expect, test } from "bun:test";
import { NatClient, NatOverLimitError, fetchAllPages, iso, jobStartsOn, parseApiResponse, type NatPage, type QuerySlice, type RawResponse } from "../nat-client.ts";

const BAN = "12345678";

function row(n: number, extra: Record<string, unknown> = {}) {
  return {
    invoiceNumber: `AB${String(n).padStart(8, "0")}`,
    invoiceDate: "20240710",
    sellerId: BAN,
    buyerId: "87654321",
    businessType: "1",
    salesAmount: 100,
    taxAmount: 5,
    totalAmount: 105,
    token: `t${n}`,
    ...extra,
  };
}

function page<T>(all: T[], index: number, size: number): NatPage<T> {
  const content = all.slice(index * size, index * size + size);
  const totalPages = Math.ceil(all.length / size);
  return {
    content,
    empty: content.length === 0,
    first: index === 0,
    last: index >= totalPages - 1,
    number: index,
    numberOfElements: content.length,
    size,
    totalElements: all.length,
    totalPages,
  };
}

/** A fake page whose evaluate() routes the in-page fetch to `handler(url)`; records URLs. */
function fakeClient(handler: (url: URL) => RawResponse) {
  const urls: URL[] = [];
  const evaluate = async (fn: unknown, arg?: { url: string }) => {
    if (!arg) return "2026-11-27"; // listJobs' "today" probe
    const url = new URL(arg.url);
    urls.push(url);
    return handler(url);
  };
  return { client: NatClient.fromPage({ evaluate } as never, BAN), urls };
}

const json = (body: unknown): RawResponse => ({ status: 200, contentType: "application/json", text: JSON.stringify(body) });
const noContent: RawResponse = { status: 204, contentType: "", text: "", alert: "INV-SELECT-0001-W", alertParams: "%5B%5D" };
// What the platform sends for a result over the 200-row online limit (seen live).
const overLimit = (total: number): RawResponse => ({
  status: 204,
  contentType: "",
  text: "",
  alert: "BTB-BTB411W-0017-W",
  alertParams: encodeURIComponent(JSON.stringify(["200", String(total)])),
});
/** The Taipei date a query's invoiceDateBegin stands for. */
const dayOf = (instant: string | null) => new Date(Date.parse(instant!) + 8 * 3_600_000).toISOString().slice(0, 10);

describe("parseApiResponse", () => {
  test("a no-data 204 (or one without an alert header) is null, not an empty object", () => {
    expect(parseApiResponse("GET", "https://x/api", noContent)).toBeNull();
    expect(parseApiResponse("GET", "https://x/api", { status: 204, contentType: "", text: "" })).toBeNull();
  });

  test("an over-limit 204 throws NatOverLimitError with the limit and the real total", () => {
    let err: unknown;
    try {
      parseApiResponse("GET", "https://x/api", overLimit(339));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NatOverLimitError);
    expect(err).toMatchObject({ limit: 200, total: 339 });
  });

  test("a 204 with an unknown alert throws instead of reading as empty", () => {
    expect(() => parseApiResponse("GET", "https://x/api", { status: 204, contentType: "", text: "", alert: "X-1-E" })).toThrow("alert X-1-E");
  });

  test("a non-JSON 200 throws with status, content-type and the first bytes", () => {
    const r = { status: 200, contentType: "text/plain;charset=UTF-8", text: "Parameter validation failed." };
    expect(() => parseApiResponse("GET", "https://x/api?secret=1", r)).toThrow(
      "NAT GET https://x/api → HTTP 200 non-JSON body (text/plain;charset=UTF-8): Parameter validation failed.",
    );
  });

  test("an empty 200 throws instead of reading as no rows", () => {
    expect(() => parseApiResponse("GET", "https://x/api", { status: 200, contentType: "", text: "" })).toThrow("empty body");
  });

  test("a non-2xx throws with status and body", () => {
    expect(() => parseApiResponse("GET", "https://x/api", { status: 403, contentType: "text/html", text: "Just a moment..." })).toThrow(
      "HTTP 403 (text/html): Just a moment...",
    );
  });
});

describe("iso", () => {
  test("sends a Taipei calendar day as its true UTC instants", () => {
    // <date>T00:00:00Z..T23:59:59Z would cover that day AND the next (verified live)
    expect(iso("2024-07-10")).toBe("2024-07-09T16:00:00.000Z");
    expect(iso("2024-07-10", true)).toBe("2024-07-10T15:59:59.999Z");
    expect(iso("2024-03-01")).toBe("2024-02-29T16:00:00.000Z");
  });

  test("jobStartsOn matches a decoded job's queryStartDate by instant", () => {
    expect(jobStartsOn({ queryStartDate: "2024-06-30T16:00:00Z" }, "2024-07-01")).toBe(true);
    expect(jobStartsOn({ queryStartDate: "2024-07-01T00:00:00Z" }, "2024-07-01")).toBe(false);
  });
});

describe("fetchAllPages", () => {
  test("rejects a short read against totalElements", async () => {
    const p = { ...page([1, 2], 0, 2), totalElements: 3 };
    await expect(fetchAllPages(async () => p, "x")).rejects.toThrow("got 2 row(s) but totalElements is 3");
  });
});

describe("NatClient.queryInvoices", () => {
  test("reads every page (81 rows at size 20 → 5 pages) with one 全部 query", async () => {
    const all = Array.from({ length: 81 }, (_, i) => row(i));
    const { client, urls } = fakeClient((u) => json(page(all, Number(u.searchParams.get("page")), 20)));
    const rows = await client.queryInvoices({ ban: BAN, from: "2024-07-10", to: "2024-07-10", invType: "2" });
    expect(rows).toHaveLength(81);
    expect(urls.map((u) => u.searchParams.get("page"))).toEqual(["0", "1", "2", "3", "4"]);
    expect(urls[0].searchParams.get("queryBusinessType")).toBe("0");
    expect(urls[0].searchParams.get("invoiceDateBegin")).toBe("2024-07-09T16:00:00.000Z");
    expect(urls[0].searchParams.get("invoiceDateEnd")).toBe("2024-07-10T15:59:59.999Z");
  });

  test("an over-limit result is split into B2B + B2C and merged (B2C rows come back as type 5)", async () => {
    const b2b = [row(1), row(2)];
    const b2c = [row(3, { businessType: "5", buyerId: "0000000000", salesAmount: 105, taxAmount: 0 })];
    const slices: QuerySlice[] = [];
    const { client, urls } = fakeClient((u) => {
      const bt = u.searchParams.get("queryBusinessType");
      return bt === "0" ? overLimit(250) : json(page(bt === "1" ? b2b : b2c, 0, 200));
    });
    const rows = await client.queryInvoices({ ban: BAN, from: "2022-12-05", to: "2022-12-05", invType: "2", onSlice: (s) => slices.push(s) });
    expect(rows.map((r) => r.invoiceNumber)).toEqual(["AB00000001", "AB00000002", "AB00000003"]);
    expect(urls.map((u) => u.searchParams.get("queryBusinessType"))).toEqual(["0", "1", "2"]);
    expect(slices.map((s) => `${s.businessType}:${s.totalElements}`)).toEqual(["1:2", "2:1"]);
  });

  test("進銷項 over the limit splits into 進項 + 銷項 first", async () => {
    const { client, urls } = fakeClient((u) => (u.searchParams.get("queryInvType") === "0" ? overLimit(300) : json(page([row(Number(u.searchParams.get("queryInvType")))], 0, 200))));
    const rows = await client.queryInvoices({ ban: BAN, from: "2024-07-10", to: "2024-07-10", invType: "0" });
    expect(rows).toHaveLength(2);
    expect(urls.map((u) => `${u.searchParams.get("queryInvType")}/${u.searchParams.get("queryBusinessType")}`)).toEqual(["0/0", "1/0", "2/0"]);
  });

  test("a single type still over the limit is bisected by day", async () => {
    // 4 days × 120 B2B rows: any 2+ day window is over 200, a single day is not
    const { client, urls } = fakeClient((u) => {
      const from = dayOf(u.searchParams.get("invoiceDateBegin"));
      const to = dayOf(u.searchParams.get("invoiceDateEnd"));
      if (u.searchParams.get("queryBusinessType") === "0") return overLimit(480);
      if (u.searchParams.get("queryBusinessType") === "2") return noContent;
      if (from !== to) return overLimit(240);
      const n = Number(from.slice(-2));
      return json(page(Array.from({ length: 120 }, (_, i) => row(n * 1000 + i)), 0, 200));
    });
    const rows = await client.queryInvoices({ ban: BAN, from: "2024-07-01", to: "2024-07-04", invType: "2" });
    expect(rows).toHaveLength(480);
    const singleDays = urls
      .filter((u) => u.searchParams.get("queryBusinessType") === "1")
      .map((u) => `${dayOf(u.searchParams.get("invoiceDateBegin"))}..${dayOf(u.searchParams.get("invoiceDateEnd"))}`);
    expect(singleDays).toEqual(["2024-07-01..2024-07-04", "2024-07-01..2024-07-02", "2024-07-01..2024-07-01", "2024-07-02..2024-07-02", "2024-07-03..2024-07-04", "2024-07-03..2024-07-03", "2024-07-04..2024-07-04"]);
  });

  test("one day of one type over the limit throws and points at exportInvoices", async () => {
    const { client } = fakeClient((u) => (u.searchParams.get("queryBusinessType") === "1" ? noContent : overLimit(625)));
    await expect(client.queryInvoices({ ban: BAN, from: "2024-07-10", to: "2024-07-10", invType: "2" })).rejects.toThrow(
      "NAT online query 2/2 on 2024-07-10 has 625 rows, over the online limit of 200 — use exportInvoices for it",
    );
  });

  test("reports a no-data 204 as no-content", async () => {
    const slices: QuerySlice[] = [];
    const { client } = fakeClient(() => noContent);
    const rows = await client.queryInvoices({ ban: BAN, from: "2024-07-10", to: "2024-07-10", invType: "2", onSlice: (s) => slices.push(s) });
    expect(rows).toEqual([]);
    expect(slices.map((s) => s.result)).toEqual(["no-content"]);
  });

  test("findInvoicesByNumber sends invoiceNumberBegin/End and matches exactly", async () => {
    const { client, urls } = fakeClient(() => json(page([row(7)], 0, 200)));
    const found = await client.findInvoicesByNumber({ ban: BAN, invoiceNumber: "AB00000007", from: "2022-07-01", to: "2022-08-31" });
    expect(found.map((r) => r.invoiceNumber)).toEqual(["AB00000007"]); // deduped across the two month windows
    expect(urls).toHaveLength(2);
    expect(urls[0].searchParams.get("invoiceNumberBegin")).toBe("AB00000007");
    expect(urls[0].searchParams.get("invoiceNumberEnd")).toBe("AB00000007");
    expect(urls[0].searchParams.has("invoiceNumberStart")).toBe(false);
  });
});

describe("NatClient.listJobs", () => {
  const job = (seqNo: number) => {
    const data = Buffer.from(JSON.stringify({ seqNo, ban: BAN, status: "2", jobType: "1", token: null })).toString("base64");
    return { token: `h.${Buffer.from(JSON.stringify({ data })).toString("base64")}.s` };
  };

  test("sends processStatus=A and decodes tokens", async () => {
    const { client, urls } = fakeClient(() => json(page([job(1), job(2)], 0, 200)));
    const jobs = await client.listJobs();
    expect(jobs.map((j) => j.seqNo)).toEqual([1, 2]);
    expect(jobs[0].token).toBe(job(1).token);
    expect(urls[0].searchParams.get("processStatus")).toBe("A");
  });

  test("204 means no jobs", async () => {
    const { client } = fakeClient(() => noContent);
    expect(await client.listAllowanceJobs()).toEqual([]);
  });

  test("a validation-error body surfaces instead of a JSON parse error", async () => {
    const { client } = fakeClient(() => ({ status: 200, contentType: "text/plain", text: "Parameter validation failed." }));
    await expect(client.listJobs()).rejects.toThrow("non-JSON body (text/plain): Parameter validation failed.");
  });
});

// Offline tests for the online query / job list transport. A fake page stands in for the
// Playwright page: its evaluate() answers by URL instead of running the in-browser fetch.
// All data is fabricated.
import { describe, expect, test } from "bun:test";
import { NatClient, fetchAllPages, iso, parseApiResponse, querySlices, type NatPage, type RawResponse } from "../nat-client.ts";

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
const noContent: RawResponse = { status: 204, contentType: "", text: "" };

describe("parseApiResponse", () => {
  test("204 is null, not an empty object", () => {
    expect(parseApiResponse("GET", "https://x/api", noContent)).toBeNull();
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
  test("keeps the local calendar date with a literal Z (the server ignores the zone)", () => {
    expect(iso("2024-07-10")).toBe("2024-07-10T00:00:00.000Z");
    expect(iso("2024-07-10", true)).toBe("2024-07-10T23:59:59.999Z");
  });
});

describe("querySlices", () => {
  test("銷項 is split into B2B + B2C; 進項 uses 全部; 進銷項 is both", () => {
    expect(querySlices("2")).toEqual([
      { invType: "2", businessType: "1" },
      { invType: "2", businessType: "2" },
    ]);
    expect(querySlices("1")).toEqual([{ invType: "1", businessType: "0" }]);
    expect(querySlices("0").map((s) => `${s.invType}/${s.businessType}`)).toEqual(["1/0", "2/1", "2/2"]);
    expect(querySlices("2", "2")).toEqual([{ invType: "2", businessType: "2" }]);
  });
});

describe("fetchAllPages", () => {
  test("rejects a short read against totalElements", async () => {
    const p = { ...page([1, 2], 0, 2), totalElements: 3 };
    await expect(fetchAllPages(async () => p, "x")).rejects.toThrow("got 2 row(s) but totalElements is 3");
  });
});

describe("NatClient.queryInvoices", () => {
  test("reads every page (81 rows at size 20 → 5 pages)", async () => {
    const all = Array.from({ length: 81 }, (_, i) => row(i));
    const { client, urls } = fakeClient((u) => {
      if (u.searchParams.get("queryBusinessType") === "2") return noContent;
      return json(page(all, Number(u.searchParams.get("page")), 20));
    });
    const rows = await client.queryInvoices({ ban: BAN, from: "2024-07-10", to: "2024-07-10", invType: "2" });
    expect(rows).toHaveLength(81);
    const b2b = urls.filter((u) => u.searchParams.get("queryBusinessType") === "1");
    expect(b2b.map((u) => u.searchParams.get("page"))).toEqual(["0", "1", "2", "3", "4"]);
    expect(b2b[0].searchParams.get("invoiceDateBegin")).toBe("2024-07-10T00:00:00.000Z");
  });

  test("merges the B2B and B2C slices for 銷項 and never sends businessType 0", async () => {
    const b2b = [row(1), row(2)];
    const b2c = [row(3, { businessType: "5", buyerId: "0000000000", salesAmount: 105, taxAmount: 0 })];
    const slices: unknown[] = [];
    const { client, urls } = fakeClient((u) => json(page(u.searchParams.get("queryBusinessType") === "1" ? b2b : b2c, 0, 200)));
    const rows = await client.queryInvoices({ ban: BAN, from: "2022-12-05", to: "2022-12-05", invType: "2", onSlice: (s) => slices.push(s) });
    expect(rows.map((r) => r.invoiceNumber)).toEqual(["AB00000001", "AB00000002", "AB00000003"]);
    expect(urls.map((u) => u.searchParams.get("queryBusinessType"))).toEqual(["1", "2"]);
    expect(slices).toEqual([
      { invType: "2", businessType: "1", result: "rows", totalElements: 2 },
      { invType: "2", businessType: "2", result: "rows", totalElements: 1 },
    ]);
  });

  test("reports a 204 slice as no-content", async () => {
    const slices: Array<{ result: string }> = [];
    const { client } = fakeClient(() => noContent);
    const rows = await client.queryInvoices({ ban: BAN, from: "2024-07-10", to: "2024-07-10", invType: "2", onSlice: (s) => slices.push(s) });
    expect(rows).toEqual([]);
    expect(slices.map((s) => s.result)).toEqual(["no-content", "no-content"]);
  });

  test("findInvoicesByNumber sends invoiceNumberBegin/End and matches exactly", async () => {
    const { client, urls } = fakeClient((u) =>
      json(page(u.searchParams.get("queryBusinessType") === "1" ? [row(7)] : [], 0, 200)),
    );
    const found = await client.findInvoicesByNumber({ ban: BAN, invoiceNumber: "AB00000007", from: "2022-07-01", to: "2022-07-01" });
    expect(found.map((r) => r.invoiceNumber)).toEqual(["AB00000007"]);
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

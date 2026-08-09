import { describe, expect, test } from "bun:test";
import { NatClient } from "../nat-client.ts";
import { chunkRange, monthEnd } from "../nat-verify.ts";

describe("monthEnd", () => {
  test("handles 31/30-day months and leap February", () => {
    expect(monthEnd("2026-01")).toBe("2026-01-31");
    expect(monthEnd("2026-04")).toBe("2026-04-30");
    expect(monthEnd("2024-02")).toBe("2024-02-29");
    expect(monthEnd("2025-02")).toBe("2025-02-28");
  });
});

describe("chunkRange", () => {
  test("a single month is one chunk spanning that month", () => {
    expect(chunkRange("2025-12")).toEqual([{ from: "2025-12-01", to: "2025-12-31" }]);
  });

  test("an even span packs two months per job (the API's range limit)", () => {
    expect(chunkRange("2024-06..2024-07")).toEqual([{ from: "2024-06-01", to: "2024-07-31" }]);
  });

  test("an odd span leaves a one-month tail chunk", () => {
    expect(chunkRange("2024-11..2025-01")).toEqual([
      { from: "2024-11-01", to: "2024-12-31" },
      { from: "2025-01-01", to: "2025-01-31" },
    ]);
  });

  test("rejects malformed ranges", () => {
    expect(() => chunkRange("2024-6")).toThrow("bad range");
    expect(() => chunkRange("2024-06..07")).toThrow("bad range");
  });

  test("rejects out-of-bounds months instead of yielding zero chunks", () => {
    expect(() => chunkRange("2024-00")).toThrow("not 01-12");
    expect(() => chunkRange("2024-13")).toThrow("not 01-12");
    expect(() => chunkRange("2024-01..2024-13")).toThrow("not 01-12");
  });

  test("rejects a reversed range instead of yielding zero chunks", () => {
    expect(() => chunkRange("2025-01..2024-12")).toThrow("start 2025-01 is after end 2024-12");
  });
});

describe("NatClient.decodeDataToken", () => {
  test("decodes a btb list token (JWT payload → base64 data → JSON)", () => {
    const fields = { invoiceNumber: "AB12345678", totalAmount: 105, extStatus: "2" };
    const data = Buffer.from(JSON.stringify(fields)).toString("base64");
    const payload = Buffer.from(JSON.stringify({ data })).toString("base64");
    const token = `x.${payload}.y`;

    expect(NatClient.decodeDataToken(token)).toEqual(fields);
  });

  test("decodeJobToken delegates to the same decoding", () => {
    const job = { status: "2", seqNo: 7, dataCount: "3" };
    const data = Buffer.from(JSON.stringify(job)).toString("base64");
    const payload = Buffer.from(JSON.stringify({ data })).toString("base64");

    expect(NatClient.decodeJobToken(`x.${payload}.y`)).toEqual(job as never);
  });
});

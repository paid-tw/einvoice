import { describe, expect, test } from "bun:test";
import { dedupeNatInvoices, isMonthFinal, monthChunkRange, NatClient, type NatInvoice } from "../nat-client.ts";

describe("NatClient.parseNatCsv", () => {
  test("preserves quoted commas, escaped quotes, and multiline fields", () => {
    const csv = [
      "M,發票號碼,買方統一編號,賣方統一編號,課稅別,總備註",
      "D,發票號碼,品名,單一欄位備註",
      'M,AB12345678,12345678,87654321,應稅,"first line\nsecond line"',
      'D,AB12345678,"顧問服務,進階方案","customer said ""ok"""',
      "",
    ].join("\r\n");

    const invoices = NatClient.parseNatCsv(new TextEncoder().encode(csv));

    expect(invoices).toHaveLength(1);
    expect(invoices[0]["課稅別"]).toBe("應稅");
    expect(invoices[0]["總備註"]).toBe("first line\nsecond line");
    expect(invoices[0].items).toEqual([
      { 發票號碼: "AB12345678", 品名: "顧問服務,進階方案", 單一欄位備註: 'customer said "ok"' },
    ]);
  });

  test("repairs an unquoted comma in the portal's buyer-name field", () => {
    const csv = [
      "M,發票號碼,買方名稱,賣方統一編號,寄送日期,課稅別",
      "D,發票號碼,品名",
      "M,AB12345678,測試,分店,12345678,2026-01-02 03:04:05,應稅",
      "D,AB12345678,服務費",
      "",
    ].join("\r\n");

    const [invoice] = NatClient.parseNatCsv(new TextEncoder().encode(csv));

    expect(invoice["買方名稱"]).toBe("測試,分店");
    expect(invoice["賣方統一編號"]).toBe("12345678");
    expect(invoice["寄送日期"]).toBe("2026-01-02 03:04:05");
    expect(invoice["課稅別"]).toBe("應稅");
  });

  test("throws on an M row whose width can't be reconciled to the header", () => {
    const csv = [
      "M,發票號碼,買方統一編號,賣方統一編號,課稅別",
      "D,發票號碼,品名",
      "M,AB12345678,12345678,87654321,應稅,unexpected-extra", // one column too many, not the buyer-name defect
      "",
    ].join("\r\n");

    expect(() => NatClient.parseNatCsv(new TextEncoder().encode(csv))).toThrow(/columns, expected/);
  });

  test("throws on a CSV truncated inside a quoted field", () => {
    const csv = 'M,發票號碼,備註\r\nD,發票號碼,品名\r\nM,AB12345678,"truncated note';
    expect(() => NatClient.parseNatCsv(new TextEncoder().encode(csv))).toThrow(/quoted field/);
  });

  test("throws on a D row whose width can't be reconciled to the header", () => {
    const csv = [
      "M,發票號碼,課稅別",
      "D,發票號碼,品名",
      "M,AB12345678,應稅",
      "D,AB12345678,顧問服務,unexpected-extra", // one column too many for the D header
      "",
    ].join("\r\n");

    expect(() => NatClient.parseNatCsv(new TextEncoder().encode(csv))).toThrow(/D row has/);
  });
});

describe("dedupeNatInvoices", () => {
  const invoice = (total: string, date = "2024-03-15"): NatInvoice => ({
    發票號碼: "AB12345678",
    賣方統一編號: "12345678",
    發票日期: date,
    總計: total,
    items: [{ 品名: "測試品項" }],
  });

  test("removes an exact portal overlap", () => {
    expect(dedupeNatInvoices([invoice("100"), invoice("100")])).toHaveLength(1);
  });

  test("rejects conflicting content under the same statutory key", () => {
    expect(() => dedupeNatInvoices([invoice("100"), invoice("200")])).toThrow("conflicting content");
  });

  test("keeps a number reused in a different period (distinct 發票日期)", () => {
    expect(dedupeNatInvoices([invoice("100", "2024-03-15"), invoice("100", "2026-03-15")])).toHaveLength(2);
  });

  test("throws when a key component is missing", () => {
    expect(() => dedupeNatInvoices([{ 發票號碼: "AB12345678", 總計: "100", items: [] } as NatInvoice])).toThrow(/missing key component/);
  });
});

describe("monthChunkRange", () => {
  test("clamps the first and last chunk to the requested interval; interior months span whole", () => {
    // a single mid-month chunk exports only the requested days
    expect(monthChunkRange("2026-08", "2026-08-15", "2026-08-20")).toEqual({ from: "2026-08-15", to: "2026-08-20" });
    // across 3 months: first keeps the start, interior is whole, last keeps the end
    expect(monthChunkRange("2026-07", "2026-07-15", "2026-09-10")).toEqual({ from: "2026-07-15", to: "2026-07-31" });
    expect(monthChunkRange("2026-08", "2026-07-15", "2026-09-10")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(monthChunkRange("2026-09", "2026-07-15", "2026-09-10")).toEqual({ from: "2026-09-01", to: "2026-09-10" });
  });

  test("a whole-month range is unchanged (incl. leap February)", () => {
    expect(monthChunkRange("2024-02", "2024-02-01", "2024-02-29")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });
});

describe("isMonthFinal", () => {
  const f = (o: Partial<{ hasData: boolean; hasEmpty: boolean; hasOpen: boolean; isCurrent: boolean }>) =>
    isMonthFinal({ hasData: false, hasEmpty: false, hasOpen: false, isCurrent: false, ...o });

  test("the current (open) month is never final", () => {
    expect(f({ isCurrent: true, hasData: true })).toBe(false);
  });

  test("an archive taken while the month was open is not final until refreshed post-close", () => {
    expect(f({ hasData: true, hasOpen: true })).toBe(false);
  });

  test("a closed month with exactly one representation is final", () => {
    expect(f({ hasData: true })).toBe(true); // data file only
    expect(f({ hasEmpty: true })).toBe(true); // empty marker only
  });

  test("a closed month with neither or both representations is not final", () => {
    expect(f({})).toBe(false); // nothing written yet
    expect(f({ hasData: true, hasEmpty: true })).toBe(false); // contradictory (crash between write+cleanup)
  });
});

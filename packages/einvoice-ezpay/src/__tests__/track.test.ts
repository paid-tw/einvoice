import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  decryptPostData,
  EZPAY_ENDPOINTS,
  makeTrackCheckCode,
  mapEzpayTrackError,
} from "../index.js";
import { BASE, ezError, IV, KEY, parsePostData, server, testProvider } from "./server.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const url = (p: { path: string }) => `${BASE}${p.path}`;
const COMPANY = "C54352706";

/** A 字軌 Result entry with a valid CheckCode for the test keys. */
function trackEntry(fields: Record<string, string>) {
  const entry = {
    ManagementNo: "0p7f5h7d3",
    Year: "115",
    Term: "6",
    AphabeticLetter: "AA",
    StartNumber: "00000000",
    EndNumber: "00000049",
    Type: "07",
    CreateDatetime: "2026-11-24 16:53:27",
    LastNumber: "50",
    Flag: "1",
    ...fields,
  };
  return {
    ...entry,
    CheckCode: makeTrackCheckCode(
      {
        AphabeticLetter: entry.AphabeticLetter,
        CompanyId: COMPANY,
        EndNumber: entry.EndNumber,
        ManagementNo: entry.ManagementNo,
        StartNumber: entry.StartNumber,
      },
      KEY,
      IV,
    ),
  };
}

/** The 字軌 API answers with Result as a JSON object/array, not a string. */
const ok = (result: unknown, message = "成功") =>
  HttpResponse.json({ Status: "SUCCESS", Message: message, Result: result });

function capture(endpoint: { path: string }, respond: () => Response) {
  const seen: { body?: URLSearchParams; params?: Record<string, string> } = {};
  server.use(
    http.post(url(endpoint), async ({ request }) => {
      const text = await request.text();
      seen.body = new URLSearchParams(text);
      seen.params = parsePostData(text).params;
      return respond();
    }),
  );
  return seen;
}

describe("makeTrackCheckCode", () => {
  it("matches the EZP_Track 附件二 worked example (HashIv with a lowercase v)", () => {
    expect(
      makeTrackCheckCode(
        {
          AphabeticLetter: "AA",
          CompanyId: COMPANY,
          EndNumber: "00000001",
          ManagementNo: "0o455ujp8",
          StartNumber: "00000050",
        },
        KEY,
        IV,
      ),
    ).toBe("5F9F7ABDE032F78CCDF3E4FB8A53D80A09190846D906DA84B26A105857AB2490");
  });
});

describe("track.create (createNumber)", () => {
  it("posts CompanyID_ (not MerchantID_) with the documented PostData_ fields", async () => {
    const seen = capture(EZPAY_ENDPOINTS.trackCreate, () => ok(trackEntry({})));
    const track = await testProvider({ companyId: COMPANY }).track.create({
      year: 115,
      term: 6,
      letters: "AA",
      startNumber: 0,
      endNumber: 49,
    });

    expect(seen.body?.get("CompanyID_")).toBe(COMPANY);
    expect(seen.body?.has("MerchantID_")).toBe(false);
    expect(seen.params).toMatchObject({
      RespondType: "JSON",
      Version: "1.0",
      Year: "115",
      Term: "6",
      AphabeticLetter: "AA",
      StartNumber: "00000000",
      EndNumber: "00000049",
      Type: "07",
    });
    expect(track).toMatchObject({
      managementNo: "0p7f5h7d3",
      year: 115,
      term: 6,
      letters: "AA",
      startNumber: "00000000",
      endNumber: "00000049",
      remaining: 50,
      status: "ACTIVE",
      flag: "1",
    });
    expect(track.createdAt?.toISOString()).toBe("2026-11-24T08:53:27.000Z");
  });

  it("encrypts with companyHashKey/companyHashIV when given", async () => {
    const otherKey = "ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvu";
    const otherIv = "7654321987654321";
    const seen = capture(EZPAY_ENDPOINTS.trackCreate, () =>
      HttpResponse.json(ezError("KEY10002", "解密錯誤")),
    );
    await expect(
      testProvider({
        companyId: COMPANY,
        companyHashKey: otherKey,
        companyHashIV: otherIv,
      }).track.create({ year: 115, term: 6, letters: "AA", startNumber: 0, endNumber: 49 }),
    ).rejects.toMatchObject({ code: "AUTH", reason: "credentials_invalid" });
    const decrypted = decryptPostData(seen.body?.get("PostData_") ?? "", otherKey, otherIv);
    expect(new URLSearchParams(decrypted).get("AphabeticLetter")).toBe("AA");
  });

  it("rejects bad input locally, before any request", async () => {
    const p = testProvider({ companyId: COMPANY });
    const base = { year: 115, term: 6, letters: "AA", startNumber: 0, endNumber: 49 };
    await expect(p.track.create({ ...base, year: 2026 })).rejects.toThrow(/did you mean 115/);
    await expect(p.track.create({ ...base, term: 7 })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(p.track.create({ ...base, letters: "ab" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(p.track.create({ ...base, startNumber: 50, endNumber: 49 })).rejects.toMatchObject(
      { code: "VALIDATION" },
    );
  });

  it("requires config.companyId", async () => {
    await expect(
      testProvider().track.create({
        year: 115,
        term: 6,
        letters: "AA",
        startNumber: 0,
        endNumber: 49,
      }),
    ).rejects.toThrow(/companyId/);
  });

  it("maps 相同的字軌已存在 (LIB10016) to CONFLICT", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.trackCreate), () =>
        HttpResponse.json(ezError("LIB10016", "相同的字軌已存在")),
      ),
    );
    await expect(
      testProvider({ companyId: COMPANY }).track.create({
        year: 115,
        term: 6,
        letters: "AA",
        startNumber: 0,
        endNumber: 49,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", rawCode: "LIB10016", reason: undefined });
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
  ])("rejects a response whose CheckCode is %s", async (_label, checkCode) => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.trackCreate), () =>
        ok({ ...trackEntry({}), CheckCode: checkCode }),
      ),
    );
    await expect(
      testProvider({ companyId: COMPANY }).track.create({
        year: 115,
        term: 6,
        letters: "AA",
        startNumber: 0,
        endNumber: 49,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER", rawCode: "CHECKCODE_MISMATCH" });
  });

  it("accepts a missing CheckCode when verifyCheckCode is false", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.trackCreate), () =>
        ok({ ...trackEntry({}), CheckCode: undefined }),
      ),
    );
    const track = await testProvider({ companyId: COMPANY, verifyCheckCode: false }).track.create({
      year: 115,
      term: 6,
      letters: "AA",
      startNumber: 0,
      endNumber: 49,
    });
    expect(track.managementNo).toBe("0p7f5h7d3");
  });

  it("rejects a response whose CheckCode does not match", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.trackCreate), () =>
        ok({ ...trackEntry({}), CheckCode: "DEADBEEF" }),
      ),
    );
    await expect(
      testProvider({ companyId: COMPANY }).track.create({
        year: 115,
        term: 6,
        letters: "AA",
        startNumber: 0,
        endNumber: 49,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER", rawCode: "CHECKCODE_MISMATCH" });
  });
});

describe("track.setStatus (manageNumber)", () => {
  it("sends ManagementNo + Year + Flag and returns the updated range", async () => {
    const seen = capture(EZPAY_ENDPOINTS.trackManage, () => ok(trackEntry({ Flag: "0" })));
    const track = await testProvider({ companyId: COMPANY }).track.setStatus({
      managementNo: "0p7f5h7d3",
      year: 115,
      status: "PAUSED",
    });
    expect(seen.params).toMatchObject({ ManagementNo: "0p7f5h7d3", Year: "115", Flag: "0" });
    expect(track.status).toBe("PAUSED");
  });

  it("maps 無法變更 (SET10006) to CONFLICT", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.trackManage), () =>
        HttpResponse.json(ezError("SET10006", "無法變更")),
      ),
    );
    await expect(
      testProvider({ companyId: COMPANY }).track.setStatus({
        managementNo: "0p7f5h7d3",
        year: 115,
        status: "ACTIVE",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("track.search (searchNumber)", () => {
  // Shapes as seen live on cinv (2026-11-24): an untouched range answers
  // UsedNumber "", a used-up one Flag "3" with LastNumber "0".
  it("returns every range and normalizes UsedNumber and Flag as ezPay sends them", async () => {
    const seen = capture(EZPAY_ENDPOINTS.trackSearch, () =>
      ok([
        trackEntry({ UsedNumber: "00000010", LastNumber: "39" }),
        trackEntry({
          ManagementNo: "0p4bnkyb0",
          AphabeticLetter: "AN",
          UsedNumber: "00000049",
          LastNumber: "0",
          Flag: "3",
        }),
        trackEntry({ ManagementNo: "0p4bnkyb1", AphabeticLetter: "AP", UsedNumber: "", Flag: "0" }),
        trackEntry({ ManagementNo: "0p4bnkyb2", AphabeticLetter: "AQ", Flag: "9" }),
      ]),
    );
    const tracks = await testProvider({ companyId: COMPANY }).track.search({ year: 115, term: 6 });
    expect(seen.params).toMatchObject({ Year: "115", Term: "6" });
    expect(seen.params).not.toHaveProperty("Flag");
    expect(seen.params).not.toHaveProperty("ManagementNo");
    expect(tracks.map((t) => [t.letters, t.usedNumber, t.remaining, t.status, t.flag])).toEqual([
      ["AA", "00000010", 39, "ACTIVE", "1"],
      ["AN", "00000049", 0, "EXHAUSTED", "3"],
      ["AP", undefined, 50, "PAUSED", "0"],
      ["AQ", undefined, 50, "UNKNOWN", "9"],
    ]);
  });

  it("passes the optional filters", async () => {
    const seen = capture(EZPAY_ENDPOINTS.trackSearch, () => ok([trackEntry({ Flag: "2" })]));
    await testProvider({ companyId: COMPANY }).track.search({
      year: 115,
      term: 6,
      managementNo: "0p7f5h7d3",
      status: "DISABLED",
    });
    expect(seen.params).toMatchObject({ ManagementNo: "0p7f5h7d3", Flag: "2" });
  });

  // INM10002 is what cinv actually answers for an empty period (live
  // 2026-11-24, with Result: []); the manual's LIB10001/MOD10003 are kept too.
  it.each(["INM10002", "LIB10001", "MOD10003"])("resolves [] on 查無資料 (%s)", async (code) => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.trackSearch), () =>
        HttpResponse.json({ ...ezError(code, "查無資料"), Result: [] }),
      ),
    );
    await expect(
      testProvider({ companyId: COMPANY }).track.search({ year: 115, term: 6 }),
    ).resolves.toEqual([]);
  });

  it("still rejects a real 查詢失敗 (INM10002 without 查無資料)", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.trackSearch), () =>
        HttpResponse.json(ezError("INM10002", "查詢失敗")),
      ),
    );
    await expect(
      testProvider({ companyId: COMPANY }).track.search({ year: 115, term: 6 }),
    ).rejects.toMatchObject({ code: "PROVIDER", rawCode: "INM10002" });
  });

  it("maps 參數格式錯誤 (INM10004) to VALIDATION", async () => {
    server.use(
      http.post(url(EZPAY_ENDPOINTS.trackSearch), () =>
        HttpResponse.json(ezError("INM10004", "參數格式錯誤-Year")),
      ),
    );
    await expect(
      testProvider({ companyId: COMPANY }).track.search({ year: 110, term: 1 }),
    ).rejects.toMatchObject({ code: "VALIDATION", rawMessage: "參數格式錯誤-Year" });
  });
});

describe("mapEzpayTrackError", () => {
  it.each([
    ["LIB10001", "NOT_FOUND"],
    ["LIB10004", "CONFLICT"],
    ["LIB10007", "CONFLICT"],
    ["LIB10013", "VALIDATION"],
    ["INM10004", "VALIDATION"],
    ["INM10006", "PROVIDER"],
    ["KEY10002", "AUTH"],
    ["KEY10006", "AUTH"],
    ["NOR10001", "NETWORK"],
  ])("%s → %s", (code, expected) => {
    expect(mapEzpayTrackError(code)).toBe(expected);
  });

  it("reads 查無資料 as NOT_FOUND whatever the code", () => {
    expect(mapEzpayTrackError("INM10002", "查無資料")).toBe("NOT_FOUND");
    expect(mapEzpayTrackError("INM10002", "查詢失敗")).toBe("PROVIDER");
  });
});

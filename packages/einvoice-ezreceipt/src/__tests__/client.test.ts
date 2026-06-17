import { createHash } from "node:crypto";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EZRECEIPT_ENDPOINTS, EzreceiptClient, hashPassword, mapEzreceiptError } from "../index.js";
import { fail, ok, okToken, server, url } from "./server.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = (overrides = {}) =>
  new EzreceiptClient({ appCode: "83567500", appKey: "k", accName: "A123", password: "pw", mode: "TEST", ...overrides });

describe("hashPassword", () => {
  it("matches the documented example sha1(sha1(accName)+password)", () => {
    expect(hashPassword("test", "5678")).toBe("e6bae8c0bfbd44d29944eab05ec4e08a807313b0");
    const manual = createHash("sha1").update(createHash("sha1").update("A123").digest("hex") + "pw").digest("hex");
    expect(hashPassword("A123", "pw")).toBe(manual);
  });
});

describe("token auth", () => {
  it("logs in lazily, caches the token, and sends it on subsequent calls", async () => {
    let logins = 0;
    const seen: (string | null)[] = [];
    server.use(
      http.post(url("/admin/user/login"), () => {
        logins++;
        return okToken("TOK1");
      }),
      http.post(url("/eInvoice/invoice/list"), ({ request }) => {
        seen.push(request.headers.get("x-deva-token"));
        return ok({ list: [] });
      }),
    );
    const c = client();
    await c.request(EZRECEIPT_ENDPOINTS.list, {});
    await c.request(EZRECEIPT_ENDPOINTS.list, {});
    expect(logins).toBe(1); // cached
    expect(seen).toEqual(["TOK1", "TOK1"]);
  });

  it("sends appcode/appkey/locale headers and no token on the login call itself", async () => {
    let loginHeaders: Headers | undefined;
    server.use(
      http.post(url("/admin/user/login"), ({ request }) => {
        loginHeaders = request.headers;
        return okToken();
      }),
      http.post(url("/eInvoice/invoice/list"), () => ok({ list: [] })),
    );
    await client().request(EZRECEIPT_ENDPOINTS.list, {});
    expect(loginHeaders?.get("x-deva-appcode")).toBe("83567500");
    expect(loginHeaders?.get("x-deva-appkey")).toBe("k");
    expect(loginHeaders?.get("x-deva-locale")).toBe("zh");
    expect(loginHeaders?.get("x-deva-token")).toBeNull();
  });

  it("re-logs in once and retries on -3 Invalid token", async () => {
    let logins = 0;
    let calls = 0;
    server.use(
      http.post(url("/admin/user/login"), () => {
        logins++;
        return okToken(`TOK${logins}`);
      }),
      http.post(url("/eInvoice/invoice/list"), () => {
        calls++;
        return calls === 1 ? fail(-3, "Invalid token.") : ok({ list: [], entries: 0 });
      }),
    );
    const res = await client().request<{ entries: number }>(EZRECEIPT_ENDPOINTS.list, {});
    expect(res.entries).toBe(0);
    expect(logins).toBe(2); // initial + one re-login
  });

  it("uses a pre-supplied token without logging in", async () => {
    let logins = 0;
    server.use(
      http.post(url("/admin/user/login"), () => {
        logins++;
        return okToken();
      }),
      http.post(url("/eInvoice/invoice/list"), ({ request }) => ok({ token: request.headers.get("x-deva-token") })),
    );
    const res = await client({ token: "PRESET", password: undefined }).request<{ token: string }>(EZRECEIPT_ENDPOINTS.list, {});
    expect(logins).toBe(0);
    expect(res.token).toBe("PRESET");
  });

  it("throws AUTH when no password and no token are configured", async () => {
    await expect(client({ password: undefined }).request(EZRECEIPT_ENDPOINTS.list, {})).rejects.toMatchObject({ code: "AUTH" });
  });

  it("maps a login failure (308) to AUTH", async () => {
    server.use(http.post(url("/admin/user/login"), () => fail(308, "登入失敗")));
    await expect(client().login()).rejects.toMatchObject({ code: "AUTH", rawCode: "308" });
  });

  it("throws NETWORK when the transport fails", async () => {
    server.use(http.post(url("/admin/user/login"), () => HttpResponse.error()));
    await expect(client().request(EZRECEIPT_ENDPOINTS.list, {})).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("throws PROVIDER on a non-JSON response", async () => {
    server.use(
      http.post(url("/admin/user/login"), () => okToken()),
      http.post(url("/eInvoice/invoice/list"), () => new HttpResponse("<html>", { headers: { "content-type": "text/html" } })),
    );
    await expect(client().request(EZRECEIPT_ENDPOINTS.list, {})).rejects.toMatchObject({ code: "PROVIDER" });
  });

  it("targets the production host when mode is PRODUCTION", async () => {
    let hit = false;
    server.use(
      http.post("https://api.ezreceipt.cc/admin/user/login", () => okToken()),
      http.post("https://api.ezreceipt.cc/eInvoice/invoice/list", () => {
        hit = true;
        return ok({ list: [] });
      }),
    );
    await client({ mode: "PRODUCTION" }).request(EZRECEIPT_ENDPOINTS.list, {});
    expect(hit).toBe(true);
  });

  it("includes x-deva-stid when stID is configured", async () => {
    let stid: string | null = null;
    server.use(
      http.post(url("/admin/user/login"), ({ request }) => {
        stid = request.headers.get("x-deva-stid");
        return okToken();
      }),
      http.post(url("/eInvoice/invoice/list"), () => ok({ list: [] })),
    );
    await client({ stID: 9905 }).request(EZRECEIPT_ENDPOINTS.list, {});
    expect(stid).toBe("9905");
  });
});

describe("mapEzreceiptError (table-driven)", () => {
  it.each([
    [-3, "AUTH"],
    [-5, "AUTH"],
    [-10, "AUTH"],
    [-20, "AUTH"],
    [-110, "AUTH"],
    [306, "AUTH"],
    [307, "AUTH"],
    [308, "AUTH"],
    [331, "AUTH"],
    [1016, "AUTH"],
    [10, "NOT_FOUND"],
    [11, "NOT_FOUND"],
    [12, "NOT_FOUND"],
    [20, "NOT_FOUND"],
    [30, "NOT_FOUND"],
    [122, "NOT_FOUND"],
    [224, "NOT_FOUND"],
    [1015, "NUMBER_EXHAUSTED"],
    [1003, "CONFLICT"],
    [1004, "CONFLICT"],
    [1005, "CONFLICT"],
    [1008, "CONFLICT"],
    [1010, "CONFLICT"],
    [1012, "CONFLICT"],
    [1014, "CONFLICT"],
    [1023, "CONFLICT"],
    [1017, "CONFLICT"],
    [1020, "CONFLICT"],
    [1039, "CONFLICT"],
    [1042, "CONFLICT"],
    [1043, "CONFLICT"],
    [1045, "CONFLICT"],
    [1068, "CONFLICT"],
    [1073, "CONFLICT"],
    [1074, "CONFLICT"],
    [-15, "PROVIDER"],
    [-31, "PROVIDER"],
    [-99, "PROVIDER"],
    [1, "VALIDATION"],
    [2, "VALIDATION"],
    [118, "VALIDATION"],
    [121, "VALIDATION"],
    [123, "VALIDATION"],
    [124, "VALIDATION"],
    [125, "VALIDATION"],
    [126, "VALIDATION"],
    [360, "VALIDATION"],
    [470, "VALIDATION"],
    [1024, "VALIDATION"],
    [1027, "VALIDATION"],
    [1076, "VALIDATION"],
  ])("code %i → %s", (code, expected) => {
    expect(mapEzreceiptError(code)).toBe(expected);
  });
});

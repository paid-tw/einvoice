import { afterEach, describe, expect, test } from "bun:test";
import { launchOptions, natCreds, untilReady } from "../nat-session.ts";

const names = ["NAT_UBN", "NAT_USER_ID", "NAT_PASSWORD"] as const;
const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of names) {
    const value = original[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("natCreds", () => {
  test("reads a complete environment credential set without 1Password", () => {
    process.env.NAT_UBN = "12345678";
    process.env.NAT_USER_ID = "operator";
    process.env.NAT_PASSWORD = "secret";

    expect(natCreds()).toEqual({ ban: "12345678", customId: "operator", password: "secret" });
  });

  test("rejects a partial environment credential set", () => {
    process.env.NAT_UBN = "12345678";
    process.env.NAT_USER_ID = "operator";
    delete process.env.NAT_PASSWORD;

    expect(() => natCreds()).toThrow("NAT environment is missing credential field(s): password");
  });
});

describe("launchOptions", () => {
  test("launches headless with no proxy by default", () => {
    expect(launchOptions({})).toEqual({ headless: true });
  });

  test("routes the browser through NAT_PROXY when set", () => {
    expect(launchOptions({ NAT_PROXY: "socks5://127.0.0.1:1080" })).toEqual({
      headless: true,
      proxy: { server: "socks5://127.0.0.1:1080" },
    });
  });

  test("treats a blank NAT_PROXY as unset", () => {
    expect(launchOptions({ NAT_PROXY: "  " })).toEqual({ headless: true });
  });
});

describe("untilReady", () => {
  test("returns the first truthy value without further attempts or pauses", async () => {
    const calls: number[] = [];
    let pauses = 0;
    const value = await untilReady(5, async (n) => { calls.push(n); return "ready"; }, async () => { pauses++; });
    expect(value).toBe("ready");
    expect(calls).toEqual([1]);
    expect(pauses).toBe(0);
  });

  test("retries past empty results (a blank page load) and pauses between tries", async () => {
    const calls: number[] = [];
    let pauses = 0;
    const value = await untilReady(5, async (n) => { calls.push(n); return n === 3 ? "token" : ""; }, async () => { pauses++; });
    expect(value).toBe("token");
    expect(calls).toEqual([1, 2, 3]);
    expect(pauses).toBe(2);
  });

  test("gives up after the attempt budget, without a trailing pause", async () => {
    let calls = 0;
    let pauses = 0;
    const value = await untilReady(4, async () => { calls++; return false; }, async () => { pauses++; });
    expect(value).toBeUndefined();
    expect(calls).toBe(4);
    expect(pauses).toBe(3);
  });

  test("propagates an error thrown by an attempt", async () => {
    await expect(untilReady(3, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { natCreds } from "../nat-session.ts";

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

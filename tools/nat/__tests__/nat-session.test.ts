import { afterEach, describe, expect, test } from "bun:test";
import { classifyDoLogin, natCreds, NatLoginError, runLoginAttempts, type LoginOutcome } from "../nat-session.ts";

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

describe("classifyDoLogin", () => {
  test("any 2xx is accepted (the body is often gone after the SPA navigates)", () => {
    expect(classifyDoLogin(200, '{"redirectTo":"https://x/sso?login_verifier=v"}')).toEqual({ kind: "ok" });
    expect(classifyDoLogin(200, "")).toEqual({ kind: "ok" });
  });

  test("a wrong captcha is retryable (message seen live)", () => {
    expect(classifyDoLogin(400, '{"message":"Image verification code verification failed."}')).toEqual({
      kind: "captcha",
      message: "Image verification code verification failed.",
    });
    expect(classifyDoLogin(400, '{"msg":"圖形驗證碼錯誤"}').kind).toBe("captcha");
  });

  test("a credential or lock error is fatal and keeps the platform message", () => {
    expect(classifyDoLogin(400, '{"message":"帳號或密碼錯誤"}')).toEqual({ kind: "fatal", message: "HTTP 400: 帳號或密碼錯誤" });
    expect(classifyDoLogin(400, '{"message":"此帳號將被鎖定15分鐘"}').kind).toBe("fatal");
    // mentions the captcha but also the password → not safe to retry
    expect(classifyDoLogin(400, '{"message":"帳號、密碼或驗證碼錯誤"}').kind).toBe("fatal");
    expect(classifyDoLogin(500, "Internal Server Error")).toEqual({ kind: "fatal", message: "HTTP 500: Internal Server Error" });
  });
});

describe("runLoginAttempts", () => {
  test("stops on the first fatal outcome without retrying", async () => {
    let calls = 0;
    const run = runLoginAttempts(async () => {
      calls++;
      return { kind: "fatal", message: "HTTP 400: 此帳號將被鎖定15分鐘" };
    });
    await expect(run).rejects.toThrow("NAT login rejected (attempt 1, not retried): HTTP 400: 此帳號將被鎖定15分鐘");
    await expect(run).rejects.toBeInstanceOf(NatLoginError);
    expect(calls).toBe(1);
  });

  test("retries captcha misses and no-op submits, then succeeds", async () => {
    const outcomes: LoginOutcome[] = [{ kind: "captcha", message: "wrong" }, { kind: "no-response" }, { kind: "ok" }];
    let calls = 0;
    await runLoginAttempts(async () => outcomes[calls++]);
    expect(calls).toBe(3);
  });

  test("a captcha miss followed by a credential error stops there", async () => {
    const outcomes: LoginOutcome[] = [{ kind: "captcha", message: "wrong" }, { kind: "fatal", message: "HTTP 400: 密碼錯誤" }, { kind: "ok" }];
    let calls = 0;
    await expect(runLoginAttempts(async () => outcomes[calls++])).rejects.toThrow("attempt 2, not retried");
    expect(calls).toBe(2);
  });

  test("gives up after max captcha misses with the last message", async () => {
    let calls = 0;
    await expect(
      runLoginAttempts(async () => {
        calls++;
        return { kind: "captcha", message: "Image verification code verification failed." };
      }, 3),
    ).rejects.toThrow("NAT login failed after 3 attempts; last: captcha rejected: Image verification code verification failed.");
    expect(calls).toBe(3);
  });
});

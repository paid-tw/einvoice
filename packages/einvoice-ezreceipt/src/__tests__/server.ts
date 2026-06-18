import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createEzreceiptProvider, type EzreceiptConfig } from "../index.js";

export const BASE = "https://tryapi.ezreceipt.cc";
export const url = (path: string) => `${BASE}${path}`;

export const server = setupServer();

export function testProvider(overrides: Partial<EzreceiptConfig> = {}) {
  return createEzreceiptProvider({
    appCode: "83567500",
    appKey: "testkey",
    accName: "A123",
    password: "pw",
    mode: "TEST",
    ...overrides,
  });
}

/** A success envelope `{ code: 0, message, value }`. */
export const ok = (value: unknown, message = "Ok") => HttpResponse.json({ code: 0, message, value });

/** A login success envelope (carries the `token`). */
export const okToken = (token = "tok_test") =>
  HttpResponse.json({ code: 0, message: "Ok", value: { accName: "A123" }, token: { token, validTo: 9_999_999_999_999 } });

/** An error envelope `{ code, message }` (code is the COIMOTION numeric code). */
export const fail = (code: number, message = "err") => HttpResponse.json({ code, message });

/** A binary file response (for proof/print endpoints). Defaults to a `%PDF` stub. */
export const file = (bytes: number[] = [0x25, 0x50, 0x44, 0x46], contentType = "application/pdf") =>
  new HttpResponse(new Uint8Array(bytes), { headers: { "content-type": contentType } });

/** The default login handler — most flows need a token first. */
export const loginHandler = (token = "tok_test") => http.post(url("/admin/user/login"), () => okToken(token));

/** A handler for `invoice/list { invNo }` resolving to a single invID. */
export const listResolves = (invNo: string, invID: number) =>
  http.post(url("/eInvoice/invoice/list"), () => ok({ list: [{ invNo, invID }], entries: 1 }));

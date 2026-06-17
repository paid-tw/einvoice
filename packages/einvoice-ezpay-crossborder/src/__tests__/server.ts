import { decryptPostData } from "@paid-tw/einvoice-ezpay";
import { setupServer } from "msw/node";
import { createEzpayCrossBorderProvider, type EzpayCrossBorderConfig } from "../provider.js";

/** ezPay public-test-style dummy credentials (32-byte key / 16-byte IV). */
export const TEST_KEY = "abcdefghijklmnopqrstuvwxyzabcdef";
export const TEST_IV = "1234567891234567";
export const BASE = "https://cinv.ezpay.com.tw";

export const server = setupServer();

export function testProvider(overrides: Partial<EzpayCrossBorderConfig> = {}) {
  return createEzpayCrossBorderProvider({
    merchantId: "3500001",
    hashKey: TEST_KEY,
    hashIV: TEST_IV,
    mode: "TEST",
    ...overrides,
  });
}

/** Decrypt the `PostData_` of an intercepted request into a params object. */
export function parseRequest(formBody: string): Record<string, string> {
  const params = new URLSearchParams(formBody);
  const hex = params.get("PostData_") ?? "";
  const decrypted = decryptPostData(hex, TEST_KEY, TEST_IV);
  return Object.fromEntries(new URLSearchParams(decrypted));
}

/** A success envelope whose `Result` is a JSON string (RespondType=JSON). */
export function ceSuccess(result: Record<string, unknown>, message = "發票開立成功") {
  return { Status: "SUCCESS", Message: message, Result: JSON.stringify(result) };
}

/** An error envelope (Status is the ezPay error code, e.g. "INV20006"). */
export function ceError(status: string, message: string) {
  return { Status: status, Message: message, Result: [] };
}

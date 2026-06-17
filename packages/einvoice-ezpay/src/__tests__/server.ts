import { setupServer } from "msw/node";
import { createEzpayProvider } from "../provider.js";
import { decryptPostData } from "../crypto.js";

export const BASE = "https://ezpay.test";
export const MERCHANT = "TEST1234567890";
export const KEY = "abcdefghijklmnopqrstuvwxyzabcdef"; // 32
export const IV = "1234567891234567"; // 16

export const server = setupServer();

export function testProvider(overrides: Record<string, unknown> = {}) {
  return createEzpayProvider({
    merchantId: MERCHANT,
    hashKey: KEY,
    hashIV: IV,
    baseUrl: BASE,
    ...overrides,
  });
}

/** Parse a captured ezPay request: returns MerchantID_ and the decrypted params. */
export function parsePostData(text: string) {
  const form = new URLSearchParams(text);
  const decrypted = decryptPostData(form.get("PostData_") ?? "", KEY, IV);
  return {
    merchantId: form.get("MerchantID_"),
    params: Object.fromEntries(new URLSearchParams(decrypted)) as Record<string, string>,
  };
}

/** A SUCCESS envelope; `result` is JSON-stringified (RespondType=JSON). */
export function ezSuccess(result: Record<string, unknown>, message = "處理成功") {
  return { Status: "SUCCESS", Message: message, Result: JSON.stringify(result) };
}

/** An error envelope (Status = error code). */
export function ezError(code: string, message: string) {
  return { Status: code, Message: message };
}

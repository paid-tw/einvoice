import { setupServer } from "msw/node";
import { decryptData, encryptData } from "../crypto.js";
import { createEcpayProvider } from "../provider.js";

export const BASE = "https://ecpay.test";
export const MERCHANT = "2000132";
export const KEY = "ejCk326UnaZWKisg"; // 16
export const IV = "q9jcZX8Ib9LM8wYk"; // 16

export const server = setupServer();

export function testProvider(overrides: Record<string, unknown> = {}) {
  return createEcpayProvider({
    merchantId: MERCHANT,
    hashKey: KEY,
    hashIV: IV,
    baseUrl: BASE,
    ...overrides,
  });
}

/** Parse a captured request: MerchantID + the decrypted Data payload. */
export function parseRequest(text: string) {
  const body = JSON.parse(text) as {
    MerchantID: string;
    RqHeader: { Timestamp: number };
    Data: string;
  };
  return {
    merchantId: body.MerchantID,
    timestamp: body.RqHeader?.Timestamp,
    data: decryptData(body.Data, KEY, IV) as Record<string, unknown>,
  };
}

/** A success envelope: TransCode 1 + encrypted Data with RtnCode 1. */
export function ecSuccess(result: Record<string, unknown>) {
  return {
    MerchantID: MERCHANT,
    TransCode: 1,
    TransMsg: "Success",
    Data: encryptData({ RtnCode: 1, RtnMsg: "", ...result }, KEY, IV),
  };
}

/** A business-error envelope: TransCode 1 + encrypted Data with RtnCode ≠ 1. */
export function ecError(rtnCode: number, rtnMsg: string) {
  return {
    MerchantID: MERCHANT,
    TransCode: 1,
    TransMsg: "Success",
    Data: encryptData({ RtnCode: rtnCode, RtnMsg: rtnMsg }, KEY, IV),
  };
}

/** A transport-error envelope (TransCode ≠ 1, no Data). */
export function ecTransError(transCode: number, transMsg: string) {
  return { MerchantID: MERCHANT, TransCode: transCode, TransMsg: transMsg };
}

/** A success envelope whose Data is a plain (unencrypted) object — for GetIssueList. */
export function ecPlainSuccess(result: Record<string, unknown>) {
  return {
    MerchantID: MERCHANT,
    TransCode: 1,
    TransMsg: "",
    Data: { RtnCode: 1, RtnMsg: "", ...result },
  };
}

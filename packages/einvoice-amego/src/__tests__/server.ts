import { setupServer } from "msw/node";
import { createAmegoProvider } from "../provider.js";

/** Fixed host used by all MSW handlers in the Amego adapter tests. */
export const BASE = "https://amego.test";
export const APP_KEY = "test-app-key";
export const SELLER = "12345678";

export const server = setupServer();

/** A provider pointed at the mocked host. */
export function testProvider() {
  return createAmegoProvider({
    sellerUbn: SELLER,
    appKey: APP_KEY,
    baseUrl: BASE,
  });
}

/** Parse a captured form-urlencoded Amego request body. */
export function parseBody(text: string) {
  const params = new URLSearchParams(text);
  return {
    invoice: params.get("invoice"),
    time: params.get("time"),
    sign: params.get("sign"),
    data: JSON.parse(params.get("data") ?? "{}") as Record<string, unknown>,
    raw: params,
  };
}

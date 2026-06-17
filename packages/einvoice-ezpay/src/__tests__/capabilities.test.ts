import { Capability, supports } from "@paid-tw/einvoice";
import { describe, expect, it } from "vitest";
import { createEzpayProvider } from "../provider.js";

const provider = createEzpayProvider({
  merchantId: "TEST",
  hashKey: "abcdefghijklmnopqrstuvwxyzabcdef",
  hashIV: "1234567891234567",
  mode: "TEST",
});

describe("ezPay capabilities", () => {
  it("declares the five core operations", () => {
    for (const cap of [
      Capability.ISSUE,
      Capability.VOID,
      Capability.ALLOWANCE,
      Capability.VOID_ALLOWANCE,
      Capability.QUERY,
    ]) {
      expect(supports(provider, cap)).toBe(true);
    }
  });

  it("supports B2B, mixed tax, order-id lookup and scheduled issue", () => {
    expect(supports(provider, Capability.B2B)).toBe(true);
    expect(supports(provider, Capability.MIXED_TAX)).toBe(true);
    expect(supports(provider, Capability.QUERY_BY_ORDER_ID)).toBe(true);
    expect(supports(provider, Capability.SCHEDULED_ISSUE)).toBe(true);
  });
});

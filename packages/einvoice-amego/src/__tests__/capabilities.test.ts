import { Capability, supports } from "@paid-tw/einvoice";
import { describe, expect, it } from "vitest";
import { testProvider } from "./server.js";

const provider = testProvider();

describe("Amego capabilities", () => {
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

  it("supports B2B, mixed tax, order-id lookup and carrier validation", () => {
    expect(supports(provider, Capability.B2B)).toBe(true);
    expect(supports(provider, Capability.MIXED_TAX)).toBe(true);
    expect(supports(provider, Capability.QUERY_BY_ORDER_ID)).toBe(true);
    expect(supports(provider, Capability.CARRIER_VALIDATION)).toBe(true);
    expect(supports(provider, Capability.FOREIGN_CURRENCY)).toBe(true);
  });

  it("does not support scheduled issue", () => {
    expect(supports(provider, Capability.SCHEDULED_ISSUE)).toBe(false);
  });
});

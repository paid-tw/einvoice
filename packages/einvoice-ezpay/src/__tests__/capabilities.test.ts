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

  it("supports B2B, mixed tax, order-id lookup, scheduled issue and carrier validation", () => {
    expect(supports(provider, Capability.B2B)).toBe(true);
    expect(supports(provider, Capability.MIXED_TAX)).toBe(true);
    expect(supports(provider, Capability.QUERY_BY_ORDER_ID)).toBe(true);
    expect(supports(provider, Capability.SCHEDULED_ISSUE)).toBe(true);
    expect(supports(provider, Capability.CARRIER_VALIDATION)).toBe(true);
  });

  it("does not support foreign currency, and rejects a non-TWD currency", async () => {
    expect(supports(provider, Capability.FOREIGN_CURRENCY)).toBe(false);
    await expect(
      provider.issue({
        orderId: "FX1",
        buyer: { email: "b@x.com" },
        items: [{ description: "商品", quantity: 1, unitPrice: 100, amount: 100 }],
        amount: { salesAmount: 100, taxAmount: 0, totalAmount: 100 },
        taxType: "TAXABLE",
        priceMode: "TAX_INCLUSIVE",
        currency: "USD",
        exchangeRate: 31.5,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
});

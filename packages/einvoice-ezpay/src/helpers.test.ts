import { describe, expect, it } from "vitest";
import { ezpayTaxRate, ezpayTaxType } from "./provider.js";

describe("ezpayTaxType", () => {
  it("maps each unified tax type to the ezPay code", () => {
    expect(ezpayTaxType("TAXABLE")).toBe("1");
    expect(ezpayTaxType("SPECIAL")).toBe("1");
    expect(ezpayTaxType("ZERO_RATED")).toBe("2");
    expect(ezpayTaxType("TAX_FREE")).toBe("3");
  });
});

describe("ezpayTaxRate", () => {
  it("is 0 for zero-rated / tax-free, else a whole-number percent", () => {
    expect(ezpayTaxRate("ZERO_RATED")).toBe(0);
    expect(ezpayTaxRate("TAX_FREE")).toBe(0);
    expect(ezpayTaxRate("TAXABLE")).toBe(5); // default 0.05
    expect(ezpayTaxRate("TAXABLE", 0.1)).toBe(10);
  });
});

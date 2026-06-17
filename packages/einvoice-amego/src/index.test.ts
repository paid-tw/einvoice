import { describe, expect, it } from "vitest";
import * as amego from "./index.js";

describe("package barrel", () => {
  it("re-exports the public API surface", () => {
    expect(typeof amego.createAmegoProvider).toBe("function");
    expect(typeof amego.AmegoProvider).toBe("function");
    expect(amego.AMEGO_BASE_URL).toMatch(/^https:\/\//);
    expect(amego.AMEGO_ENDPOINTS.invoiceQuery).toBe("/json/invoice_query");
    expect(typeof amego.sign).toBe("function");
    expect(typeof amego.assertValidIssuePayload).toBe("function");
    expect(typeof amego.computeAmegoAmounts).toBe("function");
    expect(typeof amego.isValidUbn).toBe("function");
  });
});

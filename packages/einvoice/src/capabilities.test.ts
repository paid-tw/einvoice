import { describe, expect, it } from "vitest";
import {
  Capability,
  UnsupportedCapabilityError,
  assertSupports,
  supports,
} from "./capabilities.js";
import { InvoiceError, InvoiceErrorCode, isInvoiceError } from "./errors.js";
import { MockProvider } from "./mock.js";
import type { InvoiceProvider } from "./provider.js";

/** A provider with no behaviour, used to test capability declaration alone. */
function stub(name: string, caps: Capability[]): InvoiceProvider {
  const notImplemented = () => Promise.reject(new Error("not implemented"));
  return {
    name,
    capabilities: new Set(caps),
    issue: notImplemented,
    void: notImplemented,
    allowance: notImplemented,
    voidAllowance: notImplemented,
    query: notImplemented,
  };
}

describe("capabilities", () => {
  const provider = new MockProvider();

  it("MockProvider declares the full capability set", () => {
    for (const cap of Object.values(Capability)) {
      expect(supports(provider, cap)).toBe(true);
    }
  });

  it("supports() reflects the declared set", () => {
    const partial = stub("partial", [Capability.ISSUE, Capability.QUERY]);
    expect(supports(partial, Capability.ISSUE)).toBe(true);
    expect(supports(partial, Capability.ALLOWANCE)).toBe(false);
  });

  it("assertSupports() is a no-op when supported", () => {
    expect(() => assertSupports(provider, Capability.ISSUE)).not.toThrow();
  });

  it("assertSupports() throws UnsupportedCapabilityError when not supported", () => {
    const partial = stub("partial", [Capability.ISSUE]);

    let caught: unknown;
    try {
      assertSupports(partial, Capability.SCHEDULED_ISSUE);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnsupportedCapabilityError);
    expect(caught).toBeInstanceOf(InvoiceError);
    expect(isInvoiceError(caught)).toBe(true);

    const err = caught as UnsupportedCapabilityError;
    expect(err.code).toBe(InvoiceErrorCode.UNSUPPORTED);
    expect(err.provider).toBe("partial");
    expect(err.capability).toBe(Capability.SCHEDULED_ISSUE);
    expect(err.message).toContain("SCHEDULED_ISSUE");
  });
});

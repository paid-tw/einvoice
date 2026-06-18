import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  allowanceInputSchema,
  issueInvoiceInputSchema,
  queryInvoiceInputSchema,
  voidAllowanceInputSchema,
  voidInvoiceInputSchema,
} from "./schemas.js";
import type {
  AllowanceInput,
  IssueInvoiceInput,
  QueryInvoiceInput,
  VoidAllowanceInput,
  VoidInvoiceInput,
} from "./types.js";

/**
 * Compile-time guard that each Zod input schema and its hand-written interface
 * stay in sync. The schemas (runtime validation) and the interfaces (the public
 * API surface) are authored separately; if they drift — a field added to one but
 * not the other, or a changed shape — `tsc --noEmit` (pnpm typecheck) fails on
 * the corresponding `Expect<…>` below. The runtime body is a placeholder so the
 * file reads as a check in the vitest run.
 */
type Expect<T extends true> = T;
type Extends<A, B> = A extends B ? true : false;
type Equivalent<A, B> = Extends<A, B> extends true ? Extends<B, A> : false;

describe("schema ↔ type parity", () => {
  it("each input schema is mutually assignable with its interface", () => {
    // Each tuple slot compiles only if the schema and the interface agree;
    // a drift turns an `Expect<…>` into `Expect<false>`, failing typecheck.
    const checks: [
      Expect<Equivalent<IssueInvoiceInput, z.infer<typeof issueInvoiceInputSchema>>>,
      Expect<Equivalent<VoidInvoiceInput, z.infer<typeof voidInvoiceInputSchema>>>,
      Expect<Equivalent<AllowanceInput, z.infer<typeof allowanceInputSchema>>>,
      Expect<Equivalent<VoidAllowanceInput, z.infer<typeof voidAllowanceInputSchema>>>,
      Expect<Equivalent<QueryInvoiceInput, z.infer<typeof queryInvoiceInputSchema>>>,
    ] = [true, true, true, true, true];
    expect(checks).toHaveLength(5);
  });
});

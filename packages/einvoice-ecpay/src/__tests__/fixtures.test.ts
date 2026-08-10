import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mapEcpayError, ecpayErrorReason } from "../client.js";
import { ENDPOINTS } from "../endpoints.js";
import { BASE, ecSuccess, parseRequest, server, testProvider } from "./server.js";

/**
 * Consumes the language-neutral wire fixtures in `<repo>/fixtures/ecpay/`. The
 * Ruby port runs the same JSON through its own adapter; this is the TypeScript
 * side of that contract. Fixtures pin the wire payload the adapter must produce
 * for a given unified input — see `fixtures/README.md`.
 */

const FIXTURE_DIR = fileURLToPath(new URL("../../../../fixtures/ecpay/", import.meta.url));

interface WireCase {
  name: string;
  operation: "issue" | "void" | "allowance" | "voidAllowance" | "query";
  input: Record<string, unknown>;
  expect: {
    endpoint: string;
    data: Record<string, unknown>;
    dataExact?: boolean;
    dataAbsent?: string[];
    itemsAbsent?: Array<{ index: number; keys: string[] }>;
  };
}

function load(file: string): WireCase[] {
  return JSON.parse(readFileSync(new URL(file, `file://${FIXTURE_DIR}`), "utf8")).cases;
}

// A minimal per-operation result so the adapter's result parsing doesn't throw.
const RESULT_STUB: Record<WireCase["operation"], Record<string, unknown>> = {
  issue: { InvoiceNo: "JU11082062", InvoiceDate: "2026-06-17 12:24:53", RandomNumber: "3136" },
  void: {},
  allowance: { IA_Allow_No: "2026061721545183", IA_Date: "2026-06-17 21:54:51" },
  voidAllowance: {},
  query: {
    IIS_Number: "JU11082062",
    IIS_Relate_Number: "ORDER_1",
    IIS_Create_Date: "2026-06-17 12:24:53",
    IIS_Random_Number: "3136",
    IIS_Identifier: "0000000000",
    IIS_Sales_Amount: 105,
    IIS_Tax_Amount: 5,
    IIS_Remain_Allowance_Amt: 105,
    IIS_Invalid_Status: "0",
    Items: [{ ItemName: "商品一", ItemCount: 1, ItemPrice: 100, ItemAmount: 100, ItemWord: "式" }],
  },
};

const ENDPOINT_FOR: Record<WireCase["operation"], string> = {
  issue: ENDPOINTS.issue,
  void: ENDPOINTS.invalid,
  allowance: ENDPOINTS.allowance,
  voidAllowance: ENDPOINTS.allowanceInvalid,
  query: ENDPOINTS.getIssue,
};

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function capture(c: WireCase) {
  let data: Record<string, unknown> | undefined;
  server.use(
    http.post(`${BASE}${ENDPOINT_FOR[c.operation]}`, async ({ request }) => {
      data = parseRequest(await request.text()).data;
      return HttpResponse.json(ecSuccess(RESULT_STUB[c.operation]));
    }),
  );
  const provider = testProvider();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (provider as any)[c.operation](c.input);
  return data as Record<string, unknown>;
}

for (const file of ["issue.json", "void-allowance.json", "query.json"]) {
  describe(`fixtures/ecpay/${file}`, () => {
    for (const c of load(file)) {
      it(c.name, async () => {
        const data = await capture(c);
        expect(data).toMatchObject(c.expect.data);
        if (c.expect.dataExact) {
          expect(Object.keys(data).sort()).toEqual(Object.keys(c.expect.data).sort());
        }
        for (const key of c.expect.dataAbsent ?? []) expect(data).not.toHaveProperty(key);
        for (const rule of c.expect.itemsAbsent ?? []) {
          const items = data.Items as Array<Record<string, unknown>>;
          for (const key of rule.keys) expect(items[rule.index]).not.toHaveProperty(key);
        }
      });
    }
  });
}

interface ErrorCase {
  name: string;
  rtnCode: string;
  rtnMsg: string;
  expect: { code: string; reason: string | null };
}

describe("fixtures/ecpay/errors.json", () => {
  const cases: ErrorCase[] = JSON.parse(
    readFileSync(new URL("errors.json", `file://${FIXTURE_DIR}`), "utf8"),
  ).cases;
  for (const c of cases) {
    it(c.name, () => {
      expect(mapEcpayError(Number(c.rtnCode), c.rtnMsg)).toBe(c.expect.code);
      expect(ecpayErrorReason(c.rtnMsg) ?? null).toBe(c.expect.reason);
    });
  }
});

import { Capability, supports } from "@paid-tw/einvoice";
import { http } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EZRECEIPT_ENDPOINTS as EP, ezreceiptTaxType } from "../index.js";
import { fail, listResolves, loginHandler, ok, server, testProvider, url } from "./server.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const b2cInput = {
  orderId: "ORDER_1",
  buyer: { name: "買受人", email: "m@x.com" },
  items: [{ description: "商品", quantity: 1, unitPrice: 100, amount: 100, unit: "件" }],
  amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
  taxType: "TAXABLE" as const,
  priceMode: "TAX_EXCLUSIVE" as const,
  carrier: { type: "MEMBER" as const, code: "member_001" },
};

/** Capture the decrypted (here just JSON) issue body and return a stock success. */
function issueCapture(into: { body?: Record<string, unknown> }) {
  return http.post(url(EP.issue), async ({ request }) => {
    into.body = (await request.json()) as Record<string, unknown>;
    return ok({ id: 999, invNo: "SX60721900", period: "202605", createTime: "2026-06-18 06:32:38", randNo: "6611" });
  });
}

describe("ezreceiptTaxType + endpoints", () => {
  it.each([
    ["TAXABLE", 1],
    ["ZERO_RATED", 2],
    ["TAX_FREE", 3],
    ["SPECIAL", 1],
  ] as const)("maps %s → %i", (taxType, code) => {
    expect(ezreceiptTaxType(taxType)).toBe(code);
  });

  it("builds path endpoints (invID/awID/stID in the path)", () => {
    expect(EP.view(999)).toBe("/eInvoice/invoice/view/999");
    expect(EP.void(999)).toBe("/eInvoice/invoice/void/999");
    expect(EP.allowanceCreate(1)).toBe("/eInvoice/allowance/create/1");
    expect(EP.allowanceVoid(2)).toBe("/eInvoice/allowance/void/2");
    expect(EP.invNumberList(9905)).toBe("/eInvoice/invNumber/list/9905");
    expect(EP.invNumberList()).toBe("/eInvoice/invNumber/list");
  });
});

describe("capabilities", () => {
  it("declares issue/void/allowance/query + B2B + mixed tax, not foreign currency", () => {
    const p = testProvider();
    for (const c of [Capability.ISSUE, Capability.VOID, Capability.ALLOWANCE, Capability.VOID_ALLOWANCE, Capability.QUERY, Capability.B2B, Capability.MIXED_TAX]) {
      expect(supports(p, c)).toBe(true);
    }
    for (const c of [Capability.FOREIGN_CURRENCY, Capability.CARRIER_VALIDATION, Capability.SCHEDULED_ISSUE]) {
      expect(supports(p, c)).toBe(false);
    }
  });
});

describe("issue", () => {
  it("maps a B2C member-carrier invoice (prodList + carrier + buyer)", async () => {
    const cap: { body?: Record<string, unknown> } = {};
    server.use(loginHandler(), issueCapture(cap));
    const res = await testProvider().issue(b2cInput);
    expect(res).toMatchObject({ invoiceNumber: "SX60721900", randomCode: "6611", orderId: "ORDER_1", totalAmount: 105, status: "ISSUED" });
    expect(res.invoiceDate.getFullYear()).toBe(2026);
    expect(cap.body).toMatchObject({
      prodList: [{ title: "商品", qty: 1, sales: 100, incTax: false, taxType: 1, unit: "件" }],
      carrier: { carrierType: 1, carrierInfo: "member_001" },
      buyer: { accName: "member_001", name: "買受人" },
      trCode: 0,
      msgType: 1,
    });
    expect(cap.body?.issueTo).toBeUndefined();
  });

  it("maps a B2B invoice to issueTo (統編), no carrier", async () => {
    const cap: { body?: Record<string, unknown> } = {};
    server.use(loginHandler(), issueCapture(cap));
    await testProvider().issue({ ...b2cInput, buyer: { ubn: "53538851", name: "歐付寶", address: "台北市" }, carrier: undefined });
    expect(cap.body?.issueTo).toMatchObject({ nid: "53538851", title: "歐付寶", addr: "台北市" });
    expect(cap.body?.carrier).toBeUndefined();
  });

  it("maps a donation to carrierType 5 + charity", async () => {
    const cap: { body?: Record<string, unknown> } = {};
    server.use(loginHandler(), issueCapture(cap));
    await testProvider().issue({ ...b2cInput, carrier: undefined, donation: { npoban: "168001" } });
    expect(cap.body?.carrier).toMatchObject({ carrierType: 5, charity: "168001" });
  });

  it("maps a mobile-barcode carrier (carrierType 2, no buyer)", async () => {
    const cap: { body?: Record<string, unknown> } = {};
    server.use(loginHandler(), issueCapture(cap));
    await testProvider().issue({ ...b2cInput, carrier: { type: "MOBILE_BARCODE", code: "/ABC1234" } });
    expect(cap.body?.carrier).toMatchObject({ carrierType: 2, carrierInfo: "/ABC1234" });
    expect(cap.body?.buyer).toBeUndefined();
  });

  it("maps mixed per-item tax types and tax-inclusive pricing", async () => {
    const cap: { body?: Record<string, unknown> } = {};
    server.use(loginHandler(), issueCapture(cap));
    await testProvider().issue({
      ...b2cInput,
      priceMode: "TAX_INCLUSIVE",
      items: [
        { description: "應稅", quantity: 1, unitPrice: 105, amount: 105, taxType: "TAXABLE" },
        { description: "免稅", quantity: 1, unitPrice: 50, amount: 50, taxType: "TAX_FREE" },
      ],
    });
    expect(cap.body?.prodList).toMatchObject([
      { title: "應稅", incTax: true, taxType: 1 },
      { title: "免稅", incTax: true, taxType: 3 },
    ]);
  });

  it("passes a non-TWD currency through and omits TWD", async () => {
    const usd: { body?: Record<string, unknown> } = {};
    const twd: { body?: Record<string, unknown> } = {};
    server.use(loginHandler(), issueCapture(usd));
    await testProvider().issue({ ...b2cInput, currency: "USD" });
    expect(usd.body?.currency).toBe("USD");
    server.use(issueCapture(twd));
    await testProvider().issue({ ...b2cInput, currency: "TWD" });
    expect(twd.body?.currency).toBeUndefined();
  });

  it("rejects an invoice with no ubn / carrier / donation", async () => {
    server.use(loginHandler());
    await expect(testProvider().issue({ ...b2cInput, carrier: undefined })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("maps ezPay's 1015 (no usable 字軌) to NUMBER_EXHAUSTED", async () => {
    server.use(loginHandler(), http.post(url(EP.issue), () => fail(1015, "無法選擇一組適當的分段字軌來使用。")));
    await expect(testProvider().issue(b2cInput)).rejects.toMatchObject({ code: "NUMBER_EXHAUSTED", rawCode: "1015" });
  });
});

describe("void", () => {
  it("resolves the invID by invoice number, then voids with voidReason", async () => {
    let voidBody: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      listResolves("SX60721900", 999),
      http.post(url(EP.void(999)), async ({ request }) => {
        voidBody = (await request.json()) as Record<string, unknown>;
        return ok({ invID: "999", voidReason: "x", voidTime: "2026-06-18 06:34:43" });
      }),
    );
    const res = await testProvider().void({ invoiceNumber: "SX60721900", reason: "客戶取消" });
    expect(res.status).toBe("VOIDED");
    expect(voidBody).toMatchObject({ voidReason: "客戶取消" });
  });

  it("uses providerOptions.invID directly (no list lookup)", async () => {
    let listed = false;
    server.use(
      loginHandler(),
      http.post(url(EP.list), () => {
        listed = true;
        return ok({ list: [] });
      }),
      http.post(url(EP.void(555)), () => ok({ invID: "555" })),
    );
    await testProvider().void({ invoiceNumber: "SX1", reason: "x", providerOptions: { invID: 555 } });
    expect(listed).toBe(false);
  });

  it("throws NOT_FOUND when the invoice number can't be resolved", async () => {
    server.use(loginHandler(), http.post(url(EP.list), () => ok({ list: [], entries: 0 })));
    await expect(testProvider().void({ invoiceNumber: "NOPE", reason: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a voidReason longer than 20 chars locally", async () => {
    server.use(loginHandler());
    await expect(testProvider().void({ invoiceNumber: "SX1", reason: "x".repeat(21), providerOptions: { invID: 1 } })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("query", () => {
  const viewResult = {
    invID: 999,
    invNo: "SX60721900",
    orderNo: "SS2606000001",
    salesAmount: 100,
    taxAmount: 5,
    invoiceTime: "2026-06-18 06:32:38",
    randNo: "6611",
    procState: 11,
    buyer: { nid: null, name: "買受人", addr: null, phone: null, email: null },
    prodList: [{ soiID: 236520, title: "商品", qty: 1, sales: 100, unit: "件" }],
  };

  it("resolves by invoice number and maps the view to a unified result", async () => {
    server.use(loginHandler(), listResolves("SX60721900", 999), http.post(url(EP.view(999)), () => ok(viewResult)));
    const res = await testProvider().query({ invoiceNumber: "SX60721900" });
    expect(res).toMatchObject({ invoiceNumber: "SX60721900", randomCode: "6611", status: "ISSUED", orderId: "SS2606000001" });
    expect(res.amount).toEqual({ salesAmount: 100, taxAmount: 5, totalAmount: 105 });
    expect(res.buyer.name).toBe("買受人");
    expect(res.items[0]).toMatchObject({ description: "商品", quantity: 1, unitPrice: 100, unit: "件" });
  });

  it("maps procState 13 to VOIDED", async () => {
    server.use(loginHandler(), http.post(url(EP.view(999)), () => ok({ ...viewResult, procState: 13 })));
    const res = await testProvider().query({ invoiceNumber: "SX60721900", providerOptions: { invID: 999 } });
    expect(res.status).toBe("VOIDED");
  });

  it("throws VALIDATION when neither invoiceNumber nor invID is given", async () => {
    server.use(loginHandler());
    await expect(testProvider().query({})).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("allowance", () => {
  it("views the invoice for soiIDs, then credits the lines (amount + tax)", async () => {
    let allowBody: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      listResolves("SX60721900", 999),
      http.post(url(EP.view(999)), () => ok({ prodList: [{ soiID: 236520, saleTax: 5 }] })),
      http.post(url(EP.allowanceCreate(999)), async ({ request }) => {
        allowBody = (await request.json()) as Record<string, unknown>;
        return ok({ awID: 883, awNo: "S26SX607219001", createTime: "2026-06-18 06:39:52" });
      }),
    );
    const res = await testProvider().allowance({
      invoiceNumber: "SX60721900",
      allowanceId: "A1",
      items: [{ description: "商品", quantity: 1, unitPrice: 100, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
    });
    expect(res).toMatchObject({ allowanceNumber: "S26SX607219001", invoiceNumber: "SX60721900", totalAmount: 105 });
    expect(allowBody?.prodList).toMatchObject([{ soiID: 236520, qty: 1, amount: 100, tax: 5 }]);
  });

  it("honours a per-line tax override via providerOptions.itemTax", async () => {
    let allowBody: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      http.post(url(EP.view(999)), () => ok({ prodList: [{ soiID: 1, saleTax: 5 }] })),
      http.post(url(EP.allowanceCreate(999)), async ({ request }) => {
        allowBody = (await request.json()) as Record<string, unknown>;
        return ok({ awID: 1, awNo: "A" });
      }),
    );
    await testProvider().allowance({
      invoiceNumber: "SX1",
      allowanceId: "A1",
      items: [{ description: "x", quantity: 1, unitPrice: 50, amount: 50 }],
      amount: { salesAmount: 50, taxAmount: 3, totalAmount: 53 },
      providerOptions: { invID: 999, itemTax: [3] },
    });
    expect(allowBody?.prodList).toMatchObject([{ tax: 3 }]);
  });
});

describe("voidAllowance", () => {
  it("voids by the allowance awID from providerOptions", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      http.post(url(EP.allowanceVoid(883)), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok({ awID: "883" });
      }),
    );
    const res = await testProvider().voidAllowance({ invoiceNumber: "SX1", allowanceNumber: "S26SX607219001", reason: "測試", providerOptions: { awID: 883 } });
    expect(res.allowanceNumber).toBe("S26SX607219001");
    expect(body).toMatchObject({ voidReason: "測試" });
  });

  it("requires providerOptions.awID", async () => {
    server.use(loginHandler());
    await expect(testProvider().voidAllowance({ invoiceNumber: "SX1", allowanceNumber: "A" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects a reason longer than 20 chars", async () => {
    server.use(loginHandler());
    await expect(
      testProvider().voidAllowance({ invoiceNumber: "SX1", allowanceNumber: "A", reason: "x".repeat(21), providerOptions: { awID: 1 } }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

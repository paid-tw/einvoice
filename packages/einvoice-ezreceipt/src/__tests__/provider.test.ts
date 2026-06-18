import { Capability, supports } from "@paid-tw/einvoice";
import { http } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EZRECEIPT_ENDPOINTS as EP, ezreceiptTaxType } from "../index.js";
import { fail, file, listResolves, loginHandler, ok, server, testProvider, url } from "./server.js";

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
    expect(EP.allowanceCreate).toBe("/eInvoice/allowance/create");
    expect(EP.allowanceVoid(2)).toBe("/eInvoice/allowance/void/2");
    expect(EP.allowanceConfirm(3)).toBe("/eInvoice/allowance/confirm/3");
    expect(EP.allowanceBuyerConfirm(4)).toBe("/eInvoice/allowance/buyerConfirm/4");
    expect(EP.allowanceConfirmVoid(5)).toBe("/eInvoice/allowance/confirmVoid/5");
    expect(EP.allowanceView(7)).toBe("/eInvoice/allowance/view/7");
    expect(EP.allowanceList).toBe("/eInvoice/allowance/list");
    expect(EP.allowanceUpdateItems(6)).toBe("/eInvoice/allowance/updateItems/6");
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

  it("passes invoiceTime (from date), zero-rated fields, and self-assigned number through", async () => {
    const cap: { body?: Record<string, unknown> } = {};
    server.use(loginHandler(), issueCapture(cap));
    await testProvider().issue({
      ...b2cInput,
      taxType: "ZERO_RATED",
      date: new Date("2026-06-18T06:00:00Z"), // → 2026-06-18 14:00:00 Asia/Taipei
      providerOptions: { zeroTaxReason: 71, clearanceMark: 1, invNo: "SX60721900", autoInvNo: true, winvNo: "W1", randNo: "1234" },
    });
    expect(cap.body).toMatchObject({
      invoiceTime: "2026-06-18 14:00:00",
      zeroTaxReason: 71,
      isCustom: 1,
      invNo: "SX60721900",
      autoInvNo: true,
      winvNo: "W1",
      randNo: "1234",
    });
    // ZERO_RATED item → taxType 2
    expect((cap.body?.prodList as Array<{ taxType: number }>)[0]?.taxType).toBe(2);
  });

  it("records the orderId as order.orderNo and passes sendTo / credit4 / order overrides", async () => {
    const cap: { body?: Record<string, unknown> } = {};
    server.use(loginHandler(), issueCapture(cap));
    await testProvider().issue({
      ...b2cInput,
      providerOptions: { order: { title: "訂單標題", discount: 10 }, sendTo: { name: "收件人", addr: "台北" }, credit4: "1234" },
    });
    expect(cap.body?.order).toEqual({ orderNo: "ORDER_1", title: "訂單標題", discount: 10 });
    expect(cap.body?.sendTo).toMatchObject({ name: "收件人" });
    expect(cap.body?.credit4).toBe("1234");
  });

  it("flags a negative-priced line as a discount (mcType 100) and passes issueTo.isNonprofit", async () => {
    const cap: { body?: Record<string, unknown> } = {};
    server.use(loginHandler(), issueCapture(cap));
    await testProvider().issue({
      ...b2cInput,
      buyer: { ubn: "53538851", name: "機關", address: "台北" },
      carrier: undefined,
      items: [
        { description: "商品", quantity: 1, unitPrice: 100, amount: 100 },
        { description: "折扣", quantity: 1, unitPrice: -20, amount: -20 },
      ],
      providerOptions: { isNonprofit: true },
    });
    const prodList = cap.body?.prodList as Array<Record<string, unknown>>;
    expect(prodList[0]?.mcType).toBeUndefined();
    expect(prodList[1]?.mcType).toBe(100);
    expect(cap.body?.issueTo).toMatchObject({ nid: "53538851", isNonprofit: true });
  });

  it("annotates a carrier invoice with a 統編 (carrier + issueTo coexist)", async () => {
    const cap: { body?: Record<string, unknown> } = {};
    server.use(loginHandler(), issueCapture(cap));
    await testProvider().issue({
      ...b2cInput,
      buyer: { name: "歐付寶", ubn: "53538851" },
      carrier: { type: "MOBILE_BARCODE", code: "/ABC1234" },
    });
    expect(cap.body?.carrier).toMatchObject({ carrierType: 2, carrierInfo: "/ABC1234" });
    expect(cap.body?.issueTo).toMatchObject({ nid: "53538851", title: "歐付寶" });
    expect(cap.body?.buyer).toBeUndefined(); // barcode carrier → no member buyer
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

  it("forwards voidOrder to also void the underlying order", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      http.post(url(EP.void(7)), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok({ invID: "7" });
      }),
    );
    await testProvider().void({ invoiceNumber: "SX1", reason: "退貨", providerOptions: { invID: 7, voidOrder: true } });
    expect(body).toEqual({ voidReason: "退貨", voidOrder: true });
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

  it("maps procState 13 (作廢) and 30 (註銷) to VOIDED", async () => {
    for (const procState of [13, 30]) {
      server.use(loginHandler(), http.post(url(EP.view(999)), () => ok({ ...viewResult, procState })));
      const res = await testProvider().query({ invoiceNumber: "SX60721900", providerOptions: { invID: 999 } });
      expect(res.status).toBe("VOIDED");
    }
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
      http.post(url(EP.allowanceCreate), async ({ request }) => {
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

  it("passes allowTime and needConfirm through from providerOptions", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      http.post(url(EP.view(7)), () => ok({ prodList: [{ soiID: 1, saleTax: 5 }] })),
      http.post(url(EP.allowanceCreate), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok({ awID: 1, awNo: "A" });
      }),
    );
    await testProvider().allowance({
      invoiceNumber: "SX1",
      allowanceId: "A1",
      items: [{ description: "x", quantity: 1, unitPrice: 100, amount: 100 }],
      amount: { salesAmount: 100, taxAmount: 5, totalAmount: 105 },
      providerOptions: { invID: 7, allowTime: "2026-06-18 07:00:00", needConfirm: true },
    });
    expect(body).toMatchObject({ allowTime: "2026-06-18 07:00:00", needConfirm: true });
  });

  it("honours a per-line tax override via providerOptions.itemTax", async () => {
    let allowBody: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      http.post(url(EP.view(999)), () => ok({ prodList: [{ soiID: 1, saleTax: 5 }] })),
      http.post(url(EP.allowanceCreate), async ({ request }) => {
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

describe("revokeInvoice (extension)", () => {
  it("resolves the invID and revokes with a reason", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      listResolves("SX60721900", 999),
      http.post(url(EP.invoiceRevoke(999)), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok({ invID: 999, revokeReason: "打錯", revokeTime: "2026-06-18 09:00:00" });
      }),
    );
    const res = await testProvider().revokeInvoice("SX60721900", "打錯", { revokeTime: "2026-06-18 09:00:00" });
    expect(res.invID).toBe(999);
    expect(body).toEqual({ revokeReason: "打錯", revokeTime: "2026-06-18 09:00:00" });
  });

  it("rejects a reason longer than 20 chars", async () => {
    server.use(loginHandler());
    await expect(testProvider().revokeInvoice("SX1", "x".repeat(21), { providerOptions: { invID: 1 } })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("maps a state-disallowed revoke (1018) to CONFLICT", async () => {
    server.use(loginHandler(), http.post(url(EP.invoiceRevoke(1)), () => fail(1018, "發票目前的狀態無法執行作廢、註銷或退回。")));
    await expect(testProvider().revokeInvoice("SX1", "x", { providerOptions: { invID: 1 } })).rejects.toMatchObject({ code: "CONFLICT", rawCode: "1018" });
  });
});

describe("replyInvoice (extension)", () => {
  it("confirms a 交換 invoice issue with a buyerRemark", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      listResolves("SX60721900", 999),
      http.post(url(EP.invoiceReply(999)), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok({ invID: 999, action: 1 });
      }),
    );
    const res = await testProvider().replyInvoice("SX60721900", "ISSUE", { buyerRemark: 1 });
    expect(res).toMatchObject({ invID: 999, action: 1 });
    expect(body).toEqual({ action: 1, buyerRemark: 1 });
  });

  it("maps ISSUE/VOID/RETURN to action 1/2/3", async () => {
    const seen: number[] = [];
    server.use(
      loginHandler(),
      http.post(url(EP.invoiceReply(5)), async ({ request }) => {
        seen.push(((await request.json()) as { action: number }).action);
        return ok({ invID: 5, action: 0 });
      }),
    );
    const p = testProvider();
    await p.replyInvoice("SX1", "ISSUE", { providerOptions: { invID: 5 } });
    await p.replyInvoice("SX1", "VOID", { providerOptions: { invID: 5 } });
    await p.replyInvoice("SX1", "RETURN", { providerOptions: { invID: 5 } });
    expect(seen).toEqual([1, 2, 3]);
  });

  it("maps a state-disallowed confirm (1031) to CONFLICT", async () => {
    server.use(loginHandler(), http.post(url(EP.invoiceReply(5)), () => fail(1031, "現有狀態不能執行確認開立")));
    await expect(testProvider().replyInvoice("SX1", "ISSUE", { providerOptions: { invID: 5 } })).rejects.toMatchObject({ code: "CONFLICT", rawCode: "1031" });
  });
});

describe("listInvoices (extension)", () => {
  it("maps the filters and returns rows + entries", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      http.post(url(EP.list), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok({ list: [{ invNo: "SX60721900" }], entries: 1 });
      }),
    );
    const res = await testProvider().listInvoices({ period: "202606", prop: "nid", propValue: "53538851", carrierType: 2, voided: false, msgType: 1, withUbn: true, page: 1, pageSize: 50 });
    expect(res).toEqual({ entries: 1, list: [{ invNo: "SX60721900" }] });
    expect(body).toEqual({ period: "202606", prop: "nid", propValue: "53538851", carrierType: 2, isVoid: 0, msgType: 1, withGUINo: true, _pn: 1, _ps: 50 });
  });

  it("uses a fromTime/toTime range when given", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      http.post(url(EP.list), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok({ list: [], entries: 0 });
      }),
    );
    await testProvider().listInvoices({ fromTime: "2026-01-01 00:00:00", toTime: "2026-06-30 23:59:59", voided: true });
    expect(body).toEqual({ fromTime: "2026-01-01 00:00:00", toTime: "2026-06-30 23:59:59", isVoid: 1 });
  });
});

describe("printAllowance (extension)", () => {
  it("requests the allowance print file and returns the bytes", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      http.post(url(EP.proofAwPrint), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return file([0x25, 0x50, 0x44, 0x46]);
      }),
    );
    const res = await testProvider().printAllowance([888], { zipped: true, format: 2 });
    expect(body).toEqual({ awList: [888], isZipped: true, format: 2 });
    expect(res.contentType).toContain("pdf");
    expect(res.data.length).toBe(4);
  });
});

describe("notifyAllowance (extension)", () => {
  it("maps the event to eventType and forwards awList / forceToBuyer", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      http.post(url(EP.notificationAllowance), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok({});
      }),
    );
    await testProvider().notifyAllowance([888, 889], "VOID", { forceToBuyer: true });
    expect(body).toEqual({ awList: [888, 889], eventType: 8, forceToBuyer: true });
  });

  it("maps the four events to 6/7/8/9", async () => {
    const seen: number[] = [];
    server.use(
      loginHandler(),
      http.post(url(EP.notificationAllowance), async ({ request }) => {
        seen.push(((await request.json()) as { eventType: number }).eventType);
        return ok({});
      }),
    );
    const p = testProvider();
    await p.notifyAllowance([1], "CREATE");
    await p.notifyAllowance([1], "CONFIRM");
    await p.notifyAllowance([1], "VOID");
    await p.notifyAllowance([1], "VOID_CONFIRM");
    expect(seen).toEqual([6, 7, 8, 9]);
  });
});

describe("notifyInvoice (extension)", () => {
  it("maps the event + forwards invList / format / action", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      http.post(url(EP.notificationInvoice), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok({});
      }),
    );
    await testProvider().notifyInvoice([999], "ISSUE", { format: 25, action: 1, forceToBuyer: true });
    expect(body).toEqual({ invList: [999], eventType: 1, forceToBuyer: true, format: 25, action: 1 });
  });

  it("maps the six events to 1/2/4/5/20/30", async () => {
    const seen: number[] = [];
    server.use(
      loginHandler(),
      http.post(url(EP.notificationInvoice), async ({ request }) => {
        seen.push(((await request.json()) as { eventType: number }).eventType);
        return ok({});
      }),
    );
    const p = testProvider();
    for (const e of ["ISSUE", "CONFIRM", "VOID", "VOID_CONFIRM", "WON", "REQUEST"] as const) await p.notifyInvoice([1], e);
    expect(seen).toEqual([1, 2, 4, 5, 20, 30]);
  });
});

describe("getAllowanceQuota (extension)", () => {
  it("resolves the invID and returns each line's remaining creditable quota", async () => {
    server.use(
      loginHandler(),
      listResolves("SX60721900", 999),
      http.post(url(EP.allowQuota(999)), () => ok({ itemList: [{ soiID: 236552, qty: 3, amount: 300, tax: 15 }] })),
    );
    const res = await testProvider().getAllowanceQuota("SX60721900");
    expect(res).toEqual([{ soiID: 236552, qty: 3, amount: 300, tax: 15 }]);
  });

  it("maps an app without sales entitlement (1026) to AUTH", async () => {
    server.use(loginHandler(), http.post(url(EP.allowQuota(5)), () => fail(1026, "這個應用程式並未具有銷售功能的使用資格。")));
    await expect(testProvider().getAllowanceQuota("SX1", { invID: 5 })).rejects.toMatchObject({ code: "AUTH", rawCode: "1026" });
  });
});

describe("字軌 management (extension)", () => {
  const track = { inID: 21307, period: "202605", lead: "SX", startNo: 60721900, endNo: 60722399, invType: 7, bizType: 0, isClosed: 0, platform: 1 };

  it("lists 字軌 tracks with the given filters", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      http.post(url(EP.invNumberList()), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok({ list: [track], entries: 1 });
      }),
    );
    const res = await testProvider().listInvoiceTracks({ period: "202605", invType: 7, bizType: 0, forceBiz: true, activeOnly: true, platform: 1, order: "ASC", page: 1, pageSize: 50 });
    expect(res).toEqual([track]);
    expect(body).toMatchObject({ period: "202605", invType: 7, bizType: 0, forceBiz: true, isActive: 1, platform: 1, dspOrder: 2, _pn: 1, _ps: 50 });
  });

  it("targets the stID path when configured (partner access)", async () => {
    server.use(loginHandler(), http.post(url(EP.invNumberList(9905)), () => ok({ list: [], entries: 0 })));
    await expect(testProvider({ stID: 9905 }).listInvoiceTracks()).resolves.toEqual([]);
  });

  it("adjusts a track's start/end number (sent as strings)", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      http.post(url(EP.invNumberAdjustNo(21307)), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok({ ...track, startNo: 60721950 });
      }),
    );
    const res = await testProvider().adjustInvoiceTrack(21307, { startNo: 60721950 });
    expect(res.startNo).toBe(60721950);
    expect(body).toEqual({ startNo: "60721950" });
  });

  it("rejects an adjust with neither startNo nor endNo", async () => {
    server.use(loginHandler());
    await expect(testProvider().adjustInvoiceTrack(21307, {})).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("maps an invalid track id (20) to NOT_FOUND", async () => {
    server.use(loginHandler(), http.post(url(EP.invNumberAdjustNo(1)), () => fail(20, "字軌分段識別碼無效")));
    await expect(testProvider().adjustInvoiceTrack(1, { endNo: 60722399 })).rejects.toMatchObject({ code: "NOT_FOUND", rawCode: "20" });
  });

  it("opens/closes a track (action 0/1)", async () => {
    const seen: Record<string, unknown>[] = [];
    server.use(
      loginHandler(),
      http.post(url(EP.invNumberClose(21307)), async ({ request }) => {
        seen.push((await request.json()) as Record<string, unknown>);
        return ok({ inID: 21307, action: seen.length === 1 ? 1 : 0 });
      }),
    );
    expect((await testProvider().setInvoiceTrackStatus(21307, "CLOSE")).action).toBe(1);
    expect((await testProvider().setInvoiceTrackStatus(21307, "OPEN")).action).toBe(0);
    expect(seen).toEqual([{ action: 1 }, { action: 0 }]);
  });

  it("maps an exhausted-track close (1216) to CONFLICT", async () => {
    server.use(loginHandler(), http.post(url(EP.invNumberClose(1)), () => fail(1216, "號碼已使用完畢的字軌，無法再做開啟或關閉。")));
    await expect(testProvider().setInvoiceTrackStatus(1, "OPEN")).rejects.toMatchObject({ code: "CONFLICT", rawCode: "1216" });
  });

  it("sets and clears a track's print logo (sgoID, null clears)", async () => {
    const seen: Record<string, unknown>[] = [];
    server.use(
      loginHandler(),
      http.post(url(EP.invNumberSetLogo(21307)), async ({ request }) => {
        seen.push((await request.json()) as Record<string, unknown>);
        return ok({ inID: 21307 });
      }),
    );
    await testProvider().setInvoiceTrackLogo(21307, 42);
    await testProvider().setInvoiceTrackLogo(21307, null);
    expect(seen).toEqual([{ sgoID: 42 }, { sgoID: null }]);
  });

  it("splits a track at startNo (sent as string), returning the back segment", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      http.post(url(EP.invNumberSplit(21307)), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok({ inID: 21308, startNo: 60722000, bizType: 1, memo: "後段" });
      }),
    );
    const res = await testProvider().splitInvoiceTrack(21307, { startNo: 60722000, bizType: 1, memo: "後段" });
    expect(res).toMatchObject({ inID: 21308, startNo: 60722000, bizType: 1 });
    expect(body).toEqual({ startNo: "60722000", bizType: 1, memo: "後段" });
  });

  it("maps a split on an open track (1222) to CONFLICT", async () => {
    server.use(loginHandler(), http.post(url(EP.invNumberSplit(1)), () => fail(1222, "字軌必須在關閉（停止使用）的狀態，才能進行分段作業。")));
    await expect(testProvider().splitInvoiceTrack(1, { startNo: 60722000 })).rejects.toMatchObject({ code: "CONFLICT", rawCode: "1222" });
  });

  it("updates a track's bizType / platform / memo", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      loginHandler(),
      http.post(url(EP.invNumberUpdate(21307)), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok({ inID: 21307, bizType: 2, platform: 1, memo: "備註" });
      }),
    );
    const res = await testProvider().updateInvoiceTrack(21307, { bizType: 2, platform: 1, memo: "備註" });
    expect(res).toMatchObject({ inID: 21307, bizType: 2, platform: 1 });
    expect(body).toEqual({ bizType: 2, platform: 1, memo: "備註" });
  });

  it("maps a platform-already-set update (1201) to CONFLICT", async () => {
    server.use(loginHandler(), http.post(url(EP.invNumberUpdate(1)), () => fail(1201, "此字軌已設定過使用平台，無法再次變更使用平台")));
    await expect(testProvider().updateInvoiceTrack(1, { platform: 100 })).rejects.toMatchObject({ code: "CONFLICT", rawCode: "1201" });
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

  it("resolves the awID by allowance number via allowance/list", async () => {
    let voidedAw: string | undefined;
    server.use(
      loginHandler(),
      http.post(url(EP.allowanceList), () => ok({ list: [{ awNo: "S26SX607219001", awID: 883 }], entries: 1 })),
      http.post(url(EP.allowanceVoid(883)), () => {
        voidedAw = "883";
        return ok({ awID: "883" });
      }),
    );
    const res = await testProvider().voidAllowance({ invoiceNumber: "SX1", allowanceNumber: "S26SX607219001", reason: "x" });
    expect(res.allowanceNumber).toBe("S26SX607219001");
    expect(voidedAw).toBe("883");
  });

  it("throws NOT_FOUND when the allowance number can't be resolved", async () => {
    server.use(loginHandler(), http.post(url(EP.allowanceList), () => ok({ list: [], entries: 0 })));
    await expect(testProvider().voidAllowance({ invoiceNumber: "SX1", allowanceNumber: "NOPE" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a reason longer than 20 chars", async () => {
    server.use(loginHandler());
    await expect(
      testProvider().voidAllowance({ invoiceNumber: "SX1", allowanceNumber: "A", reason: "x".repeat(21), providerOptions: { awID: 1 } }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

import { describe, expect, it } from "vitest";
import { type InvoiceDebugEvent, tracedFetch } from "./debug.js";

const okFetch = (status = 200) => (async () => new Response("ok", { status })) as typeof fetch;

describe("tracedFetch", () => {
  it("passes through (and emits nothing) when debug is unset", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const res = await tracedFetch({ provider: "p", fetch: f }, "https://x/y", { method: "POST" });
    expect(calls).toBe(1);
    expect(res.status).toBe(200);
  });

  it("emits request then response with status and duration", async () => {
    const events: InvoiceDebugEvent[] = [];
    await tracedFetch(
      { provider: "ezpay", debug: (e) => events.push(e), fetch: okFetch(201) },
      "https://api/x",
      { method: "POST" },
    );
    expect(events.map((e) => e.phase)).toEqual(["request", "response"]);
    expect(events[1]).toMatchObject({
      provider: "ezpay",
      method: "POST",
      url: "https://api/x",
      status: 201,
    });
    expect(typeof events[1]!.durationMs).toBe("number");
  });

  it("emits an error event and rethrows the transport error", async () => {
    const events: InvoiceDebugEvent[] = [];
    const boom = new Error("down");
    const f = (async () => {
      throw boom;
    }) as typeof fetch;
    await expect(
      tracedFetch({ provider: "amego", debug: (e) => events.push(e), fetch: f }, "https://x", {
        method: "GET",
      }),
    ).rejects.toBe(boom);
    expect(events.map((e) => e.phase)).toEqual(["request", "error"]);
    expect(events[1]).toMatchObject({ provider: "amego", error: boom });
  });

  it("never lets a throwing logger break the request", async () => {
    const res = await tracedFetch(
      {
        provider: "p",
        debug: () => {
          throw new Error("logger bug");
        },
        fetch: okFetch(),
      },
      "https://x",
      { method: "GET" },
    );
    expect(res.status).toBe(200);
  });
});

/**
 * Opt-in request tracing. Set `debug` on a provider config to observe the HTTP
 * traffic an adapter makes. Events are metadata only — method, URL, status,
 * duration, and any transport error — not request/response bodies: those are
 * encrypted on the wire for some providers and may carry PII for others. To
 * capture raw bodies, wrap the `fetch` override instead.
 */
export interface InvoiceDebugEvent {
  /** The provider that made the call (e.g. `"ezpay"`). */
  provider: string;
  phase: "request" | "response" | "error";
  method: string;
  url: string;
  /** HTTP status — `response` phase only. */
  status?: number;
  /** Wall-clock duration in ms — `response` and `error` phases. */
  durationMs?: number;
  /** The transport error — `error` phase only. */
  error?: unknown;
}

export type InvoiceDebugLogger = (event: InvoiceDebugEvent) => void;

function emit(logger: InvoiceDebugLogger, event: InvoiceDebugEvent): void {
  try {
    logger(event);
  } catch {
    // A debug logger must never break a request.
  }
}

/**
 * Run `fetch` while emitting request/response/error trace events to `debug`.
 * When `debug` is unset this is a direct passthrough with no added work.
 */
export async function tracedFetch(
  ctx: { provider: string; debug?: InvoiceDebugLogger; fetch: typeof fetch },
  url: string,
  init: RequestInit,
): Promise<Response> {
  const { provider, debug } = ctx;
  if (!debug) return ctx.fetch(url, init);

  const method = init.method ?? "GET";
  const start = Date.now();
  emit(debug, { provider, phase: "request", method, url });
  try {
    const res = await ctx.fetch(url, init);
    emit(debug, {
      provider,
      phase: "response",
      method,
      url,
      status: res.status,
      durationMs: Date.now() - start,
    });
    return res;
  } catch (error) {
    emit(debug, { provider, phase: "error", method, url, durationMs: Date.now() - start, error });
    throw error;
  }
}

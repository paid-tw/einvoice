import { createHash } from "node:crypto";
import { InvoiceError, InvoiceErrorCode } from "@paid-tw/einvoice";
import { type EzreceiptConfig, resolveBaseUrl } from "./config.js";
import { ENDPOINTS } from "./endpoints.js";

/** The COIMOTION response envelope. `code === 0` is success. */
export interface EzreceiptEnvelope {
  code: number;
  message?: string;
  value?: unknown;
  token?: { token: string; validTo: number };
}

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

/** Login password hash: `sha1(sha1(accName) + plaintextPassword)`. */
export function hashPassword(accName: string, password: string): string {
  return sha1(sha1(accName) + password);
}

/**
 * Map a COIMOTION numeric error code to a unified {@link InvoiceErrorCode}.
 * Verified codes are listed explicitly; the fallbacks treat negative codes as
 * provider/transport errors and positive (field/business) codes as validation.
 */
export function mapEzreceiptError(code: number): InvoiceErrorCode {
  switch (code) {
    // token / appKey / appCode / login / account-level
    case -3:
    case -5:
    case -10:
    case -20:
    case -110:
    case 306:
    case 307:
    case 308:
    case 331:
    case 1016:
    case 1026:
      return InvoiceErrorCode.AUTH;
    // unknown order / store / invoice / allowance / 字軌 / item id
    case 10:
    case 11:
    case 12:
    case 20:
    case 30:
    case 122:
    case 224:
    case 1336:
      return InvoiceErrorCode.NOT_FOUND;
    // no usable 字軌 segment
    case 1015:
      return InvoiceErrorCode.NUMBER_EXHAUSTED;
    // invalid state for the operation (invoice / allowance already confirmed,
    // voided, expired, closed period, B2B/B2C number conflict, …)
    case 1003:
    case 1004:
    case 1005:
    case 1008:
    case 1010:
    case 1012:
    case 1014:
    case 1023:
    case 1018:
    case 1019:
    case 1031:
    case 1032:
    case 1033:
    case 1070:
    case 1201:
    case 1202:
    case 1203:
    case 1205:
    case 1215:
    case 1216:
    case 1218:
    case 1017:
    case 1020:
    case 1039:
    case 1042:
    case 1043:
    case 1045:
    case 1055:
    case 1068:
    case 1073:
    case 1074:
    case 1300:
    case 1222:
    case 1310:
    case 1311:
    case 1312:
      return InvoiceErrorCode.CONFLICT;
  }
  if (code === -15 || code < 0) return InvoiceErrorCode.PROVIDER;
  // field- and business-rule validation family (1, 2, 1xx, 3xx, 4xx, 10xx…)
  return InvoiceErrorCode.VALIDATION;
}

/**
 * Stateful ezReceipt client: holds the access token, logs in lazily, and
 * transparently re-logs in once on a `-3 Invalid token`. Throws an
 * {@link InvoiceError} on any non-zero `code`; returns the `value` on success.
 */
export class EzreceiptClient {
  private token?: string;

  constructor(private readonly config: EzreceiptConfig) {
    this.token = config.token;
  }

  /** The (possibly cached) access token, logging in if necessary. */
  async ensureToken(): Promise<string> {
    if (this.token) return this.token;
    return this.login();
  }

  /** Force a fresh login and cache the new token. */
  async login(): Promise<string> {
    if (!this.config.password) {
      throw new InvoiceError("ezReceipt login requires a password (or a pre-obtained token)", {
        provider: "ezreceipt",
        code: InvoiceErrorCode.AUTH,
        rawMessage: "missing password",
      });
    }
    const env = await this.post(ENDPOINTS.login, {
      accName: this.config.accName,
      passwd: hashPassword(this.config.accName, this.config.password),
    });
    if (env.code !== 0 || !env.token?.token) {
      throw new InvoiceError(env.message || "ezReceipt login failed", {
        provider: "ezreceipt",
        code: mapEzreceiptError(env.code),
        rawCode: String(env.code),
        rawMessage: env.message,
        raw: env,
      });
    }
    this.token = env.token.token;
    return this.token;
  }

  /**
   * Authenticated request. Ensures a token, POSTs the body, and on `-3` re-logs
   * in once and retries. Returns `value` on `code === 0`, else throws.
   */
  async request<T = Record<string, unknown>>(path: string, body?: Record<string, unknown>): Promise<T> {
    await this.ensureToken();
    let env = await this.post(path, body);
    if (env.code === -3) {
      await this.login();
      env = await this.post(path, body);
    }
    if (env.code !== 0) {
      throw new InvoiceError(env.message || `ezReceipt error ${env.code}`, {
        provider: "ezreceipt",
        code: mapEzreceiptError(env.code),
        rawCode: String(env.code),
        rawMessage: env.message,
        raw: env,
      });
    }
    return (env.value ?? {}) as T;
  }

  /**
   * Authenticated FILE request — for proof/print endpoints that stream a PDF/ZIP
   * instead of a JSON envelope. On success returns the bytes + content-type; on
   * an error the API still replies with a JSON envelope, which is thrown. Re-logs
   * in once on `-3` like {@link request}.
   */
  async requestFile(path: string, body?: Record<string, unknown>): Promise<{ contentType: string; data: Uint8Array }> {
    await this.ensureToken();
    let res = await this.postRaw(path, body);
    if (isJson(res)) {
      const env = (await res.json()) as EzreceiptEnvelope;
      if (env.code !== -3) throw this.envError(env);
      await this.login();
      res = await this.postRaw(path, body);
      if (isJson(res)) throw this.envError((await res.json()) as EzreceiptEnvelope);
    }
    return {
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      data: new Uint8Array(await res.arrayBuffer()),
    };
  }

  /** Build an {@link InvoiceError} from a non-success envelope. */
  private envError(env: EzreceiptEnvelope): InvoiceError {
    return new InvoiceError(env.message || `ezReceipt error ${env.code}`, {
      provider: "ezreceipt",
      code: mapEzreceiptError(env.code),
      rawCode: String(env.code),
      rawMessage: env.message,
      raw: env,
    });
  }

  /** Low-level POST returning the raw envelope (no error throwing). */
  private async post(path: string, body?: Record<string, unknown>): Promise<EzreceiptEnvelope> {
    const res = await this.postRaw(path, body);
    try {
      return (await res.json()) as EzreceiptEnvelope;
    } catch (cause) {
      throw new InvoiceError("ezReceipt returned a non-JSON response", {
        provider: "ezreceipt",
        code: InvoiceErrorCode.PROVIDER,
        rawCode: String(res.status),
        cause,
      });
    }
  }

  /** Low-level POST returning the raw {@link Response} (NETWORK error on transport failure). */
  private async postRaw(path: string, body?: Record<string, unknown>): Promise<Response> {
    const doFetch = this.config.fetch ?? fetch;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-deva-appcode": this.config.appCode,
      "x-deva-appkey": this.config.appKey,
      "x-deva-locale": "zh",
    };
    if (this.token && path !== ENDPOINTS.login) headers["x-deva-token"] = this.token;
    if (this.config.stID != null) headers["x-deva-stid"] = String(this.config.stID);

    try {
      return await doFetch(`${resolveBaseUrl(this.config)}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body ?? {}),
        signal: this.config.timeoutMs ? AbortSignal.timeout(this.config.timeoutMs) : undefined,
      });
    } catch (cause) {
      throw new InvoiceError("ezReceipt request failed", {
        provider: "ezreceipt",
        code: InvoiceErrorCode.NETWORK,
        cause,
      });
    }
  }
}

/** Does the response carry a JSON body (an error envelope) rather than a file? */
function isJson(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").includes("application/json");
}

import { assertSupports, Capability } from "./capabilities.js";
import { InvoiceError, InvoiceErrorCode } from "./errors.js";
import type { InvoiceProvider } from "./provider.js";
import {
  allowanceInputSchema,
  issueInvoiceInputSchema,
  parseInput,
  queryInvoiceInputSchema,
  voidAllowanceInputSchema,
  voidInvoiceInputSchema,
} from "./schemas.js";
import {
  type AllowanceInput,
  type AllowanceResult,
  InvoiceStatus,
  type IssueInvoiceInput,
  type IssueInvoiceResult,
  type QueryInvoiceInput,
  type QueryInvoiceResult,
  type VoidAllowanceInput,
  type VoidAllowanceResult,
  type VoidInvoiceInput,
  type VoidInvoiceResult,
} from "./types.js";

interface StoredInvoice {
  input: IssueInvoiceInput;
  result: IssueInvoiceResult;
  status: InvoiceStatus;
}

/** What a default MockProvider declares — everything. */
const ALL_CAPABILITIES: readonly Capability[] = [
  Capability.ISSUE,
  Capability.VOID,
  Capability.ALLOWANCE,
  Capability.VOID_ALLOWANCE,
  Capability.QUERY,
  Capability.B2B,
  Capability.MIXED_TAX,
  Capability.QUERY_BY_ORDER_ID,
  Capability.SCHEDULED_ISSUE,
  Capability.CARRIER_VALIDATION,
  Capability.FOREIGN_CURRENCY,
];

export interface MockProviderOptions {
  /** Prefix for generated invoice numbers (the 字軌, 2 letters). */
  track?: string;
  /** Deterministic sequence start for generated numbers. */
  seq?: number;
  /**
   * Restrict the declared capabilities to simulate a specific provider profile.
   * Defaults to all. With FOREIGN_CURRENCY omitted, `issue` rejects a non-TWD
   * `currency` with `UNSUPPORTED`, like a real domestic adapter.
   */
  capabilities?: Iterable<Capability>;
}

/**
 * In-memory {@link InvoiceProvider} for tests and local development. It runs the
 * same validation as a real adapter (the shared schemas, via `parseInput`) but
 * never hits the network, so application code can be exercised end-to-end without
 * credentials.
 *
 * It mirrors real-adapter behaviour beyond the happy path: capability gating (a
 * non-TWD `currency` is rejected unless FOREIGN_CURRENCY is declared), an
 * in-memory state machine (`void`/`allowance` respect the invoice's status), and
 * {@link failNext} to inject a one-shot failure for exercising error handling.
 */
export class MockProvider implements InvoiceProvider {
  readonly name = "mock";
  readonly capabilities: ReadonlySet<Capability>;
  private readonly track: string;
  private seq: number;
  private readonly invoices = new Map<string, StoredInvoice>();
  private readonly byOrderId = new Map<string, string>();
  private readonly allowances = new Set<string>();
  private allowanceSeq = 0;
  private queuedFailure?: InvoiceError;

  constructor(options: MockProviderOptions = {}) {
    this.track = options.track ?? "MK";
    this.seq = options.seq ?? 10_000_000;
    this.capabilities = new Set(options.capabilities ?? ALL_CAPABILITIES);
  }

  /**
   * Make the next operation reject with `error`, then clear it. Use it to
   * exercise a caller's error handling for transport/provider failures the
   * happy-path mock would never produce (e.g. NETWORK, AUTH, NUMBER_EXHAUSTED).
   */
  failNext(error: InvoiceError): void {
    this.queuedFailure = error;
  }

  private checkFailure(): void {
    if (this.queuedFailure) {
      const error = this.queuedFailure;
      this.queuedFailure = undefined;
      throw error;
    }
  }

  private nextInvoiceNumber(): string {
    const n = this.seq++;
    return `${this.track}${String(n).padStart(8, "0")}`;
  }

  private requireInvoice(invoiceNumber: string): StoredInvoice {
    const stored = this.invoices.get(invoiceNumber);
    if (!stored) {
      throw new InvoiceError("Invoice not found", {
        provider: this.name,
        code: InvoiceErrorCode.NOT_FOUND,
      });
    }
    return stored;
  }

  async issue(input: IssueInvoiceInput): Promise<IssueInvoiceResult> {
    this.checkFailure();
    const parsed = parseInput(issueInvoiceInputSchema, input, this.name);
    // A provider without FOREIGN_CURRENCY must reject a non-TWD currency.
    if (parsed.currency && parsed.currency !== "TWD") {
      assertSupports(this, Capability.FOREIGN_CURRENCY);
    }
    const invoiceNumber = this.nextInvoiceNumber();
    const result: IssueInvoiceResult = {
      invoiceNumber,
      invoiceDate: parsed.date ?? new Date(),
      randomCode: String((this.seq * 7) % 10_000).padStart(4, "0"),
      orderId: parsed.orderId,
      totalAmount: parsed.amount.totalAmount,
      status: InvoiceStatus.ISSUED,
      raw: { mock: true, input: parsed },
    };
    this.invoices.set(invoiceNumber, { input: parsed, result, status: InvoiceStatus.ISSUED });
    this.byOrderId.set(parsed.orderId, invoiceNumber);
    return result;
  }

  async void(input: VoidInvoiceInput): Promise<VoidInvoiceResult> {
    this.checkFailure();
    const parsed = parseInput(voidInvoiceInputSchema, input, this.name);
    const stored = this.requireInvoice(parsed.invoiceNumber);
    if (stored.status === InvoiceStatus.VOIDED) {
      throw new InvoiceError("Invoice already voided", {
        provider: this.name,
        code: InvoiceErrorCode.CONFLICT,
      });
    }
    stored.status = InvoiceStatus.VOIDED;
    return {
      invoiceNumber: parsed.invoiceNumber,
      status: InvoiceStatus.VOIDED,
      raw: { mock: true },
    };
  }

  async allowance(input: AllowanceInput): Promise<AllowanceResult> {
    this.checkFailure();
    const parsed = parseInput(allowanceInputSchema, input, this.name);
    const stored = this.requireInvoice(parsed.invoiceNumber);
    if (stored.status === InvoiceStatus.VOIDED) {
      throw new InvoiceError("Cannot credit a voided invoice", {
        provider: this.name,
        code: InvoiceErrorCode.CONFLICT,
      });
    }
    stored.status = InvoiceStatus.ALLOWANCE;
    const allowanceNumber = `AL${String(++this.allowanceSeq).padStart(8, "0")}`;
    this.allowances.add(allowanceNumber);
    return {
      allowanceNumber,
      invoiceNumber: parsed.invoiceNumber,
      allowanceDate: parsed.date ?? new Date(),
      totalAmount: parsed.amount.totalAmount,
      raw: { mock: true },
    };
  }

  async voidAllowance(input: VoidAllowanceInput): Promise<VoidAllowanceResult> {
    this.checkFailure();
    const parsed = parseInput(voidAllowanceInputSchema, input, this.name);
    if (!this.allowances.has(parsed.allowanceNumber)) {
      throw new InvoiceError("Allowance not found", {
        provider: this.name,
        code: InvoiceErrorCode.NOT_FOUND,
      });
    }
    this.allowances.delete(parsed.allowanceNumber);
    return { allowanceNumber: parsed.allowanceNumber, raw: { mock: true } };
  }

  async query(input: QueryInvoiceInput): Promise<QueryInvoiceResult> {
    this.checkFailure();
    const parsed = parseInput(queryInvoiceInputSchema, input, this.name);
    const invoiceNumber =
      parsed.invoiceNumber ?? (parsed.orderId ? this.byOrderId.get(parsed.orderId) : undefined);
    const stored = invoiceNumber ? this.invoices.get(invoiceNumber) : undefined;
    if (!stored || !invoiceNumber) {
      throw new InvoiceError("Invoice not found", {
        provider: this.name,
        code: InvoiceErrorCode.NOT_FOUND,
      });
    }
    return {
      invoiceNumber,
      invoiceDate: stored.result.invoiceDate,
      randomCode: stored.result.randomCode,
      orderId: stored.input.orderId,
      status: stored.status,
      amount: stored.input.amount,
      buyer: stored.input.buyer,
      items: stored.input.items,
      raw: { mock: true },
    };
  }
}

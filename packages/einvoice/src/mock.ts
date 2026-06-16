import { InvoiceError, InvoiceErrorCode } from "./errors.js";
import type { InvoiceProvider } from "./provider.js";
import {
  allowanceInputSchema,
  issueInvoiceInputSchema,
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

export interface MockProviderOptions {
  /** Prefix for generated invoice numbers (the 字軌, 2 letters). */
  track?: string;
  /** Deterministic sequence start for generated numbers. */
  seq?: number;
}

/**
 * In-memory {@link InvoiceProvider} for tests and local development. It runs the
 * same validation as a real adapter but never hits the network, so application
 * code can be exercised end-to-end without credentials.
 */
export class MockProvider implements InvoiceProvider {
  readonly name = "mock";
  private readonly track: string;
  private seq: number;
  private readonly invoices = new Map<string, StoredInvoice>();
  private readonly byOrderId = new Map<string, string>();
  private allowanceSeq = 0;

  constructor(options: MockProviderOptions = {}) {
    this.track = options.track ?? "MK";
    this.seq = options.seq ?? 10_000_000;
  }

  private nextInvoiceNumber(): string {
    const n = this.seq++;
    return `${this.track}${String(n).padStart(8, "0")}`;
  }

  private parse<T>(schema: { parse: (v: unknown) => T }, input: unknown): T {
    try {
      return schema.parse(input);
    } catch (cause) {
      throw new InvoiceError("Validation failed", {
        provider: this.name,
        code: InvoiceErrorCode.VALIDATION,
        cause,
      });
    }
  }

  async issue(input: IssueInvoiceInput): Promise<IssueInvoiceResult> {
    const parsed = this.parse(issueInvoiceInputSchema, input);
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
    this.invoices.set(invoiceNumber, {
      input: parsed,
      result,
      status: InvoiceStatus.ISSUED,
    });
    this.byOrderId.set(parsed.orderId, invoiceNumber);
    return result;
  }

  async void(input: VoidInvoiceInput): Promise<VoidInvoiceResult> {
    const parsed = this.parse(voidInvoiceInputSchema, input);
    const stored = this.invoices.get(parsed.invoiceNumber);
    if (!stored) {
      throw new InvoiceError("Invoice not found", {
        provider: this.name,
        code: InvoiceErrorCode.NOT_FOUND,
      });
    }
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
    const parsed = this.parse(allowanceInputSchema, input);
    const stored = this.invoices.get(parsed.invoiceNumber);
    if (!stored) {
      throw new InvoiceError("Invoice not found", {
        provider: this.name,
        code: InvoiceErrorCode.NOT_FOUND,
      });
    }
    stored.status = InvoiceStatus.ALLOWANCE;
    return {
      allowanceNumber: `AL${String(++this.allowanceSeq).padStart(8, "0")}`,
      invoiceNumber: parsed.invoiceNumber,
      allowanceDate: parsed.date ?? new Date(),
      totalAmount: parsed.amount.totalAmount,
      raw: { mock: true },
    };
  }

  async voidAllowance(input: VoidAllowanceInput): Promise<VoidAllowanceResult> {
    const parsed = this.parse(voidAllowanceInputSchema, input);
    return { allowanceNumber: parsed.allowanceNumber, raw: { mock: true } };
  }

  async query(input: QueryInvoiceInput): Promise<QueryInvoiceResult> {
    const parsed = this.parse(queryInvoiceInputSchema, input);
    const invoiceNumber =
      parsed.invoiceNumber ??
      (parsed.orderId ? this.byOrderId.get(parsed.orderId) : undefined);
    const stored = invoiceNumber
      ? this.invoices.get(invoiceNumber)
      : undefined;
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

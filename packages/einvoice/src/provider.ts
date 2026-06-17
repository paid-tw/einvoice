import type {
  AllowanceInput,
  AllowanceResult,
  IssueInvoiceInput,
  IssueInvoiceResult,
  QueryInvoiceInput,
  QueryInvoiceResult,
  VoidAllowanceInput,
  VoidAllowanceResult,
  VoidInvoiceInput,
  VoidInvoiceResult,
} from "./types.js";
import type { Capability } from "./capabilities.js";

/**
 * The contract every provider adapter implements. Application code depends on
 * this interface, never on a concrete adapter, so providers are swappable.
 *
 * All methods reject with an {@link InvoiceError} on failure.
 */
export interface InvoiceProvider {
  /** A stable identifier, e.g. `"amego"`, `"ecpay"`. */
  readonly name: string;

  /** The set of optional features this adapter supports. */
  readonly capabilities: ReadonlySet<Capability>;

  /** 開立發票. */
  issue(input: IssueInvoiceInput): Promise<IssueInvoiceResult>;

  /** 作廢發票. */
  void(input: VoidInvoiceInput): Promise<VoidInvoiceResult>;

  /** 開立折讓. */
  allowance(input: AllowanceInput): Promise<AllowanceResult>;

  /** 作廢折讓. */
  voidAllowance(input: VoidAllowanceInput): Promise<VoidAllowanceResult>;

  /** 查詢發票. */
  query(input: QueryInvoiceInput): Promise<QueryInvoiceResult>;
}

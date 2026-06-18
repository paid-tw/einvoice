# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A pnpm monorepo publishing a unified **Taiwan e-invoice SDK** (`@paid-tw/einvoice`) plus per-provider adapter packages. Every Taiwan value-added center wraps the same 財政部 MIG 4.0 spec, so the core models the five operations once — **issue (開立) / void (作廢) / allowance (折讓) / void-allowance (折讓作廢) / query (查詢)** — and each provider is a thin adapter mapping the unified model ⇄ its wire format.

## Commands

```bash
pnpm install
pnpm build          # build all packages via tsdown (rolldown — ESM + CJS + d.ts)
pnpm test           # vitest run (offline; uses MSW mocks)
pnpm test:watch     # vitest watch
pnpm typecheck      # tsc --noEmit across packages
pnpm lint           # oxlint --type-aware (oxc linter)
pnpm format         # oxfmt --write   (oxc formatter, printWidth 100)
pnpm format:check   # oxfmt --check   (CI gate; fails if anything is unformatted)
```

**Before pushing, run what CI runs:** `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`. CI (`.github/workflows/ci.yml`) has two jobs: a **build job** (Node 22 — `build` → `typecheck` → `lint` → `format:check` → `check:exports`) and a **test matrix** (Node 18/20/22/24, offline tests only; tests resolve workspace packages to source via the vitest alias, so they need no build). `pnpm build` includes the **`.d.ts` declaration build** (tsdown — a distinct type check that can fail even when `pnpm test` is green, e.g. a public-API/arity issue that only surfaces in the declaration build). The build toolchain (tsdown/rolldown) needs **Node ≥22**, distinct from the library's runtime floor of `engines >=18` (consumers run the prebuilt dist). Don't infer a green CI from `pnpm test` alone — and don't mask the build's exit status (a silenced `pnpm build` that falls through to a later `|| echo OK` hides a real failure).

Run a single package's tests / a single file / a single test:
```bash
pnpm --filter @paid-tw/einvoice-amego exec vitest run
pnpm exec vitest run packages/einvoice-amego/src/__tests__/unified.test.ts
pnpm exec vitest run -t "issue"        # by test name
```

**Live tests** hit real provider sandboxes and are skipped unless gated env vars are set (`AMEGO_LIVE=1`, `ECPAY_LIVE=1`, `EZPAY_LIVE=1`, etc.). CI runs offline only. Example:
```bash
AMEGO_LIVE=1 pnpm --filter @paid-tw/einvoice-amego exec vitest run live
```

## Architecture

```
@paid-tw/einvoice (core)     provider-agnostic: types, InvoiceProvider, Zod schemas, MockProvider
        ▲ implements InvoiceProvider
        │
@paid-tw/einvoice-amego      maps unified model ⇄ Amego wire format (MD5 sign)
@paid-tw/einvoice-ecpay      ECPay B2C 2.0 (AES)
@paid-tw/einvoice-ezpay      ezPay 藍新 (AES)
@paid-tw/einvoice-ezpay-crossborder   ezPay 境外電商 (cross-border B2C)
@paid-tw/einvoice-ezreceipt  ezReceipt 易發票 (order-oriented REST, token auth)
```

Adapters depend on core via `workspace:*` and list it as a tsdown `external` — they never bundle it. Install only the adapter you use; adapters don't pull in each other's deps.

**Core helpers adapters reuse** (all exported from `@paid-tw/einvoice`): `parseInput` (schema → validated input, raising `InvoiceError`), `taxTypeToCode` (unified `TaxType` → MIG `1`/`2`/`3`), `parseTaipeiDate`/`taipeiDateTime` (Asia/Taipei date ⇄ wire string), `tracedFetch` (the debug-logging fetch wrapper), and the amount helpers `composeTaxExclusive`/`splitTaxInclusive`. Prefer these over re-implementing per adapter.

**Core is the contract.** Application code depends only on `InvoiceProvider` (`packages/einvoice/src/provider.ts`) and the unified types — never on a concrete adapter. Switching providers means swapping the constructor (`createAmegoProvider(...)` → `createEcpayProvider(...)`), nothing else.

### Key invariants when working on adapters

- **Money is integer TWD — except cross-border foreign currency.** For TWD (the default, and every domestic provider) the statutory amount fields (`salesAmount`/`taxAmount`/`totalAmount`) are integers in New Taiwan Dollars — a MIG invariant. **Exception:** the cross-border adapter (`@paid-tw/einvoice-ezpay-crossborder`) accepts *2-decimal foreign amounts* in the unified input when `currency` ≠ TWD (see `fmtAmount` in its `provider.ts`: `foreign ? value.toFixed(2) : Math.round(value)`); the government filing is still in TWD, derived server-side from `exchangeRate`. So `currency` (ISO 4217) + `exchangeRate` *annotate* the sale, and on cross-border they also imply the wire amounts are decimal foreign-currency values, not integer TWD.
- **Capabilities are declared, not discovered.** Each provider exposes a `capabilities: ReadonlySet<Capability>` (`packages/einvoice/src/capabilities.ts`). Callers feature-detect with `supports()` / `assertSupports()`. A provider lacking `FOREIGN_CURRENCY` must **reject** a non-TWD `currency` (throw `UNSUPPORTED`), not silently drop it.
- **Errors normalize to one type.** Adapters map provider/MOF error codes onto `InvoiceError` with a stable `InvoiceErrorCode` (`AUTH`/`VALIDATION`/`NOT_FOUND`/`CONFLICT`/`NUMBER_EXHAUSTED`/`NETWORK`/`PROVIDER`/`UNSUPPORTED`/`UNKNOWN`), preserving the provider's `rawCode`/`rawMessage`/`raw`. All five operations reject with `InvoiceError` on failure. Use the `isInvoiceError(e)` type guard, not `instanceof` — it checks a globally-registered `Symbol.for` brand, so it still narrows correctly when two copies of the package are loaded (dual ESM/CJS, version skew).
- **Validate before the network.** Each operation parses input through the shared Zod schemas (`issueInvoiceInputSchema` etc.) via core's `parseInput(schema, input, provider)`, which normalizes a Zod failure into an `InvoiceError(VALIDATION)` (never a raw `ZodError`), then maps to wire fields. **Two documented exceptions** keep their own validator because the shared schema doesn't fit: ezReceipt's `issue` (it accepts a member id via `buyer.email`, which the schema's `.email()` check would reject) and the cross-border adapter's `issue`/`allowance` (2-decimal foreign amounts, which the integer `amountSummarySchema` would reject) — both annotated at the call sites. Adapter-specific payload validation can be toggled off with `config.validatePayload === false`.
- **Opt-in request tracing.** Set `debug` on any provider config to receive metadata-only trace events (`provider`/`method`/`url`/`status`/`durationMs`/`error`) for each HTTP call; adapters route fetch through core's `tracedFetch` (zero-overhead when `debug` is unset). Request/response **bodies are not logged** — encrypted on the wire for ezPay/ECPay, potentially PII for the others; wrap the `fetch` override to capture raw bodies.
- **`providerOptions` is the escape hatch** on every input type for provider-specific fields not in the unified model. Adapters also expose provider-specific namespaces beyond the interface (e.g. Amego's `provider.invoice`, `.allowances`, `.lottery`, `.track`, `.raw()`) — these are intentionally not cross-provider.
- **Category is derived** from `buyer.ubn`: present → `B2B` (三聯式), absent → `B2C` (二聯式), unless `category` is set explicitly.

### Tests

Offline adapter tests mock the provider HTTP boundary with **MSW** (`msw/node`). Each adapter has a `src/__tests__/server.ts` exposing a shared `setupServer()`, a `testProvider()` pointed at a fake base URL, and body-parsing helpers; `fixtures.ts` holds canned responses. The `live.test.ts` suites are `describe.skipIf(!live)` and may set `retry` for transient sandbox throttling. Vitest aliases `@paid-tw/einvoice` to the core *source* (`packages/einvoice/src/index.ts`) so tests run without building core first.

## Releasing

Uses [changesets](https://github.com/changesets/changesets). Flow:

1. `pnpm changeset` — describe the change + pick the bump (patch/minor/major) per package.
2. `pnpm exec changeset version` — apply the bumps and update CHANGELOGs. **Use `pnpm exec changeset version` (or `pnpm run version`), not bare `pnpm version`** — the latter can invoke pnpm's built-in `version` command instead of the `"version": "changeset version"` script.
3. Commit the version bump, then push a **`vX.Y.Z` git tag**.

The Publish workflow (`.github/workflows/publish.yml`) triggers on `v*` tags and publishes via **npm OIDC trusted publishing (no token, with provenance)**. The tag is a **repo-level trigger that is monotonic across the whole repo — it is not tied to any single package's version**; pick the next unused `v*`. The workflow iterates every non-private package and publishes only those whose `name@version` isn't already on npm (others are skipped), so an already-published version is safe to re-tag past.

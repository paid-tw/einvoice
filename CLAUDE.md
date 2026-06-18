# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A pnpm monorepo publishing a unified **Taiwan e-invoice SDK** (`@paid-tw/einvoice`) plus per-provider adapter packages. Every Taiwan value-added center wraps the same 財政部 MIG 4.0 spec, so the core models the five operations once — **issue (開立) / void (作廢) / allowance (折讓) / void-allowance (折讓作廢) / query (查詢)** — and each provider is a thin adapter mapping the unified model ⇄ its wire format.

## Commands

```bash
pnpm install
pnpm build          # build all packages via tsup (ESM + CJS + d.ts)
pnpm test           # vitest run (offline; uses MSW mocks)
pnpm test:watch     # vitest watch
pnpm typecheck      # tsc --noEmit across packages
pnpm lint           # tsc -b --noEmit (|| true — non-blocking)
```

**Before pushing, run what CI runs:** `pnpm build && pnpm typecheck && pnpm test`. CI (`.github/workflows/ci.yml`) runs `pnpm -r build` → `pnpm typecheck` → `pnpm test` on every push. `pnpm build` includes the **`.d.ts` declaration build** (tsup → rollup-plugin-dts), which is a distinct type check and can fail even when `pnpm test` is fully green (e.g. a public-API/arity issue surfaces only in the declaration build). Don't infer a green CI from `pnpm test` alone — and don't mask the build's exit status (a silenced `pnpm build` that falls through to a later `|| echo OK` hides a real failure).

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

Adapters depend on core via `workspace:*` and list it as a tsup `external` — they never bundle it. Install only the adapter you use; adapters don't pull in each other's deps.

**Core is the contract.** Application code depends only on `InvoiceProvider` (`packages/einvoice/src/provider.ts`) and the unified types — never on a concrete adapter. Switching providers means swapping the constructor (`createAmegoProvider(...)` → `createEcpayProvider(...)`), nothing else.

### Key invariants when working on adapters

- **Money is integer TWD — except cross-border foreign currency.** For TWD (the default, and every domestic provider) the statutory amount fields (`salesAmount`/`taxAmount`/`totalAmount`) are integers in New Taiwan Dollars — a MIG invariant. **Exception:** the cross-border adapter (`@paid-tw/einvoice-ezpay-crossborder`) accepts *2-decimal foreign amounts* in the unified input when `currency` ≠ TWD (see `fmtAmount` in its `provider.ts`: `foreign ? value.toFixed(2) : Math.round(value)`); the government filing is still in TWD, derived server-side from `exchangeRate`. So `currency` (ISO 4217) + `exchangeRate` *annotate* the sale, and on cross-border they also imply the wire amounts are decimal foreign-currency values, not integer TWD.
- **Capabilities are declared, not discovered.** Each provider exposes a `capabilities: ReadonlySet<Capability>` (`packages/einvoice/src/capabilities.ts`). Callers feature-detect with `supports()` / `assertSupports()`. A provider lacking `FOREIGN_CURRENCY` must **reject** a non-TWD `currency` (throw `UNSUPPORTED`), not silently drop it.
- **Errors normalize to one type.** Adapters map provider/MOF error codes onto `InvoiceError` with a stable `InvoiceErrorCode` (`AUTH`/`VALIDATION`/`NOT_FOUND`/`CONFLICT`/`NUMBER_EXHAUSTED`/`NETWORK`/`PROVIDER`/`UNSUPPORTED`/`UNKNOWN`), preserving the provider's `rawCode`/`rawMessage`/`raw`. All five operations reject with `InvoiceError` on failure.
- **Validate before the network.** Each operation parses input through the shared Zod schemas (`issueInvoiceInputSchema` etc. from core) at the top of the method, then maps to wire fields. Adapter-specific payload validation can be toggled off with `config.validatePayload === false`.
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

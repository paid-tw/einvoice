# tools

Standalone, **non-published** utilities that live in the repo but are *not* part of
the `@paid-tw/einvoice` SDK. They sit outside `packages/`, so the pnpm workspace, the
build, `typecheck`, `check:exports`, and the published npm artifacts never include
them. Each is self-contained with its own `package.json` and README.

Unlike the SDK (Node + pnpm + vitest), these are **bun** scripts that drive provider
back-office portals over HTTP for bulk operations the public APIs don't expose.

| tool | what |
|------|------|
| [`ezpay-backend/`](./ezpay-backend) | Pure-HTTP client + reference for the **ezPay 加值中心** backend — chiefly bulk monthly invoice-detail CSV export. Includes offline MSW tests. |
| [`nat/`](./nat) | Headless client + reference for the **財政部 電子發票整合服務平台** (`einvoice.nat.gov.tw`) 營業人 side — pull 進項/銷項 invoices and 折讓單 from the MoF source, with automated OCR-captcha login. |

## Conventions

- **No secrets or real data in git.** Credentials come from 1Password (item name via
  an env var) or env vars at runtime; nothing account-specific is committed. Each tool
  gitignores its `secrets*.json`, `out/`, and any downloaded CSV/XLSX — those hold PII
  and must never be committed. Docs and test fixtures use only fabricated placeholder
  values (e.g. 統編 `12345678`).
- **Reverse-engineering references** (`*-BACKEND.md`, `NAT-PLATFORM.md`) document the
  observed HTTP shapes and portal behaviour, not any customer's data.

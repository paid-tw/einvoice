---
"@paid-tw/einvoice-ezreceipt": patch
---

Fix the `.d.ts` build: `resolveInvID` now takes `providerOptions` as an optional
parameter, so the internal one-argument call in `printInvoice` type-checks. The
0.1.0 runtime was correct, but its generated type declarations were stale (the
declaration build had been failing silently). No API change.

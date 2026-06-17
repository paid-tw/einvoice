---
"@paid-tw/einvoice-amego": minor
---

Type the `track.get` (字軌取號) allocation method — `track.get({ year, period, book, trackApiCode? })`
maps to PascalCase `Year`/`Period`/`Book` and returns `data: { code, start, end }`
(allocating 50 numbers per book). Using it, the f0401_custom success path was
captured live and now backs the fixture. Validation also learned that
f0401_custom **requires `PrintMark`** (Y/N) and that `PrintMark=N` needs a
carrier or donation — both verified live.

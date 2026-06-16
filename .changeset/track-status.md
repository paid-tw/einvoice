---
"@paid-tw/einvoice-amego": minor
---

Type the `track.status` (字軌狀態) method: `track.status({ year, period?, trackApiCode? })`
maps to the PascalCase `Year`/`Period`/`TrackApiCode` fields (a lowercase `year`
silently returns an empty list — verified live). Export a `TRACK_STATUS` code map
(1 使用 / 2 停用 / 3 過期 / 9 用畢) and cover the `data[]` response shape.

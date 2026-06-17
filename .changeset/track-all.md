---
"@paid-tw/einvoice-amego": minor
---

Type the `track.all` (所有字軌資料) method: `track.all({ year, period? })` maps to
PascalCase `Year`/`Period` (lowercase yields no data — verified live) and returns
the nested 3-layer track tree (1 財政部 / 2 光貿 / 3 字軌列表; leaves carry
category, TrackApiCode, source, status). Export `TRACK_LAYER`, `TRACK_CATEGORY`,
and `TRACK_SOURCE` code maps. Completes the typed `track.*` namespace.

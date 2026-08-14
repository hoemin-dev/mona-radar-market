# Phase 3-B.1 — paging, empty, and historical verification

## Status

Live execution is **pending**. The Codex process has no
`KONEPS_SERVICE_KEY` in process, user, or machine environment scope. No key was
searched for or copied from files, and no live request was attempted without
it.

- Live API calls this phase: **0**
- Cumulative Phase 3-B + 3-B.1 calls: **1**
- Operation scope: `getBidPblancListInfoThngPPSSrch` only
- Verified key mode: `preserve`

The developer command and offline verification helpers are ready. Each
`--execute` invocation has zero retries and therefore makes at most one HTTP
attempt. Tests and builds never invoke it.

## Pagination

Source page already available from Phase 3-B:

| Requested page | Returned page | Rows | `totalCount` | Evidence |
|---:|---:|---:|---:|---|
| 1 | 1 | 5 | 14 | CONFIRMED, `202608131638`–`202608131648` |
| 2 | — | — | — | NOT VERIFIED |
| 3 | — | — | — | NOT VERIFIED |

The minimum continuation is page 2, followed by page 3 only if the returned
count still requires it. Page 4 must not be called merely to prove that the
post-final page is empty.

```powershell
npm.cmd run koneps:verify-live -- --execute --historical --from 202608131638 --to 202608131648 --page 2 --rows 5 --fixture-name bid-notice-page-2
npm.cmd run koneps:verify-live -- --execute --historical --from 202608131638 --to 202608131648 --page 3 --rows 5 --fixture-name bid-notice-page-3
```

Although this window is recent relative to the evidence date, it is now older
than seven days from future runs, so the explicit `--historical` safety flag is
required. Compare identities as the unmodified string composite
`bidNtceNo|bidNtceOrd`. The pagination helper reports cross-page duplicates,
`totalCount` drift, per-page counts, and whether a short final page was seen.

## Empty

**EMPTY LIVE SHAPE = NOT VERIFIED.** No speculative request was made without a
configured key. A historical probe returning `totalCount=0` can satisfy this
check without an extra call. Confirm whether `items` is missing, null, `[]`,
`{}`, an empty string, or another value, and verify that paging fields remain.
Only a confirmed response may become
`fixtures/live-sanitized/bid-notice-empty.json`.

## Historical availability

No historical probe has been executed in this phase. The bounded plan below
uses weekday daytime windows and remains under the ten-call phase budget when
combined with at most two pagination calls.

| Year | Candidate window (KST) | `totalCount` | Items | Evidence |
|---:|---|---:|---:|---|
| 2020 | `202008131000`–`202008131100` | — | — | NOT VERIFIED |
| 2010 | `201008131000`–`201008131100` | — | — | NOT VERIFIED |
| 2005 | `200508121000`–`200508121100` | — | — | NOT VERIFIED |
| 2002 | `200208131000`–`200208131100` | — | — | NOT VERIFIED |
| 2000 | `200008141000`–`200008141100` | — | — | NOT VERIFIED |
| 1995 | `199508141000`–`199508141100` | — | — | NOT VERIFIED |

One zero-result window does not prove that a year is unavailable. Expand an
important candidate only from 10 minutes to one hour or a few hours and only
when the remaining call budget justifies it. Do not search for the exact first
record or start a backfill.

For each non-empty historical response, record only structural evidence:
`totalCount`, item count, field count, identifier format classification,
oldest observed `bidNtceDt`, and high-level population of key fields. Do not
place contacts or organization values in this document.

## Historical schema

Current reference: five 2026 rows, 101 fields each, all item values represented
as JSON strings, with 182 empty strings among 505 field values.

Historical field counts, identifier formats, empty-field tendencies, and
schema drift remain **NOT VERIFIED** until the probes run. Identifiers must
remain source strings regardless of legacy formatting.

## Tool safety and evidence

- `--execute` is mandatory for transport.
- Dates older than seven days require `--historical`.
- Window maximum: 360 minutes.
- Rows maximum: 10.
- Page maximum: 10.
- Fixture names accept lowercase letters, digits, and hyphens only.
- Every live response writes exact bytes and a verification report under
  ignored `runtime/koneps-live/<timestamp>/`.
- A sanitized fixture is written only under an explicitly selected filename.
- The verification report records paging, item count, and identity composites
  without a service key.

## Unresolved

- page 2/page 3 behavior, duplicates, last-page size, and total-count drift;
- actual empty `items` representation;
- oldest confirmed availability year for this operation;
- legacy `bidNtceNo` format and historical field population;
- historical schema drift;
- date boundary inclusivity and maximum supported API window/page size.

No DB, RAW persistence layer, checkpoint, domain normalization, UI integration,
scheduler, polling, automatic collection, or Search/Dash/Analysis feature was
added.

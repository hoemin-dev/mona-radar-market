# Phase 3-F — manual initial and incremental collector

## Execution principle

Collection starts only from the explicit `collector:manual` CLI command. There is no scheduler, timer, startup collection, app-open hook, background polling, or automatic retry. Tests use mocks and fixtures; Phase 3-F implementation made zero live KONEPS calls.

Commands are dry-run unless `--execute` is present:

```powershell
npm run collector:manual -- initial --start 2026-08-01 --end 2026-08-13
npm run collector:manual -- incremental
```

Ranges longer than 31 days require `--allow-long-range`. This is an explicit safety confirmation, not an API protocol limit. `KONEPS_SERVICE_KEY` is read only after `--execute`; verified key mode remains `preserve`.

## Initial and incremental planning

Initial collection requires explicit inclusive KST calendar dates. The practical project lower bound is `2001-01-01T00:00:00`; it is not a claim that a source record exists at that exact instant. Earlier starts, reversed ranges, and an end later than captured KST now are rejected.

Incremental collection requires the bid-notice discovery checkpoint. Without it planning throws `INITIAL_RANGE_REQUIRED` before a client is constructed or any API request occurs. Its effective range is:

`max(2001-01-01T00:00:00, successful_through - 24 hours) → captured KST now`

The 24-hour overlap is a conservative delayed-registration/change window from the prior collector design. It intentionally produces duplicates, which RAW hashing, observations, semantic hashes, and revisions handle safely. Its suitability should be measured after real manual collection runs.

## Chunking and pagination

Discovery uses lazy one-KST-day chunks. One day is conservative for the minute-based verified operation, bounds restart cost, and avoids relying on an unverified maximum API span. A 2001-to-current dry plan computes counts arithmetically and yields chunks lazily; it does not allocate all notices or work in memory.

Each discovery page requests 5 rows, the verified page size. Page 1 establishes `totalCount`; pages run sequentially through the calculated final page. Guards reject total-count drift, repeated response hashes, unexpected empty intermediate pages, and more than 10,000 pages. Duplicate items are normal.

An empty `items=[]`, `totalCount=0` chunk is successful and advances the checkpoint.

## Discovery, checkpoint, and enrichment

The implemented graph is:

`date range → bid-notice pages → RAW → bid_notice → durable item/basis work → RAW → bid_item/bid_basis_amount`

Checkpoint identity is `BidPublicInfoService + getBidPblancListInfoThngPPSSrch + notice_posted_datetime`.

`successful_through` means every discovery page in that chunk was parsed and persisted and every RAW notice was normalized. The checkpoint advances after each successful chunk, never on request start or HTTP success alone. A first-chunk failure creates no checkpoint; a later failure retains the previous successful chunk boundary.

Item and basis enrichment are identity fan-out operations, not timestamp checkpoints. Each discovered `(bidNtceNo, bidNtceOrd)` creates two work items. Idempotency is scoped to `(created_run_id, operation, notice number, notice order)`, so duplicates within a run collapse while an overlap run may deliberately query the identity again.

Discovery checkpoint and enrichment success are separated. Failed enrichment is retained with safe category/message, makes the run partial, and does not roll back discovery or permanently lose work. Pending/failed work is retried only when the user starts a later manual collection. Enrichment is sequential (bounded concurrency of one) and uses existing client retry/backoff.

## Migration v4 and status

Migration v4 adds `collector_checkpoint`, `collector_work_item`, effective range,
overlap/retry accounting, and inserted/unchanged/updated/deferred/normalization-
error counters on collector and operation runs. Existing migrations v1–v3 are
unchanged. Existing v3 and fresh v1→v4 paths are tested and reopening is
idempotent.

Run status is `succeeded`, `partial`, `failed`, or `cancelled`. Operation runs isolate discovery, purchase-item, and basis-amount outcomes. `partial` means committed useful work exists but at least one discovery chunk or enrichment work item failed. Error storage contains a category and safe/redacted summary, never raw transport text or a key.

## Transactions, cancellation, and restart

RAW response/item/observation persistence retains its per-page transaction. Each normalized row retains its repository transaction. Checkpoint UPSERT occurs only after the whole discovery chunk succeeds. A crash between page commits and checkpoint advance causes safe replay: response/item hashing deduplicates content, a new observation is allowed, semantic equality is unchanged, and the checkpoint can recover.

The engine accepts a cancellation predicate and checks it at chunk and work-item boundaries. Completed page/row/chunk commits remain; no GUI stop control is implemented yet.

After collection the database can be closed and reopened and `bid_notice`, `bid_item`, and `bid_basis_amount` queried without a KONEPS client. Search/Dash/Analysis remain database consumers.

The service key is never placed in plans, SQLite, work errors, docs, fixtures, or tests. Persisted request URLs use `[REDACTED]`. Private runtime evidence remains ignored.

## Verification and deferred scope

The test suite covers v4 migration, KST validation, lower bound, future rejection, long-range lazy planning, missing-checkpoint refusal, overlap clamp, empty chunks, multi-page and short-final-page handling, checkpoint advancement/failure boundaries, work idempotency, enrichment persistence and retry, semantic unchanged/update/revision behavior, cancellation, and offline normalized queries.

Not implemented: GUI, scheduler, automatic collection/retry, opening/participants/awards/contracts, organization/company masters, actual 2001-current backfill, or live collector smoke test.

## Phase 3-F.1 smoke safety options

Manual verification may use `--start-datetime` / `--end-datetime` for a precise
KST minute range together with paired `--smoke-max-notices` and
`--smoke-max-api-calls` limits. Smoke execution disables client retries so the
request ceiling is an actual transport-attempt ceiling. If page 1 reports more
notices than allowed, it stops before normalization/enrichment and does not
advance the checkpoint. These options do not alter normal period/incremental
behavior.

`collector:inspect` is a read-only, value-minimized report of the latest run,
operation counters, checkpoint, work statuses, table counts, parent/lineage
integrity, and secret-redaction violations. It does not print RAW bodies,
notice values, contacts, or a service key.

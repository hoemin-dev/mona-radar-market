# Phase 3-G — Historical Backfill Operations Plan

## 1. Current verified collector

The baseline is commit `037d824` (`implement KONEPS collection, normalization, and incremental pipeline`). The working tree was clean when this plan was prepared.

The live Phase 3-F database has a successful incremental checkpoint at `2026-08-13T16:39:00`. Its latest run completed the `16:38`–`16:39` KST range with 7 API calls, 4 inserts, 3 unchanged projections, no updates, retries, deferrals, normalization errors, or integrity errors. Current counts are 13 calls, 7 response blobs, 7 RAW items, 13 observations, 3 notices, 3 items, and 1 basis amount. All three revision tables are empty. This is evidence for initial collection, overlap replay, RAW/content deduplication, observation retention, normalization, enrichment, and forward checkpoint advancement; it is not evidence that a 25-year backfill is operationally safe.

The implementation currently provides:

- KST minute ranges, a `2001-01-01T00:00:00` lower bound, lazy one-day chunks, pagination, and a 10,000-page guard;
- RAW-first persistence with response and item content hashes, per-call observations, normalized current rows, and semantic revisions;
- a discovery checkpoint advanced only after all pages and notice normalization for a chunk complete;
- durable item/basis work items and retry of pending or failed work in a later run;
- client timeout, retry classification, exponential backoff with jitter, redacted request metadata, WAL, full synchronous writes, foreign keys, and a five-second busy timeout;
- injectable cancellation at work-item and chunk boundaries, smoke call/notice limits, progress callbacks, and read-only inspection.

It does **not** currently provide a historical job/cursor, resume/status/stop CLI, OS signal handling, pacing between successful requests, a cross-process collector lock, bounded per-work-item retry policy, a permanent-failure state, backfill completion semantics, backup automation, or a verified production page size. The existing `initial` command is therefore a functional range collector, not a full-backfill operator.

## 2. Historical scope and cutoff

- Earliest supported boundary: `2001-01-01T00:00:00` KST. Earlier years are out of scope and must not be probed automatically.
- Direction: forward, from the oldest boundary toward a fixed cutoff. This matches the collector's successful-through semantics and makes the most valuable completed prefix unambiguous after interruption.
- Cutoff: capture an immutable minute when the backfill job is created. For the first job, use the already-covered incremental boundary (`2026-08-13T16:39:00`) or an explicitly chosen earlier pilot cutoff. Never use a moving “now” value inside a running job.
- Coverage: `[2001-01-01T00:00:00, cutoff]`, inclusive at minute precision. The job definition must record this once.

The historical cursor and ongoing incremental checkpoint are separate operational state. Backfill must never overwrite, rewind, or reuse the `collector_checkpoint` row for ongoing incremental collection. The two streams converge through the same idempotent RAW and normalized data model, not through a shared cursor.

For v1, backfill and incremental execution are mutually exclusive. A database-level collector lease must reject a second writer before creating a run. This avoids ambiguous progress, SQLite contention, competing work claims, and confusing user-visible state. Incremental collection may resume after the backfill process releases or expires its lease.

## 3. Recommended architecture

```text
2001-01-01
    |
Historical job + separate forward cursor
    |
One-day time chunk (adapt after pilots)
    |
Discovery pagination
    +----> API call / response / RAW / observation
    |
bid_notice normalization
    |
chunk discovery boundary committed
    |
durable work queue
    +-------------------+
    |                   |
Item enrichment     Basis enrichment
    |                   |
RAW + normalize     RAW + normalize
    +-------------------+
              |
       enrichment status

Historical cursor ------------------> fixed backfill cutoff

Ongoing incremental checkpoint = separate operational state
```

Use a discovery-first architecture with durable enrichment work. Discovery establishes the notice universe and advances only the historical cursor. Item/basis failures remain retryable work and do not erase discovery progress. Job completion must distinguish `discovery_complete` from `completed`.

The current collector already approximates discovery-first behavior by enqueueing work during discovery and processing durable work separately, but its work and run lifecycle must be made explicitly job-aware before full backfill. Do not create an unrelated second queue.

## 4. Cursor and checkpoint strategy

Add dedicated operational state rather than overloading `collector_checkpoint`:

- `backfill_job`: job ID, immutable start/cutoff, `successful_through`, status, configuration snapshot, current run ID, timestamps, stop request, and redacted failure summary.
- `backfill_chunk`: job ID, start/end, status, attempt count, last run ID, page/call/item counters, timestamps, and failure category/message.
- Link new backfill work to a job (directly or through its discovery run) so status and completion queries do not infer ownership from dates.
- Add a collector lease row containing owner/job, acquired/heartbeat/expiry timestamps. Acquisition and release must be transactional.

Cursor rules:

1. Create the job and planned first chunk before transport.
2. Persist every successful page and normalize every discovered notice using existing page transactions.
3. Advance `backfill_job.successful_through` only after all discovery pages for that chunk are complete and required notice normalization succeeds.
4. On page or normalization failure, leave the cursor at the prior chunk. Retained pages may be safely replayed because RAW and normalization are idempotent while observations remain append-only.
5. Resume from the first incomplete chunk, not from `2001-01-01` and not from the incremental checkpoint.
6. A crash-stale `running` chunk becomes resumable only after its lease expires; record recovery rather than silently rewriting the old attempt.

Page-level resume is not required for v1. Chunk replay is simpler and safe with existing dedup semantics. Add page resume only if high-density pilots show that replay cost is material.

## 5. Discovery and enrichment strategy

Recommended sequence:

1. Complete discovery for one recovery chunk.
2. Commit its historical cursor.
3. Drain or cap enrichment work according to a configurable backlog watermark.
4. Continue discovery when the pending backlog is below that watermark.

This is discovery-first with bounded interleaving, not fully inline enrichment. It retains restartability without allowing an unbounded queue. A default watermark must be chosen from pilots; it is currently **NOT VERIFIED**.

Zero-row item or basis responses are successful terminal work results. Retry only failures. Preserve failed work, category, redacted message, attempt count, and next-eligible time. Existing current rows and revisions continue to be determined by semantic hashes: identical projections are unchanged; true source changes create revisions.

## 6. Chunk strategy

Keep one KST day as the initial recovery chunk because it is already implemented lazily and bounds cursor loss. A chunk is a recovery unit, not an API performance unit; pagination handles density within it.

Pilot evaluation must compare one hour, six hours, one day, and one week for calls, pages, notices, elapsed time, response sizes, and replay cost. Start with one day. Split future chunks when page count, elapsed time, or response bytes cross configured pilot-derived thresholds. Merge only after sparse-year evidence shows that doing so does not make recovery unwieldy.

The API minute boundaries are inclusive in current collector semantics. Adjacent chunks must therefore be non-overlapping (`next.start = previous.end + 1 minute`). Backfill does not need the 24-hour incremental overlap because replay safety comes from the durable historical cursor and explicit chunk recovery.

## 7. Page size, API scale, and pacing

The current collector uses `numOfRows=5`. Live pagination is verified at five rows, but the official maximum and a safe production page size are **NOT VERIFIED**. Do not increase it based on assumption. Pilot a larger size only in a separately approved call phase after confirming the documented limit and response stability.

For a job with `N` distinct notices, discovery page size `P`, `C` chunks, and per-notice child page counts `I_n` and `B_n`:

```text
discovery calls = sum over chunks ceil(chunk_notice_count / P),
                  with at least one discovery call per chunk
item calls      = sum(I_n), where zero-result identity queries still cost one call
basis calls     = sum(B_n), where zero-result identity queries still cost one call
attempts        = successful/logical calls + bounded retries
```

With the current APIs, a practical lower-bound model is `discovery calls + 2N`; multi-page child responses and retries increase it. The exact 2001–cutoff notice population is unknown, so no total call count is asserted. The period contains 9,356 inclusive calendar days (about 25.61 years), which gives 9,356 discovery calls at one call per empty/single-page day before pagination and enrichment. This is a formula input, not a forecast.

Initial operational policy:

- concurrency: 1 across discovery and enrichment;
- successful-request pacing: configurable, initially 500 ms minimum between transport attempts (2 attempts/second ceiling), pending pilot evidence and any authoritative quota;
- timeout: retain 20 seconds initially;
- retry: at most 2 retries for network, timeout, HTTP 429, and HTTP 5xx only;
- backoff: start at 1 second, exponential with jitter, cap at 30 seconds;
- API/parse/structure/schema/normalization/persistence errors: do not blindly retry transport;
- add per-run and per-job call ceilings plus a daily/operator ceiling before pilots.

No KONEPS quota is claimed here. The pacing values are conservative client policy and must remain configurable.

## 8. Pause, stop, and crash recovery

Support `collector:backfill --start`, `--resume`, `--status`, and `--stop` before any full run.

- `--stop` sets a durable stop-request flag.
- SIGINT/SIGTERM set the same intent and stop accepting new work.
- Finish the current HTTP response and page persistence transaction; then stop at the nearest page/work boundary.
- Never leave a page transaction partially committed.
- Mark the run/chunk/job `paused` (operator request) or `failed` (non-retryable error) and release the lease.
- On resume, reconcile stale `running` work to retryable state, preserve attempts and errors, then continue the first incomplete chunk.

The existing injectable cancellation callback proves safe-boundary cancellation in tests, but the CLI does not connect it to signals or durable state. Therefore pause/resume and graceful stop remain unverified.

## 9. Progress and completion model

Expose a read-only status query with:

- immutable start/cutoff and total/complete minutes or chunks;
- current chunk and page;
- discovery calls, pages, notices, bytes, and elapsed time;
- pending/running/succeeded/failed enrichment by operation;
- total attempts/retries and latest redacted error;
- cursor and percentage of the time range;
- rolling throughput and explicitly labeled estimated remaining time.

Recommended states: `planned`, `running`, `paused`, `discovery_complete`, `enriching`, `completed`, `completed_with_errors`, `failed`, `cancelled`. Do not overload existing `collector_run.status`; a job spans multiple runs.

Completion requires the historical cursor at the fixed cutoff, every discovery page accounted for, no pending/running required enrichment, integrity checks passing, and normalization errors reviewed. Failed enrichment produces `discovery_complete` or `completed_with_errors`, never an unqualified `completed`.

## 10. Failure classification

Reuse current KONEPS categories where available and normalize orchestration failures into: `CONFIGURATION`, `NETWORK`, `TIMEOUT`, `HTTP`, `API`, `PARSE`, `SCHEMA`, `NORMALIZATION`, `PERSISTENCE`, `CHECKPOINT`, `WORK_ITEM`, and `CANCELLED`. Store only redacted summaries.

After bounded attempts, retain a failed work item permanently with its identity, operation, attempt count, category, last error, and next/manual retry eligibility. One permanently failed enrichment must not restart discovery or discard other completed work.

## 11. Storage estimate methodology

The current smoke database is 348,160 bytes with no outstanding WAL, but schema/index base cost dominates this seven-RAW-item sample. It must not be linearly extrapolated to 25 years.

For each pilot, measure a consistent SQLite snapshot before and after WAL checkpointing and record:

- response bytes and unique blob bytes per call;
- canonical RAW bytes per unique item;
- observation and call rows per attempt;
- normalized/revision counts and payload lengths;
- database page count, page size, freelist, index contribution, WAL high-water mark, and final snapshot delta.

Calculate p50/p95 bytes per discovery call and per notice for old, middle, and recent pilots. Estimate:

```text
storage = fixed schema/index base
        + unique response blobs
        + unique canonical RAW items
        + observations and call metadata
        + normalized current rows and revisions
        + index/WAL/free-space allowance
```

Report lower/central/upper estimates using pilot p50/p95 and measured notice-density bands. Keep at least 2× the upper estimate free for WAL, backup, migration, and vacuum/rebuild operations.

## 12. SQLite maintenance and backup

Current settings are WAL, `synchronous=FULL`, foreign keys on, and a 5-second busy timeout. Retain them for pilots. Keep transactions page-sized/current-table-sized; do not wrap a day or job in one transaction.

- Use the SQLite backup API or `VACUUM INTO` from a controlled connection after pausing the collector; never copy only the main file while an active WAL may contain committed pages.
- Pilot policy: snapshot before each pilot and after successful completion.
- Proposed full-run policy: daily snapshot plus milestone snapshots at year boundaries, with retention defined before execution.
- Run `PRAGMA integrity_check` and foreign-key/domain integrity inspection after pilots and before accepting a backup.
- Run `ANALYZE` after materially large pilots/full ingestion. Do not schedule routine `VACUUM` until measured fragmentation justifies its disk/time cost.

## 13. Schema drift diagnostics

RAW JSON remains authoritative. Missing, null, empty, unknown, and obsolete fields must be retained without rejecting the whole record. Normalizers project only known fields and attach warnings.

Add per-operation/year diagnostics for observed field-set hash, missing known fields, unknown fields, scalar type changes, date/number parse warnings, normalization failures, and representative RAW lineage. Unknown fields alone are informational; required identity loss or invalid envelope structure is blocking.

## 14. Pilot plan

No pilot API is executed in Phase 3-G.

1. **Old-data pilot:** one bounded 2001 range drawn from existing evidence (for example a single known day/hour). Validate sparse legacy fields, identifiers, RAW retention, cursor resume, and zero-result enrichment.
2. **Middle-year pilot:** one bounded 2010 range from existing evidence. Validate field/type drift and storage/call density between legacy and current formats.
3. **Recent high-density pilot:** a bounded 2026 range with known pagination. Validate page volume, backlog watermark, pacing, stop/resume, and storage high-water behavior.

Each pilot requires a dry-run, immutable job cutoff, call ceiling, time ceiling, DB snapshot, status capture, intentional stop/resume test, integrity inspection, and an operator-approved live command. Do not chain pilots automatically.

## 15. Full backfill readiness checklist

- [x] Historical lower bound is explicit (`2001-01-01`)
- [x] RAW, observation, normalized current state, and revision semantics are live verified
- [x] Incremental checkpoint and 24-hour overlap are live verified
- [x] Current integrity and secret-safety inspection pass
- [ ] Durable historical job/cursor is implemented separately from incremental checkpoint
- [ ] Collector lease prevents backfill/incremental concurrency
- [ ] Resume after process termination is verified
- [ ] Durable stop plus SIGINT/SIGTERM graceful stop is verified
- [ ] Retry policy is bounded per work item and permanent failures are preserved
- [ ] Successful-request pacing and operator call/time ceilings are implemented
- [ ] Progress/status command exposes job, chunk, page, queue, calls, and failures
- [ ] Discovery backlog watermark is defined from pilots
- [ ] Production page size is documented and verified
- [ ] 2001 pilot is complete
- [ ] Middle-year pilot is complete
- [ ] Recent high-density pilot is complete
- [ ] Schema drift diagnostics are verified
- [ ] Consistent backup/restore procedure is tested
- [ ] Completion-state and integrity gates are verified

## 16. Must implement before backfill

Priority order:

1. Separate backfill job/chunk cursor schema and status query.
2. Transactional collector lease and immutable cutoff/config snapshot.
3. Resume reconciliation, durable stop flag, and CLI signal handling.
4. Configurable pacing, retry scheduling/attempt ceilings, and permanent failed-work preservation.
5. Job-aware progress and completion/integrity gates.
6. Consistent backup/restore command and pilot call/time/notice ceilings.
7. Pilot-only schema drift and storage metrics.

GUI, scheduling, concurrency greater than one, advanced ETA, charts, search, and cross-service framework extraction are later work.

## 17. Remaining unknowns

- total notice count and density distribution from 2001 through the cutoff;
- authoritative API quota and maximum/safe `numOfRows`;
- item/basis historical availability and child pagination distribution;
- rate of schema drift, semantic updates, and normalization warnings;
- measured bytes per call/notice and index/WAL amplification;
- optimal chunk size and enrichment backlog watermark;
- end-to-end elapsed time under conservative pacing.

These remain `NOT VERIFIED` until separately approved pilots. They must not be replaced with invented totals.

## 18. Cross-service learning

The live-verified Market patterns worth carrying as design references are RAW/content deduplication plus append-only observation, normalized current state plus semantic revision, forward successful-boundary checkpoints, overlap replay, and durable failed work. Company can use forward cursor/overlap for browser collection; Facility can use RAW hash/observation/revision for source changes; Certification can use current-state plus semantic revision for status history. None is declared a shared framework standard until each service validates the pattern against its own source behavior.

## 19. Recommended next phase

Proceed with **Phase 3-G.1 — Historical Job/Cursor + Lease + Resume/Status Foundation**. It should implement and test only the operational state needed for a resumable pilot. Rate/pacing, graceful stop, and pilot execution should remain separate follow-on phases.

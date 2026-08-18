# Phase 3-G.1 — Historical State Foundation

## Scope

This phase creates durable operational state only. It makes no KONEPS request and does not execute discovery, enrichment, pacing, retry scheduling, backup, or a full historical backfill.

## Model

`historical_backfill_job` is an immutable historical plan: start boundary, fixed cutoff, forward direction, query basis, and one-day chunk size. Its `successful_through` is initially `NULL`; it advances only when a chunk succeeds. It is separate from `collector_checkpoint`, so historical recovery cannot rewind the ongoing incremental checkpoint.

`historical_backfill_chunk` is a lazily materialized recovery unit. Its natural identity is `(job_id, range_start, range_end)`. A failed or crash-interrupted chunk is replayed as the same logical range. Existing RAW/blob/item dedup, append-only observations, and semantic normalization make that replay safe without deleting data.

`collector_lease` is one database-backed `market-collector` writer lease. It covers manual initial/incremental and historical work. A fresh lease rejects another holder with `COLLECTOR_BUSY`; release requires the same holder token. Its default TTL is 60 seconds and heartbeat refreshes expiry. A stale historical lease is removed only while recovering its matching job.

## State diagram

```text
create -> PLANNED
              |
        execution integration
              v
           RUNNING -- stop request --> PAUSED
              |                         |
              | crash + stale lease     | resume preparation
              v                         v
        stale recovery --------------> PAUSED
              |
       cursor reaches cutoff
              v
          COMPLETED
```

`paused` is resumable. `completed` rejects resume with `ALREADY_COMPLETED`. This phase does not implement destructive cancellation; it preserves data and job history.

Data state (responses, RAW items, observations, normalized rows, revisions) is distinct from operational state (job, chunk, cursor, lease, stop request). Recovery changes only operational state.

## Migration

Migration v5 (`phase3g1_historical_backfill_operational_state`) adds:

- `historical_backfill_job`
- `historical_backfill_chunk`
- `collector_lease`

Existing migration files are untouched. Fresh and v3/v4 databases migrate through v5.

## CLI

All commands output JSON and make zero API calls.

```powershell
npm run collector:backfill -- create --start 2001-01-01 --cutoff 2026-08-13T16:39
npm run collector:backfill -- status --job <JOB_ID>
npm run collector:backfill -- stop --job <JOB_ID>
npm run collector:backfill -- resume --job <JOB_ID>
```

`create` writes a planned job. `status` is read-only and reports time-range progress, last chunk, lease freshness, and work counts. `stop` writes a durable stop request. `resume` performs stale-state recovery, clears a stop request, and materializes the next chunk, but intentionally does **not** attach a transport loop or execute KONEPS calls. Its JSON includes `executionAttached: false`.

`collector:inspect` also includes historical jobs and the active lease. Existing manual collector execution acquires the same lease before loading configuration or making HTTP requests and releases it in `finally`.

## Tested guarantees

- migration v5: fresh, upgraded, and repeated-open validity;
- job bounds, immutable cutoff storage, and one active job policy;
- lazy unique chunk materialization and cursor advance only on success;
- lease acquire/release ownership, conflict, stale detection, and recovery;
- durable stop plus resume preparation;
- stale running job/chunk recovery without cursor movement or data deletion;
- existing collector test suite regression.

## Deferred

The next phase must integrate pacing, retry policy, durable stop checks at safe request/page boundaries, signal handling, and a real backfill execution loop. Pilot API calls and all full historical collection remain out of scope.

## Cross-service learning

The validated pattern is a durable job/chunk cursor plus holder-token lease and stale recovery, kept separate from domain data. Company, Facility, and Certification may use this as a design reference after validating their own source and operational behavior; no shared collector framework is introduced here.

## Live API calls

`0`

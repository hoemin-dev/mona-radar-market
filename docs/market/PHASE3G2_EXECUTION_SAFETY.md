# Phase 3-G.2 — Execution Safety Integration

## Execution model

`collector:backfill run --job <id>` is dry-run by default. Only `--execute` attaches KONEPS transport. Execution acquires the historical lease, materializes one lazy chunk at a time, performs discovery through the existing RAW/normalization pipeline, enqueues item/basis work, then atomically marks the historical chunk succeeded and advances its separate cursor. It uses discovery-first semantics: enrichment remains durable queue work and does not block historical discovery progress.

```text
lease -> chunk running -> discovery pages -> RAW + notice normalize
      -> durable enrichment enqueue -> atomic chunk/cursor finalization
      -> next chunk or paused/completed -> lease release
```

The existing incremental checkpoint is not advanced by historical execution.

## Pacing and retry

`RequestPacer` enforces a 500 ms minimum between request-attempt start times. The first attempt is immediate; a slow response adds no unnecessary wait. Every retry passes through the same pacer.

The KONEPS client retains retryable network, timeout, HTTP 429, and HTTP 5xx handling. Historical execution configures at most two retries (three attempts total), 1-second exponential-backoff base, and jitter. Configuration, ordinary 4xx, parse, and structure failures are not retried.

## Stop, signals, and lease

`stop` persists `stop_requested`. The execution loop checks it at chunk boundaries; cancellation returns without beginning another chunk. SIGINT/SIGTERM set an in-memory graceful-stop flag, which follows the same boundary path. A running HTTP attempt is allowed to complete or time out before stopping; page persistence is never deliberately interrupted mid-transaction.

The historical lease is heartbeated at chunk and discovery completion boundaries and released in `finally` for known exits. Crash recovery relies on the v5 stale-lease rules. The 60-second TTL is intentionally greater than the current 20-second request timeout; pacing/retry policy is documented rather than inferred as an API quota.

## Safety limits and dry-run

```powershell
npm run collector:backfill -- run --job <JOB_ID> --max-chunks 1 --max-api-calls 20
npm run collector:backfill -- run --job <JOB_ID> --max-chunks 1 --max-api-calls 20 --execute
```

The first command is dry-run: API calls 0 and no lease/job execution mutation. `--execute` is required for transport. `max-chunks` and `max-api-calls` are positive required execution limits; a bounded run pauses unless it reaches the fixed cutoff.

## Deferred

No live pilot/backfill was run in this phase. Enrichment drain, per-page stop checks, durable signal-to-stop write, backup, pilot metrics, and full historical operation remain follow-up work. The execution foundation is validated with offline state/client tests only.

## Live API calls

`0`

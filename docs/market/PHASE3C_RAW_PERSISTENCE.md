# Phase 3-C — RAW persistence

## Result and scope

Phase 3-C implements the Market-only SQLite RAW evidence layer. It does not
implement normalized bid tables, checkpoints, backfill, UI integration,
scheduling, or Search/Dash/Analysis. No KONEPS API call was made during this
phase.

Default runtime path:

```text
runtime/market/mona-radar-market.sqlite3
```

The entire `runtime/` tree, including SQLite, WAL, and SHM files, is ignored by
Git. Tests use isolated temporary databases or `:memory:`.

## Tables

| Table | Role | Key constraints |
|---|---|---|
| `collector_run` | One explicit user collection command | `run_id TEXT PK`; mode/status checks |
| `collector_operation_run` | One operation within a run | `operation_run_id TEXT PK`; FK run; unique run/service/operation/query basis |
| `api_call` | Redacted request and transport/API/page evidence | `call_id TEXT PK`; FK operation run and optional response blob |
| `api_response_blob` | Exact response bytes | integer PK; unique 64-character response SHA-256 |
| `api_raw_item` | Canonical item JSON | integer PK; unique `(service, operation, item_sha256)` |
| `raw_item_observation` | Item occurrence in a call/page/ordinal | integer PK; FKs call/item; unique `(call_id,page_no,item_ordinal)` |

Indexes cover runs by start time, operation runs by run and operation, calls by
operation run/operation/blob, blob hash, raw-item hash, observations by call,
and observation history by raw item.

## Migration

`collector/storage/migrations.ts` contains ordered, immutable SQL migrations.
SQLite `PRAGMA user_version` stores the current version. Each pending migration
runs under `BEGIN IMMEDIATE`; success sets the version and commits, while any
error rolls back. Reopening or rerunning migration is idempotent. A database
newer than the application-supported version is rejected; the database is
never destructively recreated.

The initial migration uses SQLite `STRICT` tables, foreign keys, status checks,
JSON validity checks, and positive paging/count constraints. Connections enable
foreign keys, WAL, full synchronous durability, and a five-second busy timeout.

## RAW write flow

For one successfully parsed API page:

1. SHA-256 the exact response bytes and insert-or-resolve `api_response_blob`.
2. Insert the redacted `api_call` referencing that blob.
3. Extract items from either live JSON `body.items` arrays or documented
   `body.items.item` wrappers.
4. Stable-sort every object key recursively, serialize without value
   normalization, SHA-256 it, and insert-or-resolve `api_raw_item`.
5. Insert one `raw_item_observation` for every call/page/ordinal occurrence.
6. Update run and operation counters.
7. Commit the page.

The blob, call, raw items, observations, and counters are one page transaction.
An error at any step rolls the entire page back, preventing broken partial
relations. Separate pages and operation runs are independent; the whole
collector run is deliberately not one giant transaction.

A failed-call API stores redacted call/error evidence and optional exact
response bytes without creating item observations. This lets one operation
fail without deleting evidence or rolling back other operation records.

## Hashing and deduplication

- Response identity: SHA-256 of exact response bytes.
- Item identity: SHA-256 of recursively key-sorted canonical JSON.
- Response bodies deduplicate globally by response hash.
- Items deduplicate within `(service, operation, item hash)`.
- Observations never deduplicate across calls; repeated collection produces a
  new occurrence linked to the existing raw item.

Canonicalization changes object key order only. It does not transform values.
Arrays retain order. Strings that look numeric or date-like remain strings.

## Empty, null, and missing

RAW JSON preserves source distinctions:

- `""` remains an empty string;
- `null` remains JSON null;
- an absent property remains absent;
- arrays and nested objects retain their structure and ordering.

An empty live response with `items=[]` creates a response blob and successful
API call with zero items and zero observations. Single- and multi-item pages use
the same path.

## Secret and privacy policy

The existing KONEPS redaction module processes URLs and metadata before SQL.
`ServiceKey` values are replaced with `[REDACTED]`; provided secret strings are
also removed from result messages and metadata. A database check prevents an
obviously unredacted `ServiceKey` URL. The exact response body is preserved as
API evidence, but ordinary logs do not print it.

Private Phase 3-B live evidence was neither modified nor copied. Tests use the
existing sanitized live fixture and fake credentials only.

## Verification

Offline tests cover:

- first creation and migration idempotency;
- isolated file database creation;
- response-blob and raw-item deduplication;
- repeat observations across calls;
- live sanitized multi-item round trip;
- empty, single, and multi-item pages;
- empty/null/missing preservation and stable key ordering;
- ServiceKey removal from stored URL/metadata;
- full page rollback after an intentional mid-item failure;
- failed-call evidence without observations.

The end-to-end test follows sanitized fixture → item extraction → RAW
persistence → SQLite query and compares every canonical item to the fixture.
HTTP calls in the test suite: zero.

## Deferred to Phase 3-D or later

- `bid_notice`, organizations, revision history, typed amounts/dates;
- normalization status processing and replay orchestration;
- operation checkpoints and overlap-driven incremental collection;
- 2001-to-current initial backfill;
- Collector UI and progress/cancellation UX;
- other KONEPS operations and domain relationships.

Phase 3-D should add bid-notice normalization and revision handling on top of
`api_raw_item`, preserving `source_raw_item_id` lineage. It should not alter the
Phase 3-C content hashes or observation history.

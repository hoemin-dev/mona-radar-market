# Manual collector strategy

## Phase 3-F implemented subset

Phase 3-F implements the manual period/incremental engine only for goods bid
notice discovery and notice-identity purchase-item/basis-amount enrichment.
Unlike the broader future graph below, these two enrichment operations are not
independent date scans in the current implementation. Discovery has the sole
timestamp checkpoint; durable work items drive enrichment. See
`PHASE3F_MANUAL_COLLECTOR.md` for the authoritative implemented behavior.

Opening, award, participant, contract, and contract-detail streams below remain
future design only. No scheduler or automatic execution exists.

## 1. Non-negotiable execution model

The collector runs only after an explicit user action. There is no cron, timer, background polling, startup sync, or scheduler. Closing the app stops initiating work; resumable state only supports the next explicit user action.

Modes:

1. **Period collection**: user supplies start/end; used for first load, backfill, repair and validation.
2. **Incremental collection**: user presses a button; each operation runs from its last successful checkpoint minus configurable overlap to a captured run cutoff.

If no eligible checkpoints exist, incremental collection must stop before any API request and show: “수집 이력이 없습니다. 최초 수집 기간을 지정해 주세요.” It must never infer an all-history start.

## 2. Run decomposition

`collector_run` is the user's command. It owns one `collector_operation_run` per selected approved operation. Overall status:

- `succeeded`: every selected operation succeeded;
- `partial`: at least one succeeded and at least one failed/skipped;
- `failed`: none succeeded or a run-level preflight failed;
- `cancelled`: user stopped; completed operation commits/checkpoints remain valid.

Each operation has its own transaction boundaries and checkpoint. A failure in awards does not roll back already committed bid notices or contracts.

## 3. Operation graph and order

The APIs are not one serial transaction. Use this dependency-aware order:

1. Parallel/logically independent discovery streams:
   - bid notice PPS search (notice-posted basis);
   - purchase items (notice-posted basis);
   - basis amount (input basis);
   - opening summary (opening-time basis preferred for outcome sync);
   - award status (opening-time basis preferred);
   - contract header (contract-conclusion day basis);
   - contract detail (registration-time basis).
2. After opening summaries commit, enqueue full opening identities for opening-complete participant fan-out.
3. After contract headers commit, optional identity fan-out can repair missing contract details; do not replace the detail operation's own registration-time scan.
4. Link normalized entities only after both sides exist; links are repeatable and do not block checkpoints.

Reason: most operations support independent date scans, while opening-complete has no date range and genuinely depends on identities discovered elsewhere.

## 4. Checkpoint granularity

Key: `(service, operation, query_basis)`.

Examples:

- bid notice + `notice_posted_datetime`;
- opening summary + `opening_datetime`;
- award + `opening_datetime`;
- contract header + `contract_conclusion_date`;
- contract detail + `registration_datetime`.

Do not maintain a single `market_last_collected_at`. Do not share a checkpoint between alternative query bases even for the same operation.

Opening-complete uses durable identity work items, not a timestamp. A work item is complete only after all pages for its full notice/order/classification/rebid key commit.

## 5. Successful checkpoint rule

For one operation window:

`request all pages → preserve raw → parse → normalize/upsert → commit all pages → mark operation success → atomically advance checkpoint`

The checkpoint boundary is the run cutoff selected before requests begin, not wall-clock completion. Never advance on request start, page receipt, or partial completion.

For very large ranges, implementation may split into explicit subwindows. Each subwindow may checkpoint only after all of its pages commit, making recovery bounded without pretending an incomplete window succeeded.

## 6. Overlap and delayed registration

Overlap is normal and duplicates are expected. Store configurable overlap per operation/query basis, initially unset until verification. Suggested test candidates—not hardcoded policy—are:

- minute-based endpoints: several hours to one day;
- day-based contract headers: one or more full KST calendar days.

Effective incremental range:

`last_success_boundary - configured_overlap` through `captured_now`

Because request precision is minute/day, use closed windows carefully. Next-run overlap plus idempotent UPSERT is safer than relying on undocumented inclusive/exclusive semantics.

## 7. Paging

For each date/subwindow:

1. request page 1 with configured `numOfRows`;
2. validate result envelope and echo paging values;
3. persist raw response/items;
4. calculate page count from `totalCount` and effective rows per page;
5. request sequential pages until the calculated end;
6. guard against total-count changes, repeated page hashes and empty premature pages;
7. record every call in the operation run.

Maximum `numOfRows`, page boundary behavior and total-count stability are **NEEDS API VERIFICATION**. Start conservatively after verification; never treat example value 999 as a limit.

## 8. Transactions and partial failure

- API call metadata/raw response may commit per call so failure evidence survives.
- Normalized writes commit per page or bounded subwindow, but operation checkpoint commits only after the whole checkpoint window succeeds.
- Retrying an incomplete operation replays overlap/subwindow and is idempotent.
- Other operation checkpoints are independent.
- Contract/notice linking is a separate derived transaction and cannot invalidate source ingestion.

## 9. Retry and traffic accounting

Retry only transient transport failures, HTTP 429/5xx, and explicitly classified temporary service errors. Use bounded exponential backoff with jitter and a user-visible retry count. Do not retry authentication, invalid parameters, parse/schema mismatch, or deterministic business errors automatically.

Record per run and per operation: calls attempted/succeeded/failed/retried, pages, received items, inserts, updates, unchanged rows, raw/normalization failures. The account UI reports daily traffic 1000 per detailed function, but the DOCX does not define that quota; treat 1000 as operational configuration/evidence, not a hardcoded protocol fact.

Before starting a large period collection, estimate minimum page calls after a lightweight plan based on configured date windows; if quota risk is high, warn and require the user to narrow/split the range. Do not build a complex quota manager initially.

## 10. Duplicate/change/delete handling

For each raw item:

1. calculate source natural key/fingerprint and canonical item hash;
2. no current row → `inserted`;
3. same key + same row hash → `unchanged`;
4. same key + different row hash → append revision and update current row (`updated`);
5. impossible/ambiguous key → raw succeeds, normalization fails visibly; checkpoint does not advance unless policy explicitly quarantines and counts it.

Never use SQLite row ID or response ordinal as the deduplication key. Never use `INSERT OR IGNORE` as the general policy.

Cancellation and deletion are different. Current approved notice fields (`ntceKindNm`, `chgDt`, `chgNtceRsn`) can reflect status changes; explicit future change/delete APIs should later provide stronger evidence. Only explicit source evidence sets `source_deleted_at`; retain the row for historical analysis.

## 11. Date/time and amount behavior

- Request ranges follow each operation's exact documented format.
- Preserve the source date/time string, parse into a Korean local wall-time representation, and record precision.
- Do not convert to UTC without an explicit source timezone contract.
- Validate KRW strings and store integer won. Reject commas, decimals or overflow until a documented rule exists.
- Store rates/quantities/scores as canonical decimal strings initially; computations use a decimal library later, not binary floating point.

## 12. User experience states

Preflight displays selected mode, operations, query bases, requested/effective ranges, overlaps and estimated scope. During collection show operation/page/call counters and partial statuses. Stop requests finish or safely abort the current write transaction; already successful operations remain committed. A retry action targets failed operations only and remains user-initiated.

## 13. Secrets

Future client reads `KONEPS_SERVICE_KEY` or an equivalent local configuration. It must redact the key from URLs before logs, call metadata, exceptions and raw-request storage. No key belongs in source, SQLite export, design docs or Git.

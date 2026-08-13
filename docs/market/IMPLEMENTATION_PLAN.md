# Staged implementation plan

Each stage is independently reviewable. Do not implement all services at once.

## Phase 3-A — client and configuration foundation

Status: **completed (fixture/mock verification only)**. See `PHASE3A_API_CLIENT.md`.

Scope:

- local `KONEPS_SERVICE_KEY` configuration contract and redaction;
- typed request/envelope abstractions limited to verified common behavior;
- HTTP timeout, bounded retry classification, call counters;
- fixture-based tests only, then minimal verification calls from `API_VERIFICATION_CHECKLIST.md`.

Exit: no background execution; a developer-only/manual path can safely make one redacted call and persist no domain data.

## Phase 3-B — one bid-notice operation

Implement only `getBidPblancListInfoThngPPSSrch` with period mode, validated minute windows and paging. Capture real fixtures and resolve envelope/null/page/range semantics. Keep Collector UI explicit and manual.

Exit: all pages for a narrow period can be fetched deterministically; no checkpoint yet.

## Phase 3-C — raw storage and run ledger

Apply only collection/raw migrations: run, operation run, call, blob, raw item, observation. Implement hashing, canonicalization, secret redaction and parser versioning.

Exit: an interrupted run leaves auditable raw/call state and can be replayed without duplicate blobs.

## Phase 3-D — bid-notice normalization and checkpoint

Apply `organization`, `bid_notice`, revision and operation checkpoint migrations. Implement INSERT/unchanged/update classification, period collection, then manual incremental collection with configurable overlap.

Exit: Search-ready bid notices exist; checkpoint advances only after full-window success.

## Phase 3-E — purchase items and basis amount

Add `getBidPblancListInfoThngPurchsObjPrdct` and `...BsisAmount`, product classifications, `bid_item`, `bid_basis_amount`, per-operation checkpoints and fixtures. Validate cardinalities and natural keys before UNIQUE constraints are finalized.

Exit: notice → items/basis relationships and pump-relevant product fields are queryable; no pump filter yet.

## Phase 3-F — opening summary and participants

Add `getOpengResultListInfoThngPPSSrch`, `opening_result`, identity work queue, then `getOpengResultListInfoOpengCompt` and `opening_participant`. Keep packed `opengCorpInfo` raw; do not use it as the participant source.

Exit: manual run can recover a failed identity fan-out without moving unrelated checkpoints.

## Phase 3-G — final awards and companies

Add `getScsbidListSttusThngPPSSrch`, `market_company`, `award` and evidence-based company merging. Verify multi-winner and masked-number behavior first.

Exit: company award counts/amounts and participant competition queries are possible.

## Phase 3-H — contracts

Add contract header first, parse `corpList`/`dminsttList` into child relations while preserving original strings, then add contract detail and fingerprint collision monitoring.

Exit: contract, parties, demand institutions and contract items are independently correct.

## Phase 3-I — lifecycle linking

Implement explicit `entity_link` evidence rules for contract↔notice and optional item linkage. Produce unmatched/ambiguous reports; never silently force a link.

Exit: traceability metrics include exact, ambiguous and unmatched counts.

## Phase 3-J — Search, Dash and Analysis read models

Only after ingestion stability: FTS/index tuning, period/organization/company/product queries, market-size and award-rate calculations. Read normalized tables only.

## Phase 3-K — future integrity APIs

After separate approval, evaluate and add goods notice change history, contract change/delete history, explicit failed/rebid operations, and preliminary-price detail. Each receives its own operation/checkpoint/parser and migration review.

## Cross-phase quality gates

- fixtures contain no service key;
- no scheduler/timer/startup collection;
- each operation has contract tests for empty/null/error/paging;
- raw-to-normalized lineage is queryable;
- schema changes are migrations, never destructive recreation;
- operation failure cannot corrupt another operation's checkpoint;
- application logs cannot expose credentials or full sensitive payloads;
- each phase updates these design documents when live evidence changes an assumption.

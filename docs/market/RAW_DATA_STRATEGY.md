# Raw API data preservation strategy

## 1. Options

| Option | Strengths | Weaknesses |
|---|---|---|
| A. Whole response per call | Reproduces paging/envelope exactly; useful for transport debugging | Repeats envelope; hard to reprocess one item; large duplicate storage during overlaps |
| B. Item raw JSON only | Deduplicates/reprocesses naturally; item-level lineage | Loses exact envelope, page order, headers and empty-response evidence |
| C. Hybrid | Keeps request/page evidence and item-level lineage | Slightly more schema and write logic |

## 2. Recommendation: bounded hybrid

**Phase 3-C implementation status:** implemented for run/operation, call,
response blob, canonical raw item, and observation storage. The default database
is `runtime/market/mona-radar-market.sqlite3`; schema versioning uses ordered SQL
migrations plus `PRAGMA user_version`. See `PHASE3C_RAW_PERSISTENCE.md`.

Use **C**:

1. `api_call` stores request metadata, response status, result code/message, paging counts, content type, byte count, SHA-256 and timestamps. It must store a redacted/canonical request; never persist `ServiceKey`.
2. `api_response_blob` stores the exact response bytes once per distinct SHA-256, compressed when beneficial. Retention is configurable; failed, malformed, empty-edge-case and schema-new responses are pinned.
3. `api_raw_item` stores each item as canonical UTF-8 JSON plus item hash, source operation, source natural-key text, call/page/ordinal lineage, parser version and normalization state.

This is not “store every page forever twice.” The blob layer is content-addressed; overlap duplicates point to an existing blob/item hash. Item raw remains the durable re-normalization unit.

## 3. Ingestion order

Within one operation/page transaction:

1. create/update `api_call` without a secret;
2. write response blob and hash;
3. parse the envelope without discarding original bytes;
4. insert raw items with ordinal and canonical hash;
5. normalize/upsert domain records with `raw_item_id` lineage;
6. commit page progress;
7. after every page succeeds, advance operation checkpoint.

Malformed responses are stored as blobs with `parse_status=failed`; no domain rows or checkpoint are advanced for that page.

## 4. Canonicalization and deduplication

- Hash the exact response bytes for forensic equality.
- Separately canonicalize each JSON item by stable key ordering and UTF-8 encoding, then hash it.
- XML responses, if used, keep exact bytes; parse into the same canonical item JSON form.
- Deduplicate storage by `(operation, item_sha256)` but record every observation in `raw_item_observation` so repeated receipt and run lineage are not lost.
- Treat empty string, absent key and JSON null as distinct raw states until live verification establishes semantics.

## 5. Retention

Initial policy:

- `api_raw_item` and observations: durable;
- response blobs: durable for failures/schema changes and configurable for successful duplicate pages;
- call metadata: durable;
- never delete raw data automatically in the first implementation.

Any later compaction must be an explicit maintenance action with counts, hashes and rollback evidence. SQLite WAL/backup behavior must be designed before enabling compaction.

## 6. Privacy and security

- redact `ServiceKey` before logging or persistence;
- treat business numbers, names, addresses, phones and emails as potentially sensitive operational data;
- do not copy raw payloads into normal application logs;
- Search/Dash/Analysis read normalized tables, never raw JSON directly.

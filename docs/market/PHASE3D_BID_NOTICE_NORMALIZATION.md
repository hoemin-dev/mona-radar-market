# Phase 3-D — bid notice normalization

## Scope and result

Phase 3-D adds the first query-oriented domain projection on top of immutable
Phase 3-C RAW evidence. Only
`BidPublicInfoService/getBidPblancListInfoThngPPSSrch` is supported. No live API
call, checkpoint, backfill, UI, scheduler, or other operation normalizer was
added.

## Migration and tables

Migration version 2 adds:

- `bid_notice`: current normalized notice state;
- `bid_notice_revision`: prior and new semantic states for meaningful updates.

Migration 1 is unchanged. Existing v1 databases migrate transactionally to v2,
while fresh databases apply v1 then v2. `PRAGMA user_version` is 2.

### `bid_notice`

- Internal PK: `bid_notice_id INTEGER PRIMARY KEY`
- Natural unique key: `(bid_ntce_no, bid_ntce_ord)`
- Current RAW lineage: `source_raw_item_id` FK to `api_raw_item`
- Source operation, semantic SHA-256, canonical semantic-state JSON, warning
  JSON, and first/last normalization timestamps

Indexes cover notice/close/opening date, notice and demand institution code,
detailed product class, notice name, natural key, and source RAW item.

### `bid_notice_revision`

Each meaningful update stores:

- notice FK and change time;
- previous/new semantic row hash;
- previous/new RAW item FK;
- complete previous/new canonical normalized semantic state JSON.

This permits historical state reconstruction without changing RAW content or
requiring another KONEPS call.

## Field mapping

| Group | Source | Normalized columns |
|---|---|---|
| Identity | `bidNtceNo`, `bidNtceOrd` | `bid_ntce_no`, `bid_ntce_ord` |
| Notice | `bidNtceNm`, `ntceKindNm`, `rgstTyNm`, `refNo` | name, kind, registration type, reference |
| Organizations | `ntceInsttCd/Nm`, `dminsttCd/Nm` | notice/demand code and name snapshots |
| Method | `cntrctCnclsMthdNm`, `bidMethdNm`, `sucsfbidMthdCd/Nm` | contract, bid, award method |
| Timeline | `bidNtceDt`, `bidBeginDt`, `bidClseDt`, `opengDt`, `rgstDt`, `chgDt` | source raw and canonical local text pairs |
| Product | detailed class number/name, quantity/unit/unit price/spec/list | search-oriented product summary |
| Amount | `asignBdgtAmt`, `presmptPrce`, `VAT`, `indutyVAT` | nullable SQLite INTEGER |
| Flags | international/re-notice/rebid/manufacture/designated/class-limit Y/N | nullable source TEXT |
| URLs | notice, detail, standard document | nullable TEXT |

The other API fields remain fully recoverable through `source_raw_item_id`; the
domain table is intentionally not a 101-column mirror.

## Type and empty-value policy

- Identifiers and codes remain TEXT, preserving leading zeros and legacy forms.
- Valid `YYYY-MM-DD HH:mm[:ss]` source dates become sortable
  `YYYY-MM-DDTHH:mm:ss` local-wall-time TEXT. No UTC assumption is made.
- Date source text is also retained in the normalized subset. Invalid optional
  dates keep raw text, set canonical value NULL, and add a warning.
- Confirmed non-negative integral monetary/unit-price strings within signed
  SQLite 64-bit range become INTEGER. Empty or malformed values become NULL;
  they never become zero.
- Quantity remains TEXT because decimal/historical behavior is not fully
  constrained.
- Y/N-like flags remain TEXT. Unexpected non-empty codes are retained with a
  warning rather than coerced to false.
- Optional `""`, JSON null, and missing all project to SQL NULL. Their exact
  distinction remains available in immutable RAW JSON. No default value is
  invented.

Only the natural-key fields are required for normalization. Sparse historical
records with many empty optional fields remain valid notices.

## Parse warnings

The deterministic normalizer returns `{candidate, warnings,
semanticStateJson, semanticRowHash}`. Warnings are small field/code objects for
invalid type, datetime, integer, or unexpected flag. An optional-field warning
does not reject the notice. Invalid/missing natural-key fields do reject it.

## Semantic row hash and write classification

The semantic state is the recursively key-sorted JSON representation of all
normalized business fields. BigInt values are represented as exact decimal
strings for hashing. SHA-256 of that state is `semantic_row_hash`.

The hash excludes internal ID, source RAW ID, operation, warning/timestamp
metadata, and normalization time.

- No natural-key row: `INSERTED`.
- Existing row with equal semantic hash: `UNCHANGED`; no revision, but current
  RAW lineage and last-normalized time advance.
- Existing row with different semantic hash: `UPDATED`; insert revision first,
  then replace current normalized fields and RAW lineage in one transaction.

A change only to an unused RAW field therefore remains `UNCHANGED` and creates
no domain revision. Phase 3-C observations remain untouched in all cases.

## RAW lineage and replay

Current provenance path:

```text
bid_notice.source_raw_item_id
→ api_raw_item
→ raw_item_observation
→ api_call
→ api_response_blob
```

Revision rows retain both previous and new RAW IDs. Parsing is separated from
database writing, so stored `canonical_json` can be replayed through an improved
normalizer without an API call.

## Historical sparse result

The sanitized 2001 fixture retains the current 101-field API shape but has only
48 non-empty fields in the sampled item. It normalizes successfully: identity,
name, and notice date remain usable; an empty allocated budget becomes NULL.
Sparse optional fields do not reject the record.

## Verification

Offline tests cover v1→v2 and fresh migration, 2026 multi-item input, sparse
2001 input, date/integer conversion, empty and malformed optional values,
INSERT/UNCHANGED/UPDATE, revision creation/non-creation, unused RAW-field
changes, current and revision RAW lineage, technical-field hash exclusion, and
date/organization/product/name SQL queries.

All project tests pass with zero HTTP calls. Normalized state/warnings contain
no ServiceKey field or value.

## Deferred

- checkpoint, overlap, incremental collection, and 2001-to-current backfill;
- automatic replay command and parser-version migration policy;
- organization master and richer product entities;
- `bid_item`, basis amount, opening, award, contract normalization;
- Search/Dash/Analysis UI and FTS.

Phase 3-E should remain a separately bounded normalization phase. Before adding
new operations, decide whether to implement checkpoint/backfill orchestration
or first normalize purchase items and basis amounts; do not combine both large
changes in one migration.

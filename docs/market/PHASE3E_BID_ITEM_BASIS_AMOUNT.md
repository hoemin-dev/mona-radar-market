# Phase 3-E — bid item and basis amount normalization

## Live evidence and scope

Two manually approved calls completed before this continuation. This continuation made no API calls.

| Operation | HTTP/result | Items | Fields | Fixture |
|---|---|---:|---:|---|
| `getBidPblancListInfoThngPurchsObjPrdct` | 200 / `00` | 1, array | 19 | `bid-item.json` |
| `getBidPblancListInfoThngBsisAmount` | 200 / `00` | 1, array | 24 | `bid-basis-amount.json` |

Both samples use notice `R26BK01681950`, order `000`, classification `1`. Purchase item sequence is `1`. Historical availability for these two operations remains unresolved; no inference is made from historical bid-notice availability.

## Exact live field inventory

Every observed value was a JSON string. Empty strings project to SQL NULL and remain exactly recoverable in RAW.

### Purchase item (19)

| Fields | Role / policy |
|---|---|
| `bidNtceNo`, `bidNtceOrd`, `bidClsfcNo`, `prdctSno` | required TEXT identity |
| `dminsttCd`, `dminsttNm` | demand organization snapshot |
| `prdctClsfcNo`, `prdctClsfcNoNm` | product class code/name |
| `dtilPrdctClsfcNo`, `dtilPrdctClsfcNoNm` | detailed product class code/name |
| `prdctSpecNm` | product specification/name |
| `qty`, `unit` | quantity remains TEXT; unit TEXT |
| `uprc` | nullable signed-64-bit INTEGER after strict unsigned-integer validation |
| `dlvrTmlmtDt` | raw TEXT plus canonical local datetime; empty in sample |
| `dlvrDaynum` | TEXT because one sample cannot establish numeric domain |
| `dlvrPlce`, `dlvryCndtnNm` | delivery text |
| `ntceNticeDt` | raw TEXT plus canonical local datetime |

Natural key: `(bidNtceNo, bidNtceOrd, bidClsfcNo, prdctSno)`. All four fields exist and are non-empty in the live row and match the documented item discriminator. The one-row fixture cannot prove cross-notice stability, which remains a protocol limitation.

### Basis amount (24)

| Fields | Role / policy |
|---|---|
| `bidNtceNo`, `bidNtceOrd`, `bidClsfcNo` | required TEXT identity |
| `bidNtceNm` | notice-name snapshot |
| `bssamt`, `evlBssAmt`, `industSftyHelthMngcst`, `rtrfundNon`, `envCnsrvcst`, `scontrctPayprcePayGrntyFee`, `mrfnHealthInsrprm`, `npnInsrprm`, `usefulAmt` | nullable signed-64-bit INTEGER after strict validation |
| `rsrvtnPrceRngBgnRate`, `rsrvtnPrceRngEndRate`, `dfcltydgrCfcnt`, `etcGnrlexpnsBssRate`, `gnrlMngcstBssRate`, `prftBssRate`, `lbrcstBssRate` | canonical decimal TEXT |
| `bssamtOpenDt`, `inptDt` | raw TEXT plus canonical local datetime |
| `rmrk1`, `rmrk2` | nullable remark TEXT |

Natural key: `(bidNtceNo, bidNtceOrd, bidClsfcNo)`. The live and official field sets contain no additional sequence. The schema does not use `UNIQUE(bidNtceNo)` and revision history preserves meaningful changes. Multiple simultaneous current rows for the same full key remain unresolved.

## Schema and parent policy

Migration v3 adds `bid_item`, `bid_item_revision`, `bid_basis_amount`, and `bid_basis_amount_revision`. Existing v1/v2 migrations are unchanged. Fresh databases apply v1→v2→v3; existing v2 databases migrate transactionally; reopening is idempotent.

Both current tables require `bid_notice_id` referencing `bid_notice`. Parent lookup uses exact `(bidNtceNo, bidNtceOrd)`. A missing parent returns `deferred`; no orphan or pending-queue framework is created and RAW remains intact.

Indexes support parent notice, product class, detailed class, demand organization, basis opening datetime, basis amount, and RAW lineage queries. No FTS or UI was added.

## Normalization and revisions

`normalizeBidItem(rawItem)` and `normalizeBidBasisAmount(rawItem)` are deterministic, database-free functions returning a candidate, warnings, canonical semantic JSON, and SHA-256 semantic row hash.

- Identifiers and codes remain TEXT, preserving leading zeroes.
- Quantity and delivery-day count remain TEXT.
- Valid monetary strings within SQLite signed 64-bit range become INTEGER; empty is NULL; malformed/out-of-range is NULL plus warning.
- Rates and coefficients use normalized decimal TEXT, avoiding binary floating-point loss. Leading `+`, redundant leading zeroes, and trailing fractional zeroes are removed. No decimal library is required.
- Dates retain source text and a sortable ISO-like local-wall-time value. Invalid values retain raw text, project canonical NULL, and add a warning.
- Unknown RAW fields are excluded from semantic state.

Writes return `inserted`, `unchanged`, `updated`, or `deferred`. Unchanged semantic content advances current RAW lineage without a revision. Meaningful changes append old/new hashes, old/new RAW IDs, and reconstructable old/new semantic JSON before updating the current row.

Lineage is `normalized row → source_raw_item_id → api_raw_item → raw_item_observation → api_call → api_response_blob`. Revision rows retain both old and new RAW IDs.

## Verification

Offline tests cover migration v2→v3, fresh migration, reopen idempotency, exact 19/24-field array shapes, pure normalization, malformed/empty values, decimal precision, missing-parent deferral, INSERT/UNCHANGED/UPDATED, revisions, unused-field stability, RAW lineage, parent/product/institution/date/amount queries, and sanitized fixture → RAW → normalized E2E.

Phase 3-E cumulative live calls: 2 (the two manual verification calls). Live calls during this continuation: 0. No service key or private runtime response was copied into source, fixtures, logs, documentation, tests, or normalized data.

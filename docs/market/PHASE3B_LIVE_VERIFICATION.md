# Phase 3-B — KONEPS live verification

## Result

The stored response from 2026-08-13 was analyzed directly before considering another request. No additional live call was made during this follow-up.

- Service: `BidPublicInfoService`
- Operation: `getBidPblancListInfoThngPPSSrch`
- Query: `inqryDiv=1`, `202608131638`–`202608131648` KST
- Page: `pageNo=1`, `numOfRows=5`
- Live API calls that produced this evidence: 1
- Additional calls during follow-up: 0
- Verified key mode: `preserve`
- HTTP: `200`
- Content type: `application/json;charset=UTF-8`
- Encoding: UTF-8
- Response size: 24,410 bytes
- Duration: 1,006 ms
- Header: `resultCode="00"`, `resultMsg="정상"`

The service key is not included in this document, the fixture, or logs.

## Actual JSON shape

The actual live structure is:

```text
$.response                                    object
$.response.header                             object
$.response.body                               object
$.response.body.items                         array (5 objects)
$.response.body.pageNo                        number (1)
$.response.body.numOfRows                     number (5)
$.response.body.totalCount                    number (14)
```

The actual item path is `$.response.body.items[*]`. There is no JSON `$.response.body.items.item` property in this response.

### Initial analyzer error and fix

Initial analyzer result: `itemsPath=$.response.body.items`, `itemKind=missing`, `itemCount=0`.

Actual evidence: `items` itself is an array containing five objects, while `totalCount` is 14.

Cause: the analyzer discovered the `items` path but only treated a child whose name ended in `.item` as data. That assumption matched the documented XML and synthetic wrapper fixture, but not KONEPS JSON's flattened array.

Fix: `live-shape.ts` now prefers an explicit `items.item` value when present and otherwise treats an array (or null empty marker) at `items` itself as the item value. This supports both shapes without an operation-specific hack.

## Paging and runtime types

| Field | Live value | JSON type | Status |
|---|---:|---|---|
| `pageNo` | 1 | number | CONFIRMED |
| `numOfRows` | 5 | number | CONFIRMED |
| `totalCount` | 14 | number | CONFIRMED |

The requested five rows were returned. Because `totalCount > numOfRows`, a second page exists in principle, but pagination semantics were not tested because the stored page is sufficient to fix and regress the analyzer.

## Live item inventory

Five items were returned. Their union and the first item both contain 101 top-level fields. All 101 response fields documented in the official DOCX table for this operation were observed; there were no live-only fields and no documented-but-unobserved fields in this sample.

Important observed fields include:

- Identity: `bidNtceNo`, `bidNtceOrd`, `untyNtceNo`, `befBidBbancNo`
- Description/status: `bidNtceNm`, `refNo`, `rgstTyNm`, `ntceKindNm`, `reNtceYn`
- Institutions: `ntceInsttCd`, `ntceInsttNm`, `dminsttCd`, `dminsttNm`
- Method: `bidMethdNm`, `cntrctCnclsMthdNm`, `sucsfbidMthdCd`, `sucsfbidMthdNm`
- Timeline: `bidNtceDt`, `bidBeginDt`, `bidClseDt`, `opengDt`, `rbidOpengDt`, `rgstDt`, `chgDt`
- Product: `dtilPrdctClsfcNo`, `dtilPrdctClsfcNoNm`, `prdctSpecNm`, `prdctQty`, `prdctUnit`, `prdctUprc`, `purchsObjPrdctList`
- Amount/rate: `asignBdgtAmt`, `presmptPrce`, `VAT`, `indutyVAT`, `bidPrtcptFee`, `sucsfbidLwltRate`
- Relationships: `orderPlanUntyNo`, `bfSpecRgstNo`
- URLs: `bidNtceDtlUrl`, `bidNtceUrl`, `stdNtceDocUrl`, `ntceSpecDocUrl1`–`ntceSpecDocUrl10`

The complete inventory is retained by the sanitized live fixture and asserted through the analyzer rather than duplicated as values in logs.

Complete first-item field inventory (101):

```text
VAT, arsltApplDocRcptDt, arsltApplDocRcptMthdNm, asignBdgtAmt,
befBidBbancNo, bfSpecRgstNo, bidBeginDt, bidClseDt,
bidGrntymnyPaymntYn, bidMethdNm, bidNtceDt, bidNtceDtlUrl,
bidNtceNm, bidNtceNo, bidNtceOrd, bidNtceUrl, bidPrceEvlRt,
bidPrtcptFee, bidPrtcptFeePaymntYn, bidQlfctRgstDt,
bidWgrnteeRcptClseDt, brffcBidprcPermsnYn, chgDt, chgNtceRsn,
cmmnSpldmdAgrmntClseDt, cmmnSpldmdAgrmntRcptdocMethd,
cmmnSpldmdCorpRgnLmtYn, cmmnSpldmdMethdCd, cmmnSpldmdMethdNm,
cntrctCnclsMthdNm, crdtrNm, dlvrDaynum, dlvrTmlmtDt,
dlvryCndtnNm, dminsttCd, dminsttNm, dminsttOfclEmailAdrs,
drwtPrdprcNum, dsgntCmptYn, dtilPrdctClsfcNo,
dtilPrdctClsfcNoNm, exctvNm, indstrytyLmtYn, indutyVAT,
infoBizYn, intrbidYn, mnfctYn, ntceInsttCd, ntceInsttNm,
ntceInsttOfclEmailAdrs, ntceInsttOfclNm, ntceInsttOfclTelNo,
ntceKindNm, ntceSpecDocUrl1, ntceSpecDocUrl2, ntceSpecDocUrl3,
ntceSpecDocUrl4, ntceSpecDocUrl5, ntceSpecDocUrl6,
ntceSpecDocUrl7, ntceSpecDocUrl8, ntceSpecDocUrl9,
ntceSpecDocUrl10, ntceSpecFileNm1, ntceSpecFileNm2,
ntceSpecFileNm3, ntceSpecFileNm4, ntceSpecFileNm5,
ntceSpecFileNm6, ntceSpecFileNm7, ntceSpecFileNm8,
ntceSpecFileNm9, ntceSpecFileNm10, opengDt, opengPlce,
orderPlanUntyNo, prdctClsfcLmtYn, prdctQty, prdctSpecNm,
prdctUnit, prdctUprc, prearngPrceDcsnMthdNm, presmptPrce,
purchsObjPrdctList, rbidOpengDt, rbidPermsnYn, reNtceYn, refNo,
rgnLmtBidLocplcJdgmBssCd, rgnLmtBidLocplcJdgmBssNm, rgstDt,
rgstTyNm, rsrvtnPrceReMkngMthdNm, stdNtceDocUrl,
sucsfbidLwltRate, sucsfbidMthdAppStd, sucsfbidMthdCd,
sucsfbidMthdNm, techAbltEvlRt, totPrdprcNum, untyNtceNo
```

## Item value types and states

Every observed item field in these five rows is a JSON string, including identifiers, amounts, quantities, counts, rates, and Y/N flags. In particular, `bidNtceNo`, `bidNtceOrd`, `ntceInsttCd`, `dminsttCd`, `dtilPrdctClsfcNo`, `orderPlanUntyNo`, `asignBdgtAmt`, `presmptPrce`, `prdctQty`, and `prdctUprc` are strings. They must not be converted merely because their contents may look numeric.

Across 5 × 101 values:

- missing: 0
- JSON null: 0
- empty string: 182 values across 47 fields
- whitespace-only string: 0
- JSON number zero: 0
- boolean: 0
- non-empty string: 323

Some non-empty numeric-looking strings contain `0`, but no item value in this sample is a JSON number. Empty strings are therefore a confirmed source representation and must remain distinct from missing and null during RAW handling.

## Official DOCX comparison

| Comparison | Result |
|---|---|
| Operation and request field names | CONFIRMED |
| Header/body and paging names | CONFIRMED |
| 101 documented item fields | CONFIRMED (101/101 observed) |
| Documented but not observed item fields | none in this sample |
| Live-only / not found in DOCX fields | none in this sample |
| XML `items/item` versus JSON `items` | DIFFERS FROM DOC example serialization |
| Machine JSON types for item fields | LIVE-CONFIRMED as string; DOCX does not specify JSON machine types |

The DOCX XML example uses `<items><item>…</item></items>`. The actual JSON flattens that to `"items": [{…}]`. Live evidence is authoritative for the JSON parser while the document remains authoritative for field descriptions.

## Evidence and sanitization

Private exact evidence remains only under ignored `runtime/koneps-live/2026-08-13T08-08-37-399Z/`; it was not copied into Git. The regression fixture is `collector/koneps/fixtures/live-sanitized/bid-notice.json`.

The private response and sanitized fixture have identical nesting, keys, arrays, scalar types, null/empty states, and item count. Sanitization replaces officer, telephone, and email values while preserving empty contact fields. The fixture contains no `ServiceKey` property. Regression coverage verifies the actual root/header/body/items structure, five-item count, paging types, identifier strings, an otherwise-unmodeled field, contact redaction, and secret absence.

## Still not verified

- empty and single-item live-response representations;
- page 2, total-count stability, duplicate behavior, and final page;
- date boundary inclusivity and source timezone semantics;
- maximum supported page size and date span;
- null, whitespace-only, boolean, object, or array item-field values outside this five-row sample;
- other services and operations.

No DB, RAW persistence implementation, checkpoint, repository, domain normalizer, UI connection, scheduler, polling, historical probe, or automatic collection was added. Resolve remaining protocol questions with separately approved minimal calls before Phase 3-C schema decisions depend on them.

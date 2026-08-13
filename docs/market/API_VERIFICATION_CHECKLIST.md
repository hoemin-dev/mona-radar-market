# Live API verification checklist for the next phase

No item below was tested in this design phase.

## Envelope and transport

- [ ] Actual JSON nesting and key capitalization for all three services
- [ ] XML/JSON parity and default format when `type` is omitted
- [ ] Empty-result envelope and whether `items` is absent, null, object or array
- [ ] HTTP status versus `resultCode` behavior
- [ ] Maximum supported `numOfRows`; returned versus requested page size
- [ ] `totalCount` stability while paging and final-page behavior
- [ ] Daily 1000-call quota semantics and whether it is per operation/key/account/day
- [ ] Encoding of `ServiceKey` and safe redaction behavior

## Time/range semantics

- [ ] Start/end inclusivity for minute and date requests
- [ ] Same-minute boundary duplicates and ordering
- [ ] Maximum allowed date span per request
- [ ] Source timezone and daylight-saving assumptions (expected Korea local, not asserted)
- [ ] Delayed registration/change distribution to choose overlap per operation
- [ ] Whether notice “공고일시” and “공고게시일시” are used consistently in operation 20 documentation/results

## Nulls and types

- [ ] Missing key vs JSON null vs empty string vs `N/A`
- [ ] Amounts beyond 64-bit range or containing decimal/comma/sign
- [ ] Quantity, percentage and score precision/scale
- [ ] Old malformed `dlvrTmlmt` values
- [ ] Boolean code variants beyond Y/N
- [ ] URL escaping and invalid/truncated URL values

## Identity and cardinality

- [ ] Multiple `bidClsfcNo` per notice/order
- [ ] Multiple purchase items and stability of `prdctSno`
- [ ] Multiple basis amounts for a full bid key
- [ ] Multiple rebids and zero-padding consistency of `rbidNo`
- [ ] Duplicate participant business number/rank combinations
- [ ] Multiple winners and joint winners in award output
- [ ] Business-number masking/null behavior
- [ ] `corpList` and `dminsttList` escaping when values contain caret/comma/brackets
- [ ] Contract item uniqueness when `prdctIdntNo` is absent
- [ ] Organization-code namespaces and reuse across roles

## Cross-service links

- [ ] Contract `ntceNo` parsing across legacy and new numbering
- [ ] Whether contract `ntceNo` includes notice order consistently
- [ ] `prcrmntReqNo` ↔ `reqNo` normalization/equality
- [ ] `untyNtceNo` relationship to normal notice number
- [ ] Product-class consistency from bid item through contract item
- [ ] Award-to-contract multiplicity and timing lag

## Change/failure behavior

- [ ] Modified notice returned by date overlap and meaning of `chgDt`
- [ ] Cancelled notice representation in `ntceKindNm`/reason
- [ ] Failed/rebid/opening-complete transitions
- [ ] Future change/delete history API approval and actual keys
- [ ] Retry-safe response for a repeated identical request
- [ ] Schema drift detection using unknown fields

## Minimal-call protocol

When implementation begins, use one narrow historical interval and one known identity per operation. Save exact redacted response bytes, compare XML/JSON only if needed, and stop after resolving this checklist's structural questions. Do not start a backfill during verification.

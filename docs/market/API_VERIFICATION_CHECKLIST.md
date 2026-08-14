# Live API verification checklist

## Bid-notice verification

- [x] Only the approved goods bid-notice search operation is registered
- [x] Dry-run by default; `--execute` required for transport
- [x] Missing backend key stops before HTTP transport
- [x] Historical dates require `--historical`; window/page/row limits enforced
- [x] Exact evidence stays in ignored `runtime/koneps-live/`; committed fixtures are sanitized
- [x] HTTP 200, string result code `00`, and `preserve` key mode verified
- [x] Actual JSON nesting is `response.body.items` array
- [x] Pagination verified: total 14, pages contain 5 / 5 / 4 rows, page 3 is final
- [x] Empty live response verified: HTTP 200, result `00`, total 0, `items=[]`
- [x] Single-item response remains an array
- [x] Historical bid-notice availability verified with 2001 live data
- [x] Sparse 2001 records normalize without inventing values
- [x] Practical initial bid-notice backfill lower bound recorded as `2001-01-01` (not a claim of a record on that date)

## Phase 3-E purchase-item verification

- [x] Operation: `getBidPblancListInfoThngPurchsObjPrdct`
- [x] Identity mode `inqryDiv=2`; notice number and order required
- [x] HTTP 200, result `00`, total 1, actual items 1
- [x] `items` is an array and the live item has 19 string fields
- [x] Identity fields present: `bidNtceNo`, `bidNtceOrd`, `bidClsfcNo`, `prdctSno`
- [x] Sanitized shape-preserving fixture stored as `bid-item.json`
- [x] Migration v3 and normalization implemented from live evidence
- [ ] Multiple purchase items and cross-response stability of `prdctSno`
- [ ] Historical availability for this operation

## Phase 3-E basis-amount verification

- [x] Operation: `getBidPblancListInfoThngBsisAmount`
- [x] Identity mode `inqryDiv=2`; notice number required by verification command
- [x] HTTP 200, result `00`, total 1, actual items 1
- [x] `items` is an array and the live item has 24 string fields
- [x] Identity fields present: `bidNtceNo`, `bidNtceOrd`, `bidClsfcNo`
- [x] Sanitized shape-preserving fixture stored as `bid-basis-amount.json`
- [x] Migration v3 and normalization implemented from live evidence
- [ ] Multiple current basis rows for one full notice/order/classification key
- [ ] Historical availability for this operation

## Still unresolved — envelope and transport

- [ ] XML/JSON parity and default format when `type` is omitted
- [ ] Maximum supported `numOfRows`
- [ ] Daily call-quota semantics
- [ ] Retry behavior for repeated identical live requests

## Still unresolved — time and change semantics

- [ ] Start/end inclusivity and same-minute boundary ordering
- [ ] Maximum permitted live date span beyond the verification safety limit
- [ ] Delayed registration/change distribution for overlap design
- [ ] Meaning of change timestamps and cancellation/rebid transitions
- [ ] Future explicit change/delete API behavior

## Still unresolved — value domains

- [ ] Amounts containing decimal, comma, sign, or values outside signed 64-bit range
- [ ] Quantity, percentage, coefficient, and score scale/range across diverse records
- [ ] Historical malformed delivery-deadline variants
- [ ] Boolean variants beyond Y/N
- [ ] URL escaping and truncated URL values

## Still unresolved — later entities and cross-links

- [ ] Multiple rebids and `rbidNo` zero-padding
- [ ] Participant and winner multiplicity/identity behavior
- [ ] Business-number masking and null behavior
- [ ] Contract packed-list escaping and contract-item uniqueness
- [ ] Organization-code namespaces
- [ ] Contract-to-notice and request-number normalization
- [ ] Product-class consistency from bid item through contract item
- [ ] Award-to-contract multiplicity and timing lag

## Minimal-call protocol

Use one known identity or narrow historical interval per unresolved question. Preserve exact private evidence only under ignored runtime storage, commit only sanitized shape-preserving fixtures, and stop when structural evidence is sufficient. Do not start a backfill during verification.

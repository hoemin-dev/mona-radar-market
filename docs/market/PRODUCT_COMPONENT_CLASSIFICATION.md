# Product / component classification

## Domain rule

MonaRadar Market classifies an exact catalog item, never a 10-digit detailed
product class. The only evidence is the Public Procurement Service catalog
field on that exact `prdctIdntNo`: `cmpntYn=Y` means `part`, and `cmpntYn=N`
means `product`. Names, specifications, `mnfctYn`, and `prdctClsfcLmtYn` are
never classification evidence.

Different items under the same `dtilPrdctClsfcNo` may legitimately have
different categories. For `4015155301` the complete 2026-08-21 response had
63 active items with `N` and 110 with `Y`; this must not be aggregated into
class evidence.

## Official relationship findings

- The current award service has 23 documented operations and none exposes
  `prdctIdntNo`. Award rows identify an opening/winner with `bidNtceNo`,
  `bidNtceOrd`, `bidClsfcNo`, `rbidNo`, and `bidwinnrBizno`.
- The current bid service has 25 documented operations and none exposes
  `prdctIdntNo`. Goods purchase-target rows use the line key
  `bidNtceNo + bidNtceOrd + bidClsfcNo + prdctSno`, but contain only class,
  detailed class, specification, quantity, and price fields.
- Contract headers can be searched by `ntceNo` and link to details through
  `untyCntrctNo`. Goods contract detail operation
  `getCntrctInfoListThngDetail` exposes `prdctIdntNo`.
- Contract detail does not expose the bid line key (`bidClsfcNo`, `prdctSno`)
  or award key (`rbidNo`, winner). A contract can have multiple detail items,
  and one award can produce multiple contracts. Notice/class/name equality is
  not an item-level award join.
- Catalog operation
  `getThngPrdnmLocplcAccotListInfoInfoPrdlstSearch02` accepts
  `prdctIdntNo` and returns its `cmpntYn`, `dltYn`, and `useYn`.

The current 240 awards cannot be assigned an exact product identity from the
available award/bid responses. In the local data, 227 have contract-header
candidates matching notice and winner business number, but 34 of those map to
2--4 contracts. Even a unique contract header is not proof of a unique detail
line. These are candidates for future enrichment, not classification links.

## Storage and Search

`catalog_item_category` stores exact item evidence keyed by `prdctIdntNo`.
`award_catalog_item_link` stores only a verified one-award-to-one-item link. Search
joins these two tables, so its category always comes from that item's `cmpntYn`.
The older `detailed_product_category` table from migration 10 remains in place
for non-destructive compatibility, but Search and the core classifier do not
read it. No class consensus or manual class override may classify awards.

Search keeps `all | product | part`. Until a durable award-to-item relation is
available, existing awards remain in `all` and are excluded from both
classified tabs. A future classified tab must join through an exact item link
and then `catalog_item_category`; it must never join category by
`dtilPrdctClsfcNo`.

## Fields to preserve in future collectors

- Bid notice: `bidNtceNo`, `bidNtceOrd`, `prcrmntReqNo`.
- Bid item: `bidNtceNo`, `bidNtceOrd`, `bidClsfcNo`, `prdctSno`,
  `prdctClsfcNo`, `dtilPrdctClsfcNo`, specification, quantity, and unit price.
- Award: `bidNtceNo`, `bidNtceOrd`, `bidClsfcNo`, `rbidNo`,
  `bidwinnrBizno` and the complete source row.
- Contract header: `untyCntrctNo`, `dcsnCntrctNo`, `cntrctRefNo`, `ntceNo`,
  `reqNo`, and the unmodified `corpList`/`dminsttList` payloads.
- Contract detail: `untyCntrctNo`, `dcsnCntrctNo`, `prdctIdntNo`,
  `prdctClsfcNo`, `krnPrdctNm`, price/quantity fields, registration/change
  timestamps, and a source-row fingerprint because no line sequence exists.
- Catalog item: `prdctIdntNo`, `dtilPrdctClsfcNo`, `cmpntYn`, `dltYn`,
  `useYn`, `rgstDt`, and `chgDt`.

If PPS later exposes a common official line identifier across bid, award, and
contract detail, preserve it verbatim and use it as the award-item link. Until
then, ambiguous and missing links remain unclassified.

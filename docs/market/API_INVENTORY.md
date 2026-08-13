# KONEPS OpenAPI inventory

## 1. Scope and evidence

Status labels:

- **CONFIRMED**: stated in one of the three official DOCX files under `assets/doc/`.
- **INFERRED**: a design interpretation based on confirmed fields.
- **NEEDS API VERIFICATION**: must be checked with a minimal live call in a later phase.

Sources analyzed directly:

1. `조달청_OpenAPI참고자료_나라장터_입찰공고정보서비스_1.2.docx`
2. `조달청_OpenAPI참고자료_나라장터_낙찰정보서비스_1.1.docx`
3. `조달청_OpenAPI참고자료_나라장터_계약정보서비스_1.0.docx`

The documents specify field name, Korean label, maximum size, cardinality, sample, and description. They do **not** provide a machine type such as SQL `INTEGER`; types below are semantic/storage recommendations and are marked **INFERRED**. A field with document cardinality `1` is required; `0` is optional; `0..n` is a repeated encoded list.

## 2. Services and approved operations

| Service | Base endpoint | Approved operation | Purpose |
|---|---|---|---|
| BidPublicInfoService | `https://apis.data.go.kr/1230000/ad/BidPublicInfoService` | `getBidPblancListInfoThngPPSSrch` | Search goods bid notices |
| BidPublicInfoService | same | `getBidPblancListInfoThngPurchsObjPrdct` | Purchase-target goods per notice |
| BidPublicInfoService | same | `getBidPblancListInfoThngBsisAmount` | Goods basis amount |
| ScsbidInfoService | `https://apis.data.go.kr/1230000/as/ScsbidInfoService` | `getOpengResultListInfoThngPPSSrch` | Goods opening-result summaries |
| ScsbidInfoService | same | `getOpengResultListInfoOpengCompt` | Opening-complete participant/rank rows |
| ScsbidInfoService | same | `getScsbidListSttusThngPPSSrch` | Goods final-award status |
| CntrctInfoService | `https://apis.data.go.kr/1230000/ao/CntrctInfoService` | `getCntrctInfoListThngPPSSrch` | Goods contract headers |
| CntrctInfoService | same | `getCntrctInfoListThngDetail` | Goods contract line details |

No service key is recorded here. A future implementation must read `KONEPS_SERVICE_KEY` from a local environment/configuration source excluded from Git.

## 3. Common envelope and paging

**CONFIRMED** for all eight approved operations:

| Direction | Field | Required | Meaning |
|---|---|---:|---|
| Request | `ServiceKey` | yes | Public Data Portal authentication key |
| Request | `pageNo` | yes | Page number |
| Request | `numOfRows` | yes | Results per page; document examples use 10 |
| Request | `type` | no | Set to `json` for JSON; examples also show XML |
| Response | `resultCode`, `resultMsg` | yes | Result code/message |
| Response | `pageNo`, `numOfRows`, `totalCount` | yes | Paging metadata |

The DOCX files state an average response time of 500 ms and 30 TPS, but do not state a maximum accepted `numOfRows` or explain the account UI's daily 1000-call quota. Both are **NEEDS API VERIFICATION**. Do not infer that the sample or returned value `999` is a supported maximum.

## 4. Approved operation specifications

### 4.1 `getBidPblancListInfoThngPPSSrch`

**CONFIRMED purpose:** search goods bid notices using notice-posted time or opening time plus optional institution, reference, region, industry, price, detailed-product and procurement-request filters.

Requests:

| Field | Required | Format / behavior |
|---|---:|---|
| `inqryDiv` | yes | `1` notice-posted datetime, `2` opening datetime |
| `inqryBgnDt`, `inqryEndDt` | conditional | `YYYYMMDDHHMM`; required for either date mode |
| `bidNtceNm`, `ntceInsttCd`, `ntceInsttNm` | no | Notice name; notice institution code/name |
| `dminsttCd`, `dminsttNm`, `refNo` | no | Demand institution code/name; reference number |
| `prtcptLmtRgnCd`, `prtcptLmtRgnNm` | no | Participation-region restriction |
| `indstrytyCd`, `indstrytyNm` | no | Industry code/name |
| `presmptPrceBgn`, `presmptPrceEnd` | no | Estimated-price range in KRW |
| `dtilPrdctClsfcNo` | no | 10-digit detailed product classification |
| `masYn`, `prcrmntReqNo`, `bidClseExcpYn`, `intrntnlDivCd` | no | MAS, procurement request, close exclusion, domestic/international filters |

Key response groups (all names are **CONFIRMED**):

- Identity/status: `bidNtceNo`(required), `bidNtceOrd`(required), `reNtceYn`, `rgstTyNm`(required), `ntceKindNm`, `untyNtceNo`, `befBidBbancNo`.
- Description/link: `bidNtceNm`(required), `refNo`, `bidNtceDtlUrl`, `bidNtceUrl`, `stdNtceDocUrl`, `ntceSpecDocUrl1..10`, `ntceSpecFileNm1..10`.
- Institutions: `ntceInsttCd`, `ntceInsttNm`, `dminsttCd`(required), `dminsttNm`(required), contact fields.
- Timeline: `bidNtceDt`, `bidBeginDt`, `bidClseDt`, `opengDt`, `rbidOpengDt`, `rgstDt`(required), `chgDt`, qualification/agreement/warranty deadlines.
- Procurement/method: `bidMethdNm`, `cntrctCnclsMthdNm`(required), `prearngPrceDcsnMthdNm`, `sucsfbidMthdCd`, `sucsfbidMthdNm`, `sucsfbidMthdAppStd`, joint-supply fields.
- Product: `dtilPrdctClsfcNo`, `dtilPrdctClsfcNoNm`, `prdctSpecNm`, `prdctQty`, `prdctUnit`, `prdctUprc`, `purchsObjPrdctList`, `prdctClsfcLmtYn`, `mnfctYn`.
- Amount/rate: `asignBdgtAmt`, `presmptPrce`, `VAT`, `indutyVAT`, `bidPrtcptFee`, `sucsfbidLwltRate`, `techAbltEvlRt`, `bidPrceEvlRt`.
- Other important links: `prcrmntReqNo`, `orderPlanUntyNo`, `bfSpecRgstNo`.

Natural key candidate: `(bidNtceNo, bidNtceOrd)` **INFERRED**. This operation lacks `bidClsfcNo`; classification-specific child APIs must not be forced into a 1:1 relationship.

### 4.2 `getBidPblancListInfoThngPurchsObjPrdct`

Requests: `inqryDiv` required (`1` notice-posted datetime, `2` notice number); `inqryBgnDt`/`inqryEndDt` (`YYYYMMDDHHMM`) required for mode 1; `bidNtceNo` and `bidNtceOrd` required for mode 2.

Response fields:

| Field(s) | Required | Semantic storage |
|---|---:|---|
| `bidNtceNo`, `bidNtceOrd`, `bidClsfcNo`, `prdctSno` | yes | TEXT identifiers |
| `dminsttCd`, `dminsttNm` | no | Institution code/name |
| `prdctClsfcNo`, `prdctClsfcNoNm` | no | 8-digit class and name |
| `dtilPrdctClsfcNo`, `dtilPrdctClsfcNoNm` | no | 10-digit detailed class and name |
| `prdctSpecNm`, `unit`, `dlvrPlce`, `dlvryCndtnNm` | no | TEXT |
| `qty` | no | decimal quantity; canonical decimal TEXT recommended |
| `uprc` | no | KRW integer stored as INTEGER after validation |
| `dlvrTmlmtDt`, `ntceNticeDt` | latter required | original TEXT plus normalized KST-local value |
| `dlvrDaynum` | no | INTEGER |

Natural key candidate: `(bidNtceNo, bidNtceOrd, bidClsfcNo, prdctSno)` **INFERRED**. Cardinality notice/classification to item is 1:N **CONFIRMED by the item sequence field**, although live multiplicity remains to verify.

### 4.3 `getBidPblancListInfoThngBsisAmount`

Requests: `inqryDiv` required (`1` input datetime, `2` notice number); `inqryBgnDt`/`inqryEndDt` (`YYYYMMDDHHMM`) conditional for mode 1; `bidNtceNo` conditional for mode 2.

Response identity: `bidNtceNo`, `bidNtceOrd`, `bidClsfcNo` (all required). Other fields: `bidNtceNm`, `bssamt`, `bssamtOpenDt`, `rsrvtnPrceRngBgnRate`, `rsrvtnPrceRngEndRate`, `evlBssAmt`, `dfcltydgrCfcnt`, expense/rate fields, `industSftyHelthMngcst`, `rtrfundNon`, `envCnsrvcst`, `scontrctPayprcePayGrntyFee`, `mrfnHealthInsrprm`, `npnInsrprm`, `rmrk1`, `rmrk2`, `usefulAmt`, `inptDt`(required).

Natural key candidate: `(bidNtceNo, bidNtceOrd, bidClsfcNo)` **INFERRED**. Monetary fields are validated decimal strings converted to SQLite INTEGER; rates remain canonical decimal TEXT (or scaled INTEGER after scale verification), never binary REAL.

### 4.4 `getOpengResultListInfoThngPPSSrch`

Requests: `inqryDiv` (`1` notice datetime, `2` opening datetime, `3` notice number); date range `YYYYMMDDHHMM` required for modes 1/2; `bidNtceNo` required for mode 3. Optional filters mirror the bid search: name, institutions, reference, region, industry, estimated-price range, detailed product, MAS, procurement request, international division.

Response fields: required `bidNtceNo`, `bidNtceOrd`, `bidClsfcNo`, `rbidNo`, `bidNtceNm`, `opengDt`, `opengCorpInfo`, `progrsDivCdNm`, `rsrvtnPrceFileExistnceYn`, `ntceInsttCd`; optional `prtcptCnum`, `inptDt`, `ntceInsttNm`, `dminsttCd`, `dminsttNm`, `opengRsltNtcCntnts`.

`opengCorpInfo` is a caret-delimited summary and may represent a single winner or a phrase such as “multiple expected winners”; it is not a reliable participant entity source. Preserve it verbatim and use the opening-complete operation for participant rows.

Natural key candidate: `(bidNtceNo, bidNtceOrd, bidClsfcNo, rbidNo)` **INFERRED**.

### 4.5 `getOpengResultListInfoOpengCompt`

This operation is queried by notice, not date: required `bidNtceNo`; optional `bidNtceOrd`, `bidClsfcNo`, `rbidNo`.

Response fields: required `opengRsltDivNm`, `bidNtceNo`, `bidNtceOrd`, `bidClsfcNo`, `rbidNo`, `prcbdrBizno`; optional `opengRank`, `prcbdrNm`, `prcbdrCeoNm`, `bidprcAmt`, `bidprcrt`, `rmrk`, `cnsttyAccotBidAmtUrl`, `drwtNo1`, `drwtNo2`, `bidprcDt`, `bidPrceEvlVal`, `techEvlNaturVal`, `techEvlVal`, `totalEvlAmtVal`.

Natural key candidate: `(bidNtceNo, bidNtceOrd, bidClsfcNo, rbidNo, prcbdrBizno, opengRank)` **INFERRED**. The document sample has multiple companies for one opening, confirming 1:N. Because a company may conceivably submit/revise more than once, uniqueness must be checked against live data before migration.

### 4.6 `getScsbidListSttusThngPPSSrch`

Requests: `inqryDiv` (`1` notice-posted datetime, `2` opening datetime, `3` notice number); conditional date range or notice number; optional filters parallel the opening search.

Response fields: required `bidNtceNo`, `bidNtceOrd`, `bidClsfcNo`, `rbidNo`, `ntceDivCd`, `bidNtceNm`, `bidwinnrNm`, `bidwinnrBizno`, `rgstDt`; optional `prtcptCnum`, `bidwinnrCeoNm`, `bidwinnrAdrs`, `bidwinnrTelNo`, `sucsfbidAmt`, `sucsfbidRate`, `rlOpengDt`, `dminsttCd`, `dminsttNm`, `fnlSucsfDate`, `fnlSucsfCorpOfcl`.

Natural key candidate: `(bidNtceNo, bidNtceOrd, bidClsfcNo, rbidNo, bidwinnrBizno)` **INFERRED**. Do not assume exactly one winner; the document's wording and other operation behavior allow multiple-award scenarios.

### 4.7 `getCntrctInfoListThngPPSSrch`

Requests: `inqryDiv` required (`1` contract date, `2` confirmed contract number, `3` request number, `4` notice number). Mode 1 uses `inqryBgnDate`/`inqryEndDate` in `YYYYMMDD`; other modes conditionally require `dcsnCntrctNo`, `reqNo`, or `ntceNo`. Optional mode-1 filters: `insttDivCd`, `insttClsfcCd`, `insttCd`, `insttNm`, `prdctClsfcNoNm`, `cntrctMthdCd`, `cntrctRefNo`, `cntrctDivCd`.

Response groups:

- Identity/link: `untyCntrctNo`(required), `dcsnCntrctNo`, `cntrctRefNo`, `reqNo`, `ntceNo`.
- Contract: `bsnsDivNm`(required), `cntrctNm`, `cmmnCntrctYn`, `lngtrmCtnuDivNm`, `cntrctCnclsDate`, `cntrctDate`, `cntrctPrd`, method/legal/payment fields.
- Amounts/rates: `totCntrctAmt`, `thtmCntrctAmt`, `grntymnyRate`, `dfrcmpnstRt`.
- Institution/contact: `cntrctInsttCd`, `cntrctInsttNm`, jurisdiction/department/officer/contact fields.
- Repeated encoded lists: `dminsttList` (`0..n`) and `corpList` (`0..n`). These must be preserved raw and parsed into child tables.
- URLs: `cntrctInfoUrl`, `cntrctDtlInfoUrl`.
- Classification: `pubPrcrmntLrgclsfcNm`, `pubPrcrmntMidclsfcNm`, `pubPrcrmntClsfcNo`, `pubPrcrmntClsfcNm` (the example XML varies capitalization; verify actual JSON keys).
- Change: `rgstDt`(required), `chgDt`.

Natural key: `untyCntrctNo` **CONFIRMED by the document description** as the contract-status identifier. One contract has 0..N demand organizations and 0..N companies.

### 4.8 `getCntrctInfoListThngDetail`

Requests: `inqryDiv` (`1` registration datetime, `2` integrated contract number); conditional `inqryBgnDt`/`inqryEndDt` (`YYYYMMDDHHMM`) or `untyCntrctNo`.

Response fields: `cntrctCnclsDate`, `untyCntrctNo`(required), `dcsnCntrctNo`, `cntrctRefNo`, `prdctClsfcNo`, `prdctIdntNo`, `prdctClsfcNoNm`(required), `krnPrdctNm`, `orgplceCd`, `orgplceNm`, `qtyUprcAmt`, `prdctQty`, `prdctAmt`, `dlvryCndtnCd`, `dlvryCndtnNm`, `dlvrDaynum`, `dlvrTmlmt`, `rgstDt`(required), `chgDt`.

The sample returns multiple detail rows for one `untyCntrctNo`. Candidate natural key `(untyCntrctNo, prdctIdntNo, prdctClsfcNo, krnPrdctNm, qtyUprcAmt, prdctQty)` is only **INFERRED** because the API exposes no explicit line sequence. Introduce a source-item fingerprint and verify collisions before enforcing uniqueness.

## 5. Incremental-query matrix

| Operation | Date basis | Request fields | Precision | Direct checkpoint suitability |
|---|---|---|---|---|
| bid notice PPS search | notice-posted or opening datetime | `inqryDiv`, `inqryBgnDt`, `inqryEndDt` | minute | yes, independently per selected basis |
| purchase-target product | notice-posted datetime | same | minute | yes |
| basis amount | input datetime | same | minute | yes |
| opening result PPS search | notice or opening datetime | same | minute | yes |
| opening complete | none; notice identity only | notice/classification/rebid keys | n/a | no standalone time checkpoint; fan-out from opening summaries |
| award PPS search | notice-posted or opening datetime | same | minute | yes |
| contract PPS search | contract-conclusion date | `inqryBgnDate`, `inqryEndDate` | day | yes, with day overlap |
| contract detail | registration datetime | `inqryBgnDt`, `inqryEndDt` | minute | yes; also fan-out by contract number |

## 6. Document operations outside current approval

### Bid service (25 documented; 3 approved)

Exact document list (`*` = currently approved):

`getBidPblancListInfoCnstwk`, `getBidPblancListInfoServc`, `getBidPblancListInfoFrgcpt`, `getBidPblancListInfoThng`, `getBidPblancListInfoThngBsisAmount`*, `getBidPblancListInfoCnstwkBsisAmount`, `getBidPblancListInfoServcBsisAmount`, `getBidPblancListInfoChgHstryThng`, `getBidPblancListInfoChgHstryCnstwk`, `getBidPblancListInfoChgHstryServc`, `getBidPblancListInfoCnstwkPPSSrch`, `getBidPblancListInfoServcPPSSrch`, `getBidPblancListInfoFrgcptPPSSrch`, `getBidPblancListInfoThngPPSSrch`*, `getBidPblancListInfoLicenseLimit`, `getBidPblancListInfoPrtcptPsblRgn`, `getBidPblancListInfoThngPurchsObjPrdct`*, `getBidPblancListInfoServcPurchsObjPrdct`, `getBidPblancListInfoFrgcptPurchsObjPrdct`, `getBidPblancListInfoEorderAtchFileInfo`, `getBidPblancListInfoEtc`, `getBidPblancListInfoEtcPPSSrch`, `getBidPblancListPPIFnlRfpIssAtchFileInfo`, `getBidPblancListBidPrceCalclAInfo`, `getBidPblancListEvaluationIndstrytyMfrcInfo`.

### Award/opening service (23 documented; 3 approved)

Exact document list (`*` = currently approved):

`getScsbidListSttusThng`, `getScsbidListSttusCnstwk`, `getScsbidListSttusServc`, `getScsbidListSttusFrgcpt`, `getOpengResultListInfoThng`, `getOpengResultListInfoCnstwk`, `getOpengResultListInfoServc`, `getOpengResultListInfoFrgcpt`, `getOpengResultListInfoThngPreparPcDetail`, `getOpengResultListInfoCnstwkPreparPcDetail`, `getOpengResultListInfoServcPreparPcDetail`, `getOpengResultListInfoFrgcptPreparPcDetail`, `getOpengResultListInfoOpengCompt`*, `getOpengResultListInfoFailing`, `getOpengResultListInfoRebid`, `getScsbidListSttusThngPPSSrch`*, `getScsbidListSttusCnstwkPPSSrch`, `getScsbidListSttusServcPPSSrch`, `getScsbidListSttusFrgcptPPSSrch`, `getOpengResultListInfoThngPPSSrch`*, `getOpengResultListInfoCnstwkPPSSrch`, `getOpengResultListInfoServcPPSSrch`, `getOpengResultListInfoFrgcptPPSSrch`.

### Contract service (21 documented; 2 approved)

Exact document list (`*` = currently approved):

`getCntrctInfoListThng`, `getCntrctInfoListThngDetail`*, `getCntrctInfoListThngPPSSrch`*, `getCntrctInfoListThngChgHstry`, `getCntrctInfoListThngDltHstry`, `getCntrctInfoListCnstwk`, `getCntrctInfoListCnstwkServcInfo`, `getCntrctInfoListCnstwkPPSSrch`, `getCntrctInfoListCnstwkChgHstry`, `getCntrctInfoListCnstwkDltHstry`, `getCntrctInfoListServc`, `getCntrctInfoListGnrlServcServcInfo`, `getCntrctInfoListTechServcServcInfo`, `getCntrctInfoListServcPPSSrch`, `getCntrctInfoListServcChgHstry`, `getCntrctInfoListServcDltHstry`, `getCntrctInfoListFrgcpt`, `getCntrctInfoListFrgcptDetail`, `getCntrctInfoListFrgcptPPSSrch`, `getCntrctInfoListFrgcptChgHstry`, `getCntrctInfoListFrgcptDltHstry`.

## 7. `recommended_future_operations`

| Priority | Operation | Reason | Approval status |
|---|---|---|---|
| P0 | `getBidPblancListInfoChgHstryThng` | Detect amended notice content reliably | documented, not confirmed approved |
| P0 | `getCntrctInfoListThngChgHstry` | Preserve contract revisions rather than overwrite silently | documented, not confirmed approved |
| P0 | `getCntrctInfoListThngDltHstry` | Apply evidence-based soft deletion | documented, not confirmed approved |
| P1 | `getOpengResultListInfoFailing` | Explicit failed-bid state and lifecycle completeness | documented, not confirmed approved |
| P1 | `getOpengResultListInfoRebid` | Explicit rebid lifecycle and fan-out seeds | documented, not confirmed approved |
| P2 | `getOpengResultListInfoThngPreparPcDetail` | Preliminary-price and award-rate analysis | documented, not confirmed approved |
| P2 | `getBidPblancListInfoLicenseLimit` / `...PrtcptPsblRgn` | Competition eligibility and regional analysis | documented, not confirmed approved |

These operations are not part of the current collector scope until approval is verified.

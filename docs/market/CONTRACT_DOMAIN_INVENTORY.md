# Contract domain inventory

조사 기준은 desktop runtime DB의 원본을 read-only로 조회한 결과다. 조사 시점의 schema는 v22이고 `contract_header` 685건, `contract_item` 1,109건, `contract_result` 653건, `contract_catalog_cache` 375건이다. 재현 명령은 `node tools/contract-domain-inventory.mjs <database>`다.

## Header raw

| 분류 | field | non-empty | canonical 정책 |
|---|---|---:|---|
| A | `dcsnCntrctNo`, `cntrctRefNo`, `untyCntrctNo`, `cntrctNm`, `cntrctCnclsDate`, `cntrctDate`, `rgstDt`, `cntrctCnclsMthdNm`, `bsnsDivNm`, `thtmCntrctAmt`, `totCntrctAmt`, `cntrctPrd`, `cntrctDtlInfoUrl`, `cntrctInfoUrl` | 대부분 100% (`cntrctPrd` 84.23%) | `contract_result` scalar. identity는 계속 `dcsnCntrctNo`다. 목록 금액은 `thtmCntrctAmt`; 총액 0도 canonical에는 0으로 보존한다. |
| A | `baseLawNm`, `baseDtls` | 100%, 40.88% | 법률/근거 scalar |
| A | `payDivNm`, `lngtrmCtnuDivNm`, `cmmnCntrctYn`, `grntymnyRate`, `dfrcmpnstRt` | 99.85~100% | 조건 scalar; raw 표현을 그대로 보존 |
| A | `cntrctInsttCd`, `cntrctInsttNm`, `cntrctInsttChrgDeptNm`, `cntrctInsttJrsdctnDivNm`, `cntrctInsttOfclNm`, `cntrctInsttOfclTelNo`, `cntrctInsttOfclFaxNo`, `crdtrNm` | 92.12~100% | 계약기관 scalar |
| A | `dminsttList` | 100% | `contract_demand_institution` child. 계약기관과 합치지 않음 |
| A | `corpList` | 100% | `contract_corporation` child |
| A | `infoBizYn`, `reqNo`, `ntceNo` | 100%, 20.15%, 61.90% | 분석/연결용 scalar |
| B | `chgDt` | 79.12% | raw-only. canonical의 관측/정규화 시각과 의미가 다르고 현재 검색 가치가 낮음 |
| D | `pubPrcrmntClsfcNo`, `pubPrcrmntClsfcNm`, `pubPrcrmntLrgClsfcNm`, `pubPrcrmntMidClsfcNm` | 0% | raw-only. 실제 값이 생기기 전까지 column을 만들지 않음 |

실제 `corpList`는 `[순번^역할^단독/공동^업체명^대표자^국가^지분율^표시명^추가값^사업자번호]`이며 JSON이 아니다. 지분율은 `100`, `0`, 빈 값이 모두 있으므로 0을 미제공으로 바꾸지 않는다. `dminsttList`는 `[순번^기관코드^기관명^기관구분^추가1^추가2^추가3]`이다. parser는 복수 레코드와 빈 trailing field를 보존한다.

## Detail raw

| 분류 | field | non-empty | canonical 정책 |
|---|---|---:|---|
| A | `prdctClsfcNo`, `prdctClsfcNoNm`, `prdctIdntNo`, `krnPrdctNm`, `prdctQty`, `qtyUprcAmt`, `prdctAmt` | 100% | 기존 `contract_item` 유지 |
| A | `dlvrDaynum`, `dlvrTmlmt`, `dlvryCndtnCd`, `dlvryCndtnNm` | 64.38%, 75.38%, 100%, 100% | 납품 canonical column |
| A | `orgplceCd`, `orgplceNm` | 59.60% | 원산지 canonical column |
| A | `rgstDt` | 100% | item 등록시각 |
| C | `untyCntrctNo`, `dcsnCntrctNo`, `cntrctRefNo`, `cntrctCnclsDate` | 100% | header/result와 중복이나 item 연결·원본 증거를 위해 기존 column/raw 유지 |
| B | `chgDt` | 82.42% | raw-only |

현재 detail raw에는 별도 규격 field가 없고 `krnPrdctNm`에 모델/규격 성격의 문자열이 함께 들어온다. 이를 임의 분해하지 않는다. Catalog 연결은 물품식별번호를 기준으로 하되 `mnfctCorpNm`은 “catalog 등록 제조사”이며 계약업체로 간주하지 않는다.

## Search/UI source audit

기존 Contract 목록은 Award 공통 7열을 재사용하여 `개찰일/공고명/낙찰업체/낙찰금액/낙찰률/참가업체 수/수요기관`이라는 잘못된 header를 표시했고 업체·계약방법이 비었다. backend도 `dminsttNm` top-level alias와 JSON `corpList`만 기대했다. v23의 canonical source는 `contract_result` scalar, `contract_corporation`, `contract_demand_institution`, `contract_item`이며 raw alias 탐색은 과거 DB 호환 fallback으로만 둔다.

import type { AwardSearchParams, BidBasisAmountIdentityParams, BidEnrichmentIdentityParams, BidItemIdentityParams, BidNoticeSearchParams, CatalogItemSearchParams, ContractDetailParams, ContractSearchParams, DetailedProductClassificationSearchParams, LifecycleIntegratedParams, OpeningIdentityParams, KonepsOperation, KonepsService } from "./types.js";

export const KONEPS_SERVICE_ENDPOINTS: Readonly<Record<KonepsService, string>> = {
  BidPublicInfoService: "https://apis.data.go.kr/1230000/ad/BidPublicInfoService",
  ScsbidInfoService: "https://apis.data.go.kr/1230000/as/ScsbidInfoService",
  CntrctInfoService: "https://apis.data.go.kr/1230000/ao/CntrctInfoService",
  ThngListInfoService02: "https://apis.data.go.kr/1230000/ao/ThngListInfoService02",
  CntrctProcssIntgOpenService: "https://apis.data.go.kr/1230000/ao/CntrctProcssIntgOpenService",
};

export const LIFECYCLE_INTEGRATED_OPERATION: KonepsOperation<LifecycleIntegratedParams> = {
  service: "CntrctProcssIntgOpenService",
  path: "getCntrctProcssIntgOpenThng",
  defaultResponseType: "json",
  validate(params) {
    if (params.inqryDiv !== "1") throw new Error("lifecycle notice lookup requires inqryDiv=1");
    requiredIdentifier(params.bidNtceNo, "bidNtceNo");
    if (params.bidNtceOrd !== undefined) requiredIdentifier(params.bidNtceOrd, "bidNtceOrd");
  },
};

const DATE_TIME_MINUTE = /^\d{12}$/;

export const BID_NOTICE_SEARCH_OPERATION: KonepsOperation<BidNoticeSearchParams> = {
  service: "BidPublicInfoService",
  path: "getBidPblancListInfoThngPPSSrch",
  defaultResponseType: "json",
  validate(params) {
    if (!DATE_TIME_MINUTE.test(params.inqryBgnDt) || !DATE_TIME_MINUTE.test(params.inqryEndDt)) {
      throw new Error("inqryBgnDt and inqryEndDt must use YYYYMMDDHHMM strings");
    }
  },
};

function requiredIdentifier(value: string, field: string): void {
  if (!value || /[&#?\s]/u.test(value)) throw new Error(`${field} must be a non-empty identifier without query separators`);
}

export const BID_ITEM_OPERATION: KonepsOperation<BidItemIdentityParams> = {
  service: "BidPublicInfoService",
  path: "getBidPblancListInfoThngPurchsObjPrdct",
  defaultResponseType: "json",
  validate(params) {
    if (params.inqryDiv !== "2") throw new Error("bid item identity verification requires inqryDiv=2");
    requiredIdentifier(params.bidNtceNo, "bidNtceNo");
    requiredIdentifier(params.bidNtceOrd, "bidNtceOrd");
  },
};

export const BID_BASIS_AMOUNT_OPERATION: KonepsOperation<BidBasisAmountIdentityParams> = {
  service: "BidPublicInfoService",
  path: "getBidPblancListInfoThngBsisAmount",
  defaultResponseType: "json",
  validate(params) {
    if (params.inqryDiv !== "2") throw new Error("basis amount identity verification requires inqryDiv=2");
    requiredIdentifier(params.bidNtceNo, "bidNtceNo");
  },
};

const DETAILED_PRODUCT_CLASSIFICATION_NO = /^\d{10}$/;

export const AWARD_SEARCH_OPERATION: KonepsOperation<AwardSearchParams> = {
  service: "ScsbidInfoService",
  path: "getScsbidListSttusThngPPSSrch",
  defaultResponseType: "json",
  validate(params) {
    if (params.inqryDiv === "3") {
      requiredIdentifier(params.bidNtceNo ?? "", "bidNtceNo");
    } else if (!params.inqryBgnDt || !params.inqryEndDt || !DATE_TIME_MINUTE.test(params.inqryBgnDt) || !DATE_TIME_MINUTE.test(params.inqryEndDt)) {
      throw new Error("award date search requires inqryBgnDt and inqryEndDt as YYYYMMDDHHMM");
    }
    if (params.dtilPrdctClsfcNo !== undefined && !DETAILED_PRODUCT_CLASSIFICATION_NO.test(params.dtilPrdctClsfcNo)) {
      throw new Error("dtilPrdctClsfcNo must be a 10-digit detailed product classification number");
    }
  },
};

const DATE = /^\d{8}$/;
export const CONTRACT_SEARCH_OPERATION: KonepsOperation<ContractSearchParams> = {
  service: "CntrctInfoService",
  path: "getCntrctInfoListThngPPSSrch",
  defaultResponseType: "json",
  validate(params) {
    if (params.inqryDiv !== "1" || !DATE.test(params.inqryBgnDate) || !DATE.test(params.inqryEndDate)) {
      throw new Error("contract date search requires inqryDiv=1 and YYYYMMDD dates");
    }
    if (!params.prdctClsfcNoNm.trim()) throw new Error("prdctClsfcNoNm is required");
  },
};

function openingOperation(path:string):KonepsOperation<OpeningIdentityParams>{return{service:"ScsbidInfoService",path,defaultResponseType:"json",validate(params){requiredIdentifier(params.bidNtceNo,"bidNtceNo");requiredIdentifier(params.bidNtceOrd,"bidNtceOrd");requiredIdentifier(params.bidClsfcNo,"bidClsfcNo");requiredIdentifier(params.rbidNo,"rbidNo");}};}
export const OPENING_PARTICIPANT_OPERATION=openingOperation("getOpengResultListInfoOpengCompt");
export const OPENING_PRELIMINARY_PRICE_OPERATION=openingOperation("getOpengResultListInfoThngPreparPcDetail");
export const OPENING_FAILURE_OPERATION=openingOperation("getOpengResultListInfoFailing");
export const OPENING_REBID_OPERATION=openingOperation("getOpengResultListInfoRebid");
export const OPENING_ENRICHMENT_OPERATIONS=[OPENING_PARTICIPANT_OPERATION,OPENING_PRELIMINARY_PRICE_OPERATION,OPENING_FAILURE_OPERATION,OPENING_REBID_OPERATION] as const;

function bidEnrichmentOperation(path:string):KonepsOperation<BidEnrichmentIdentityParams>{return{service:"BidPublicInfoService",path,defaultResponseType:"json",validate(params){if(params.inqryDiv!=="2")throw new Error("bid enrichment identity lookup requires inqryDiv=2");requiredIdentifier(params.bidNtceNo,"bidNtceNo");requiredIdentifier(params.bidNtceOrd,"bidNtceOrd");}};}
export const BID_LICENSE_LIMIT_OPERATION=bidEnrichmentOperation("getBidPblancListInfoLicenseLimit");
export const BID_PARTICIPATION_REGION_OPERATION=bidEnrichmentOperation("getBidPblancListInfoPrtcptPsblRgn");
export const BID_NOTICE_CHANGE_OPERATION=bidEnrichmentOperation("getBidPblancListInfoChgHstryThng");
export const BID_EORDER_ATTACHMENT_OPERATION=bidEnrichmentOperation("getBidPblancListInfoEorderAtchFileInfo");
export const BID_ENRICHMENT_OPERATIONS=[BID_LICENSE_LIMIT_OPERATION,BID_PARTICIPATION_REGION_OPERATION,BID_NOTICE_CHANGE_OPERATION,BID_EORDER_ATTACHMENT_OPERATION] as const;

export const CONTRACT_DETAIL_OPERATION: KonepsOperation<ContractDetailParams> = {
  service: "CntrctInfoService",
  path: "getCntrctInfoListThngDetail",
  defaultResponseType: "json",
  validate(params) {
    if (params.inqryDiv !== "2") throw new Error("contract detail lookup requires inqryDiv=2");
    requiredIdentifier(params.untyCntrctNo, "untyCntrctNo");
  },
};

export const DETAILED_PRODUCT_CLASSIFICATION_SEARCH_OPERATION: KonepsOperation<DetailedProductClassificationSearchParams> = {
  service: "ThngListInfoService02",
  path: "getPrdctClsfcNoUnit10Info02",
  defaultResponseType: "json",
  validate(params) {
    for (const [field, value] of [
      ["dtilPrdctClsfcNoBgnNo", params.dtilPrdctClsfcNoBgnNo],
      ["dtilPrdctClsfcNoEndNo", params.dtilPrdctClsfcNoEndNo],
    ] as const) {
      if (value !== undefined && !DETAILED_PRODUCT_CLASSIFICATION_NO.test(value)) {
        throw new Error(`${field} must be a 10-digit detailed product classification number`);
      }
    }
    if (
      params.dtilPrdctClsfcNoBgnNo !== undefined
      && params.dtilPrdctClsfcNoEndNo !== undefined
      && params.dtilPrdctClsfcNoBgnNo > params.dtilPrdctClsfcNoEndNo
    ) {
      throw new Error("dtilPrdctClsfcNoBgnNo must not exceed dtilPrdctClsfcNoEndNo");
    }
  },
};

/** Official catalog-item lookup; intentionally not attached to a collector flow. */
export const CATALOG_ITEM_SEARCH_OPERATION: KonepsOperation<CatalogItemSearchParams> = {
  service: "ThngListInfoService02",
  path: "getThngPrdnmLocplcAccotListInfoInfoPrdlstSearch02",
  defaultResponseType: "json",
  validate(params) {
    const supplied = [params.dtilPrdctClsfcNo, params.prdctIdntNo, params.prdctClsfcNoEngNm,
      params.prdctClsfcNoNm, params.krnPrdctNm, params.inqryBgnDt, params.inqryEndDt,
      params.chgPrdBgnDt, params.chgPrdEndDt].some((value) => value !== undefined && value.trim() !== "");
    if (!supplied) throw new Error("catalog item search requires at least one documented search field");
    if (params.dtilPrdctClsfcNo !== undefined && !DETAILED_PRODUCT_CLASSIFICATION_NO.test(params.dtilPrdctClsfcNo)) {
      throw new Error("dtilPrdctClsfcNo must be a 10-digit detailed product classification number");
    }
    if (params.prdctIdntNo !== undefined && !/^\d{8}$/u.test(params.prdctIdntNo)) {
      throw new Error("prdctIdntNo must be an 8-digit product identification number");
    }
  },
};

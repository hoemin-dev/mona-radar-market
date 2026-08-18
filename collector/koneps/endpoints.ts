import type { BidBasisAmountIdentityParams, BidItemIdentityParams, BidNoticeSearchParams, DetailedProductClassificationSearchParams, KonepsOperation, KonepsService } from "./types.js";

export const KONEPS_SERVICE_ENDPOINTS: Readonly<Record<KonepsService, string>> = {
  BidPublicInfoService: "https://apis.data.go.kr/1230000/ad/BidPublicInfoService",
  ScsbidInfoService: "https://apis.data.go.kr/1230000/as/ScsbidInfoService",
  CntrctInfoService: "https://apis.data.go.kr/1230000/ao/CntrctInfoService",
  ThngListInfoService02: "https://apis.data.go.kr/1230000/ao/ThngListInfoService02",
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

import type { BidNoticeSearchParams, KonepsOperation, KonepsService } from "./types.js";

export const KONEPS_SERVICE_ENDPOINTS: Readonly<Record<KonepsService, string>> = {
  BidPublicInfoService: "https://apis.data.go.kr/1230000/ad/BidPublicInfoService",
  ScsbidInfoService: "https://apis.data.go.kr/1230000/as/ScsbidInfoService",
  CntrctInfoService: "https://apis.data.go.kr/1230000/ao/CntrctInfoService",
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

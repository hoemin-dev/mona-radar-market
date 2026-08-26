export type KonepsService =
  | "BidPublicInfoService"
  | "ScsbidInfoService"
  | "CntrctInfoService"
  | "CntrctProcssIntgOpenService"
  | "ThngListInfoService02";

export interface KonepsOperation<TParams extends KonepsRequestParams = KonepsRequestParams> {
  readonly service: KonepsService;
  readonly path: string;
  readonly defaultResponseType?: "json";
  readonly validate?: (params: TParams) => void;
}

export interface KonepsRequestParams {
  readonly pageNo: number;
  readonly numOfRows: number;
  readonly type?: "json";
  readonly [name: string]: string | number | boolean | undefined;
}

export interface BidNoticeSearchParams extends KonepsRequestParams {
  readonly inqryDiv: "1" | "2";
  readonly inqryBgnDt: string;
  readonly inqryEndDt: string;
  readonly bidNtceNm?: string;
  readonly ntceInsttCd?: string;
  readonly dminsttCd?: string;
  readonly dtilPrdctClsfcNo?: string;
}

export interface BidItemIdentityParams extends KonepsRequestParams {
  readonly inqryDiv: "2";
  readonly bidNtceNo: string;
  readonly bidNtceOrd: string;
}

export interface BidBasisAmountIdentityParams extends KonepsRequestParams {
  readonly inqryDiv: "2";
  readonly bidNtceNo: string;
}

export interface DetailedProductClassificationSearchParams extends KonepsRequestParams {
  readonly dtilPrdctClsfcNoBgnNo?: string;
  readonly dtilPrdctClsfcNoEndNo?: string;
  readonly dtilPrdctClsfcNoNm?: string;
  readonly dtilPrdctClsfcNoEngNm?: string;
}

export interface CatalogItemSearchParams extends KonepsRequestParams {
  readonly dtilPrdctClsfcNo?: string;
  readonly prdctIdntNo?: string;
  readonly prdctClsfcNoEngNm?: string;
  readonly prdctClsfcNoNm?: string;
  readonly krnPrdctNm?: string;
  readonly inqryBgnDt?: string;
  readonly inqryEndDt?: string;
  readonly chgPrdBgnDt?: string;
  readonly chgPrdEndDt?: string;
}

export interface AwardSearchParams extends KonepsRequestParams {
  readonly inqryDiv: "1" | "2" | "3";
  readonly inqryBgnDt?: string;
  readonly inqryEndDt?: string;
  readonly bidNtceNo?: string;
  readonly dtilPrdctClsfcNo?: string;
}

export interface ContractSearchParams extends KonepsRequestParams {
  readonly inqryDiv: "1";
  readonly inqryBgnDate: string;
  readonly inqryEndDate: string;
  readonly prdctClsfcNoNm: string;
}

export interface OpeningIdentityParams extends KonepsRequestParams {
  readonly bidNtceNo: string;
  readonly bidNtceOrd: string;
  readonly bidClsfcNo: string;
  readonly rbidNo: string;
}

export interface ContractDetailParams extends KonepsRequestParams {
  readonly inqryDiv: "2";
  readonly untyCntrctNo: string;
}

export interface LifecycleIntegratedParams extends KonepsRequestParams {
  readonly inqryDiv: "1";
  readonly bidNtceNo: string;
  readonly bidNtceOrd?: string;
}

export interface KonepsEnvelope {
  readonly resultCode: string;
  readonly resultMsg: string;
  readonly pageNo?: number;
  readonly numOfRows?: number;
  readonly totalCount?: number;
}

export type KonepsErrorCategory =
  | "configuration"
  | "network"
  | "timeout"
  | "http"
  | "api"
  | "parse"
  | "structure";

export interface KonepsCallMetadata {
  readonly service: KonepsService;
  readonly operation: string;
  readonly redactedUrl: string;
  readonly pageNo: number;
  readonly numOfRows: number;
  readonly httpStatus?: number;
  readonly resultCode?: string;
  readonly resultMsg?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly attemptCount: number;
  readonly retryCount: number;
}

export interface KonepsResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyBytes: Uint8Array;
  readonly bodyText: string;
  readonly parsedJson: unknown;
  readonly envelope: KonepsEnvelope;
  readonly receivedAt: string;
  readonly durationMs: number;
  readonly metadata: KonepsCallMetadata;
}

export type KonepsFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

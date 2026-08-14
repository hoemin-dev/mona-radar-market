import { createHash } from "node:crypto";
import { stableStringify } from "../storage/raw-persistence.js";

export const BID_NOTICE_SERVICE = "BidPublicInfoService";
export const BID_NOTICE_OPERATION = "getBidPblancListInfoThngPPSSrch";

export interface ParseWarning {
  readonly field: string;
  readonly code: "invalid_type" | "invalid_datetime" | "invalid_integer" | "unexpected_flag";
}

export interface NormalizedBidNotice {
  readonly bidNtceNo: string;
  readonly bidNtceOrd: string;
  readonly bidNtceName: string | null;
  readonly noticeKindName: string | null;
  readonly registrationTypeName: string | null;
  readonly referenceNo: string | null;
  readonly noticeInstitutionCode: string | null;
  readonly noticeInstitutionName: string | null;
  readonly demandInstitutionCode: string | null;
  readonly demandInstitutionName: string | null;
  readonly contractMethodName: string | null;
  readonly bidMethodName: string | null;
  readonly awardMethodCode: string | null;
  readonly awardMethodName: string | null;
  readonly noticePostedRaw: string | null;
  readonly noticePostedLocal: string | null;
  readonly bidBeginRaw: string | null;
  readonly bidBeginLocal: string | null;
  readonly bidCloseRaw: string | null;
  readonly bidCloseLocal: string | null;
  readonly openingRaw: string | null;
  readonly openingLocal: string | null;
  readonly registeredRaw: string | null;
  readonly registeredLocal: string | null;
  readonly changedRaw: string | null;
  readonly changedLocal: string | null;
  readonly detailedProductClassNo: string | null;
  readonly detailedProductClassName: string | null;
  readonly productQuantity: string | null;
  readonly productUnit: string | null;
  readonly productUnitPrice: bigint | null;
  readonly productSpecification: string | null;
  readonly purchaseProductListRaw: string | null;
  readonly allocatedBudgetAmount: bigint | null;
  readonly estimatedPrice: bigint | null;
  readonly vatAmount: bigint | null;
  readonly industryVatAmount: bigint | null;
  readonly internationalBidYn: string | null;
  readonly reNoticeYn: string | null;
  readonly rebidPermittedYn: string | null;
  readonly manufactureYn: string | null;
  readonly designatedCompetitionYn: string | null;
  readonly productClassLimitYn: string | null;
  readonly noticeUrl: string | null;
  readonly noticeDetailUrl: string | null;
  readonly standardNoticeDocumentUrl: string | null;
}

export interface BidNoticeNormalizationResult {
  readonly candidate: NormalizedBidNotice;
  readonly warnings: readonly ParseWarning[];
  readonly semanticStateJson: string;
  readonly semanticRowHash: string;
}

function stringField(raw: Readonly<Record<string, unknown>>, field: string, warnings: ParseWarning[], required = false): string | null {
  const value = raw[field];
  if (typeof value !== "string") {
    if (required) throw new Error(`${field} must be a non-empty string`);
    if (value !== undefined && value !== null) warnings.push({ field, code: "invalid_type" });
    return null;
  }
  if (value === "") {
    if (required) throw new Error(`${field} must be a non-empty string`);
    return null;
  }
  return value;
}

function dateField(raw: Readonly<Record<string, unknown>>, field: string, warnings: ParseWarning[]): { raw: string | null; local: string | null } {
  const value = stringField(raw, field, warnings);
  if (value === null) return { raw: null, local: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(value);
  if (!match) {
    warnings.push({ field, code: "invalid_datetime" });
    return { raw: value, local: null };
  }
  const [, year, month, day, hour, minute, seconds = "00"] = match;
  const check = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(seconds)));
  const canonical = `${year}-${month}-${day}T${hour}:${minute}:${seconds}`;
  if (check.toISOString().slice(0, 19) !== `${year}-${month}-${day}T${hour}:${minute}:${seconds}`) {
    warnings.push({ field, code: "invalid_datetime" });
    return { raw: value, local: null };
  }
  return { raw: value, local: canonical };
}

function integerField(raw: Readonly<Record<string, unknown>>, field: string, warnings: ParseWarning[]): bigint | null {
  const value = stringField(raw, field, warnings);
  if (value === null) return null;
  if (!/^\d+$/u.test(value)) {
    warnings.push({ field, code: "invalid_integer" });
    return null;
  }
  const parsed = BigInt(value);
  if (parsed > 9_223_372_036_854_775_807n) {
    warnings.push({ field, code: "invalid_integer" });
    return null;
  }
  return parsed;
}

function flagField(raw: Readonly<Record<string, unknown>>, field: string, warnings: ParseWarning[]): string | null {
  const value = stringField(raw, field, warnings);
  if (value !== null && value !== "Y" && value !== "N") warnings.push({ field, code: "unexpected_flag" });
  return value;
}

function semanticJson(candidate: NormalizedBidNotice): string {
  return stableStringify(Object.fromEntries(Object.entries(candidate).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])));
}

export function normalizeBidNotice(raw: Readonly<Record<string, unknown>>): BidNoticeNormalizationResult {
  const warnings: ParseWarning[] = [];
  const noticePosted = dateField(raw, "bidNtceDt", warnings);
  const bidBegin = dateField(raw, "bidBeginDt", warnings);
  const bidClose = dateField(raw, "bidClseDt", warnings);
  const opening = dateField(raw, "opengDt", warnings);
  const registered = dateField(raw, "rgstDt", warnings);
  const changed = dateField(raw, "chgDt", warnings);
  const candidate: NormalizedBidNotice = {
    bidNtceNo: stringField(raw, "bidNtceNo", warnings, true)!,
    bidNtceOrd: stringField(raw, "bidNtceOrd", warnings, true)!,
    bidNtceName: stringField(raw, "bidNtceNm", warnings),
    noticeKindName: stringField(raw, "ntceKindNm", warnings),
    registrationTypeName: stringField(raw, "rgstTyNm", warnings),
    referenceNo: stringField(raw, "refNo", warnings),
    noticeInstitutionCode: stringField(raw, "ntceInsttCd", warnings),
    noticeInstitutionName: stringField(raw, "ntceInsttNm", warnings),
    demandInstitutionCode: stringField(raw, "dminsttCd", warnings),
    demandInstitutionName: stringField(raw, "dminsttNm", warnings),
    contractMethodName: stringField(raw, "cntrctCnclsMthdNm", warnings),
    bidMethodName: stringField(raw, "bidMethdNm", warnings),
    awardMethodCode: stringField(raw, "sucsfbidMthdCd", warnings),
    awardMethodName: stringField(raw, "sucsfbidMthdNm", warnings),
    noticePostedRaw: noticePosted.raw, noticePostedLocal: noticePosted.local,
    bidBeginRaw: bidBegin.raw, bidBeginLocal: bidBegin.local,
    bidCloseRaw: bidClose.raw, bidCloseLocal: bidClose.local,
    openingRaw: opening.raw, openingLocal: opening.local,
    registeredRaw: registered.raw, registeredLocal: registered.local,
    changedRaw: changed.raw, changedLocal: changed.local,
    detailedProductClassNo: stringField(raw, "dtilPrdctClsfcNo", warnings),
    detailedProductClassName: stringField(raw, "dtilPrdctClsfcNoNm", warnings),
    productQuantity: stringField(raw, "prdctQty", warnings),
    productUnit: stringField(raw, "prdctUnit", warnings),
    productUnitPrice: integerField(raw, "prdctUprc", warnings),
    productSpecification: stringField(raw, "prdctSpecNm", warnings),
    purchaseProductListRaw: stringField(raw, "purchsObjPrdctList", warnings),
    allocatedBudgetAmount: integerField(raw, "asignBdgtAmt", warnings),
    estimatedPrice: integerField(raw, "presmptPrce", warnings),
    vatAmount: integerField(raw, "VAT", warnings),
    industryVatAmount: integerField(raw, "indutyVAT", warnings),
    internationalBidYn: flagField(raw, "intrbidYn", warnings),
    reNoticeYn: flagField(raw, "reNtceYn", warnings),
    rebidPermittedYn: flagField(raw, "rbidPermsnYn", warnings),
    manufactureYn: flagField(raw, "mnfctYn", warnings),
    designatedCompetitionYn: flagField(raw, "dsgntCmptYn", warnings),
    productClassLimitYn: flagField(raw, "prdctClsfcLmtYn", warnings),
    noticeUrl: stringField(raw, "bidNtceUrl", warnings),
    noticeDetailUrl: stringField(raw, "bidNtceDtlUrl", warnings),
    standardNoticeDocumentUrl: stringField(raw, "stdNtceDocUrl", warnings),
  };
  const semanticStateJson = semanticJson(candidate);
  return {
    candidate,
    warnings,
    semanticStateJson,
    semanticRowHash: createHash("sha256").update(semanticStateJson).digest("hex"),
  };
}

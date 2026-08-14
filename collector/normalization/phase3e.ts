import { createHash } from "node:crypto";
import { stableStringify } from "../storage/raw-persistence.js";

export const BID_ITEM_OPERATION = "getBidPblancListInfoThngPurchsObjPrdct";
export const BID_BASIS_AMOUNT_OPERATION = "getBidPblancListInfoThngBsisAmount";
export const PHASE3E_SERVICE = "BidPublicInfoService";

export interface Phase3eWarning { readonly field: string; readonly code: "invalid_type" | "invalid_datetime" | "invalid_integer" | "invalid_decimal"; }

function text(raw: Readonly<Record<string, unknown>>, field: string, warnings: Phase3eWarning[], required = false): string | null {
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

function integer(raw: Readonly<Record<string, unknown>>, field: string, warnings: Phase3eWarning[]): bigint | null {
  const value = text(raw, field, warnings);
  if (value === null) return null;
  if (!/^\d+$/u.test(value)) { warnings.push({ field, code: "invalid_integer" }); return null; }
  const parsed = BigInt(value);
  if (parsed > 9_223_372_036_854_775_807n) { warnings.push({ field, code: "invalid_integer" }); return null; }
  return parsed;
}

function decimal(raw: Readonly<Record<string, unknown>>, field: string, warnings: Phase3eWarning[]): string | null {
  const value = text(raw, field, warnings);
  if (value === null) return null;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/u.exec(value);
  if (!match) { warnings.push({ field, code: "invalid_decimal" }); return null; }
  const integerPart = match[2]!.replace(/^0+(?=\d)/u, "");
  const fraction = (match[3] ?? "").replace(/0+$/u, "");
  const zero = integerPart === "0" && fraction === "";
  return `${zero || match[1] !== "-" ? "" : "-"}${integerPart}${fraction ? `.${fraction}` : ""}`;
}

function datetime(raw: Readonly<Record<string, unknown>>, field: string, warnings: Phase3eWarning[]): { raw: string | null; local: string | null } {
  const value = text(raw, field, warnings);
  if (value === null) return { raw: null, local: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(value);
  if (!match) { warnings.push({ field, code: "invalid_datetime" }); return { raw: value, local: null }; }
  const [, y, m, d, h, min, s = "00"] = match;
  const canonical = `${y}-${m}-${d}T${h}:${min}:${s}`;
  const check = new Date(Date.UTC(+y!, +m! - 1, +d!, +h!, +min!, +s));
  if (check.toISOString().slice(0, 19) !== canonical) { warnings.push({ field, code: "invalid_datetime" }); return { raw: value, local: null }; }
  return { raw: value, local: canonical };
}

function finish<T extends object>(candidate: T, warnings: readonly Phase3eWarning[]) {
  const semanticStateJson = stableStringify(Object.fromEntries(Object.entries(candidate).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])));
  return { candidate, warnings, semanticStateJson, semanticRowHash: createHash("sha256").update(semanticStateJson).digest("hex") };
}

export function normalizeBidItem(raw: Readonly<Record<string, unknown>>) {
  const warnings: Phase3eWarning[] = [];
  const deadline = datetime(raw, "dlvrTmlmtDt", warnings);
  const posted = datetime(raw, "ntceNticeDt", warnings);
  const candidate = {
    bidNtceNo: text(raw, "bidNtceNo", warnings, true)!, bidNtceOrd: text(raw, "bidNtceOrd", warnings, true)!,
    bidClsfcNo: text(raw, "bidClsfcNo", warnings, true)!, productSeq: text(raw, "prdctSno", warnings, true)!,
    demandInstitutionCode: text(raw, "dminsttCd", warnings), demandInstitutionName: text(raw, "dminsttNm", warnings),
    productClassNo: text(raw, "prdctClsfcNo", warnings), productClassName: text(raw, "prdctClsfcNoNm", warnings),
    detailedProductClassNo: text(raw, "dtilPrdctClsfcNo", warnings), detailedProductClassName: text(raw, "dtilPrdctClsfcNoNm", warnings),
    productSpecification: text(raw, "prdctSpecNm", warnings), quantity: text(raw, "qty", warnings), unit: text(raw, "unit", warnings),
    unitPrice: integer(raw, "uprc", warnings), deliveryDeadlineRaw: deadline.raw, deliveryDeadlineLocal: deadline.local,
    deliveryDayCount: text(raw, "dlvrDaynum", warnings), deliveryPlace: text(raw, "dlvrPlce", warnings),
    deliveryConditionName: text(raw, "dlvryCndtnNm", warnings), noticePostedRaw: posted.raw, noticePostedLocal: posted.local,
  };
  return finish(candidate, warnings);
}

export function normalizeBidBasisAmount(raw: Readonly<Record<string, unknown>>) {
  const warnings: Phase3eWarning[] = [];
  const opened = datetime(raw, "bssamtOpenDt", warnings); const input = datetime(raw, "inptDt", warnings);
  const candidate = {
    bidNtceNo: text(raw, "bidNtceNo", warnings, true)!, bidNtceOrd: text(raw, "bidNtceOrd", warnings, true)!,
    bidClsfcNo: text(raw, "bidClsfcNo", warnings, true)!, bidNtceName: text(raw, "bidNtceNm", warnings),
    basisAmount: integer(raw, "bssamt", warnings), basisAmountOpenRaw: opened.raw, basisAmountOpenLocal: opened.local,
    reservePriceRangeBeginRate: decimal(raw, "rsrvtnPrceRngBgnRate", warnings), reservePriceRangeEndRate: decimal(raw, "rsrvtnPrceRngEndRate", warnings),
    evaluationBasisAmount: integer(raw, "evlBssAmt", warnings), difficultyCoefficient: decimal(raw, "dfcltydgrCfcnt", warnings),
    otherGeneralExpenseBasisRate: decimal(raw, "etcGnrlexpnsBssRate", warnings), generalManagementCostBasisRate: decimal(raw, "gnrlMngcstBssRate", warnings),
    profitBasisRate: decimal(raw, "prftBssRate", warnings), laborCostBasisRate: decimal(raw, "lbrcstBssRate", warnings),
    industrialSafetyHealthManagementCost: integer(raw, "industSftyHelthMngcst", warnings), retirementMutualAid: integer(raw, "rtrfundNon", warnings),
    environmentalConservationCost: integer(raw, "envCnsrvcst", warnings), subcontractPaymentGuaranteeFee: integer(raw, "scontrctPayprcePayGrntyFee", warnings),
    healthInsurancePremium: integer(raw, "mrfnHealthInsrprm", warnings), nationalPensionPremium: integer(raw, "npnInsrprm", warnings),
    remark1: text(raw, "rmrk1", warnings), remark2: text(raw, "rmrk2", warnings), usefulAmount: integer(raw, "usefulAmt", warnings),
    inputRaw: input.raw, inputLocal: input.local,
  };
  return finish(candidate, warnings);
}

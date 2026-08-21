import { createHash } from "node:crypto";
import { stableStringify } from "../storage/raw-persistence.js";
export const CONTRACT_SERVICE="CntrctInfoService",CONTRACT_OPERATION="getCntrctInfoListThngPPSSrch";
const text=(raw:Readonly<Record<string,unknown>>,field:string)=>typeof raw[field]==="string"&&raw[field]!==""?raw[field] as string:null;
const amount=(raw:Readonly<Record<string,unknown>>,field:string)=>{const value=text(raw,field);return value&&/^\d+$/.test(value)&&BigInt(value)<=9_223_372_036_854_775_807n?BigInt(value):null;};
export function normalizeContract(raw:Readonly<Record<string,unknown>>){
  const decisionContractNo=text(raw,"dcsnCntrctNo")??text(raw,"cntrctNo");
  if(!decisionContractNo)throw new Error("dcsnCntrctNo must be a non-empty string");
  const candidate={decisionContractNo,contractNo:text(raw,"cntrctNo"),contractName:text(raw,"cntrctNm"),contractMethodName:text(raw,"cntrctCnclsMthdNm"),contractInstitutionName:text(raw,"cntrctInsttNm"),demandInstitutionName:text(raw,"dminsttNm"),contractAmount:amount(raw,"thtmCntrctAmt")??amount(raw,"totCntrctAmt"),contractDate:text(raw,"cntrctCnclsDate"),contractDetailUrl:text(raw,"cntrctDtlInfoUrl")};
  const semanticStateJson=stableStringify(Object.fromEntries(Object.entries(candidate).map(([key,value])=>[key,typeof value==="bigint"?value.toString():value])));
  return{candidate,semanticStateJson,semanticRowHash:createHash("sha256").update(semanticStateJson).digest("hex"),warnings:[]};
}

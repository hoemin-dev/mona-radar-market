import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const BID_ENRICHMENT_SERVICE = "BidPublicInfoService";
export type BidEnrichmentIdentity = { bidNtceNo: string; bidNtceOrd: string };

function text(raw: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) { const value=raw[key]; if(typeof value==="string"&&value.trim())return value.trim(); if(typeof value==="number"&&Number.isFinite(value))return String(value); }
  return null;
}
function required(raw:Record<string,unknown>,key:string):string{const value=text(raw,key);if(value===null)throw new Error(`BID_ENRICHMENT_NORMALIZATION_ERROR: missing ${key}`);return value;}
export function bidEnrichmentIdentity(raw:Record<string,unknown>):BidEnrichmentIdentity{return{bidNtceNo:required(raw,"bidNtceNo"),bidNtceOrd:required(raw,"bidNtceOrd")};}
function fingerprint(values:unknown[]):string{return createHash("sha256").update(JSON.stringify(values)).digest("hex");}

export function normalizeBidEnrichmentRawItem(db:DatabaseSync,rawItemId:number,operation:string,observedAt:string):void{
  const row=db.prepare("SELECT service,operation,canonical_json FROM api_raw_item WHERE raw_item_id=?").get(rawItemId)as{service:string;operation:string;canonical_json:string}|undefined;
  if(!row||row.service!==BID_ENRICHMENT_SERVICE||row.operation!==operation)throw new Error("RAW item is not from the requested bid enrichment endpoint");
  const raw=JSON.parse(row.canonical_json)as Record<string,unknown>,i=bidEnrichmentIdentity(raw),key=[i.bidNtceNo,i.bidNtceOrd];
  if(operation==="getBidPblancListInfoLicenseLimit"){
    const values=[text(raw,"lmtGrpNo"),text(raw,"lmtSno","lmtSeq"),text(raw,"lcnsLmtNm"),text(raw,"permsnIndstrytyList","permIndstrytyList","allowIndstrytyList"),text(raw,"rgstDt")],fp=fingerprint([...key,...values]);
    db.prepare(`INSERT INTO bid_license_limit(bid_ntce_no,bid_ntce_ord,limit_group_no,limit_sequence,license_limit_name,allowed_industry_list,registered_at,item_fingerprint,source_raw_item_id,observed_at)VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET source_raw_item_id=excluded.source_raw_item_id,observed_at=excluded.observed_at`).run(...key,...values,fp,rawItemId,observedAt);
  }else if(operation==="getBidPblancListInfoPrtcptPsblRgn"){
    const values=[text(raw,"lmtSno","lmtSeq"),text(raw,"prtcptPsblRgnNm"),text(raw,"rgstDt")],fp=fingerprint([...key,...values]);
    db.prepare(`INSERT INTO bid_participation_region(bid_ntce_no,bid_ntce_ord,limit_sequence,participation_region_name,registered_at,item_fingerprint,source_raw_item_id,observed_at)VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET source_raw_item_id=excluded.source_raw_item_id,observed_at=excluded.observed_at`).run(...key,...values,fp,rawItemId,observedAt);
  }else if(operation==="getBidPblancListInfoChgHstryThng"){
    const values=[text(raw,"bidClsfcNo"),text(raw,"rbidNo"),text(raw,"chgItemNm"),text(raw,"bfchgVal"),text(raw,"afchgVal"),text(raw,"chgDt","chgDtm","rgstDt")],identityJson=JSON.stringify({bidNtceNo:i.bidNtceNo,bidNtceOrd:i.bidNtceOrd,bidClsfcNo:values[0],rbidNo:values[1]}),fp=fingerprint([...key,...values]);
    db.prepare(`INSERT INTO bid_notice_change_event(bid_ntce_no,bid_ntce_ord,bid_clsfc_no,rbid_no,change_item_name,before_value,after_value,changed_at,source_identity_json,item_fingerprint,source_raw_item_id,observed_at)VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET source_raw_item_id=excluded.source_raw_item_id,observed_at=excluded.observed_at`).run(...key,...values,identityJson,fp,rawItemId,observedAt);
  }else if(operation==="getBidPblancListInfoEorderAtchFileInfo"){
    const values=[text(raw,"atchFileSno","atchSno"),text(raw,"eorderDocDivNm"),text(raw,"eorderAtchFileNm"),text(raw,"eorderAtchFileUrl")],fp=fingerprint([...key,...values]);
    db.prepare(`INSERT INTO bid_eorder_attachment(bid_ntce_no,bid_ntce_ord,attachment_sequence,document_type_name,file_name,file_url,item_fingerprint,source_raw_item_id,observed_at)VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET source_raw_item_id=excluded.source_raw_item_id,observed_at=excluded.observed_at`).run(...key,...values,fp,rawItemId,observedAt);
  }else throw new Error(`Unsupported bid enrichment operation: ${operation}`);
}

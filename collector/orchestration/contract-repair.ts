import type { DatabaseSync } from "node:sqlite";

const LEGACY = "4015155300";
const CURRENT = "4015155301";
export type ContractDuplicateClassification = "5301_ONLY_EVIDENCE"|"5300_ONLY_EVIDENCE"|"BOTH_TARGET_EVIDENCE"|"NO_TARGET_EVIDENCE"|"CONFLICT";
export interface ContractDuplicateAssessment {decisionContractNo:string;classification:ContractDuplicateClassification;deleteContractResultId:number|null;keepContractResultId:number|null;sourceRawItemId:number|null;contractName:string|null;contractAmount:number|null;contractDate:string|null;}

interface PairRow {decision_contract_no:string;legacy_id:number;current_id:number;legacy_raw:number;current_raw:number;legacy_hash:string;current_hash:string;legacy_name:string|null;current_name:string|null;legacy_amount:number|null;current_amount:number|null;legacy_date:string|null;current_date:string|null;legacy_count:number;current_count:number;}
const same=(left:unknown,right:unknown)=>left===right;

export function assessContractDuplicates(db:DatabaseSync):ContractDuplicateAssessment[]{
 const pairs=db.prepare(`SELECT decision_contract_no,
  max(CASE WHEN target_detailed_product_class_no=? THEN contract_result_id END) legacy_id,
  max(CASE WHEN target_detailed_product_class_no=? THEN contract_result_id END) current_id,
  max(CASE WHEN target_detailed_product_class_no=? THEN source_raw_item_id END) legacy_raw,
  max(CASE WHEN target_detailed_product_class_no=? THEN source_raw_item_id END) current_raw,
  max(CASE WHEN target_detailed_product_class_no=? THEN semantic_row_hash END) legacy_hash,
  max(CASE WHEN target_detailed_product_class_no=? THEN semantic_row_hash END) current_hash,
  max(CASE WHEN target_detailed_product_class_no=? THEN contract_name END) legacy_name,
  max(CASE WHEN target_detailed_product_class_no=? THEN contract_name END) current_name,
  max(CASE WHEN target_detailed_product_class_no=? THEN contract_amount END) legacy_amount,
  max(CASE WHEN target_detailed_product_class_no=? THEN contract_amount END) current_amount,
  max(CASE WHEN target_detailed_product_class_no=? THEN contract_date END) legacy_date,
  max(CASE WHEN target_detailed_product_class_no=? THEN contract_date END) current_date,
  sum(CASE WHEN target_detailed_product_class_no=? THEN 1 ELSE 0 END) legacy_count,
  sum(CASE WHEN target_detailed_product_class_no=? THEN 1 ELSE 0 END) current_count
  FROM contract_result WHERE target_detailed_product_class_no IN (?,?) GROUP BY decision_contract_no
  HAVING legacy_count>0 AND current_count>0 ORDER BY decision_contract_no`).all(LEGACY,CURRENT,LEGACY,CURRENT,LEGACY,CURRENT,LEGACY,CURRENT,LEGACY,CURRENT,LEGACY,CURRENT,LEGACY,CURRENT,LEGACY,CURRENT)as unknown as PairRow[];
 const evidence=db.prepare(`SELECT DISTINCT ci.target_detailed_product_class_no target FROM contract_header ch JOIN contract_item ci ON ci.contract_header_id=ch.contract_header_id
   WHERE ch.decision_contract_no=? AND ch.source_raw_item_id=? AND ci.resolution_status='RESOLVED_TARGET' AND ci.target_detailed_product_class_no IN (?,?) ORDER BY target`);
 return pairs.map(pair=>{
  const exact=pair.legacy_count===1&&pair.current_count===1&&pair.legacy_raw===pair.current_raw&&same(pair.legacy_hash,pair.current_hash)&&same(pair.legacy_name,pair.current_name)&&same(pair.legacy_amount,pair.current_amount)&&same(pair.legacy_date,pair.current_date);
  const base={decisionContractNo:pair.decision_contract_no,sourceRawItemId:pair.legacy_raw,contractName:pair.legacy_name,contractAmount:pair.legacy_amount,contractDate:pair.legacy_date};
  if(!exact)return{...base,classification:"CONFLICT" as const,deleteContractResultId:null,keepContractResultId:null};
  const targets=(evidence.all(pair.decision_contract_no,pair.legacy_raw,LEGACY,CURRENT)as{target:string}[]).map(row=>row.target),hasLegacy=targets.includes(LEGACY),hasCurrent=targets.includes(CURRENT);
  if(hasLegacy&&hasCurrent)return{...base,classification:"BOTH_TARGET_EVIDENCE" as const,deleteContractResultId:null,keepContractResultId:null};
  if(hasCurrent)return{...base,classification:"5301_ONLY_EVIDENCE" as const,deleteContractResultId:pair.legacy_id,keepContractResultId:pair.current_id};
  if(hasLegacy)return{...base,classification:"5300_ONLY_EVIDENCE" as const,deleteContractResultId:pair.current_id,keepContractResultId:pair.legacy_id};
  return{...base,classification:"NO_TARGET_EVIDENCE" as const,deleteContractResultId:null,keepContractResultId:null};
 });
}

export function summarizeContractDuplicateAssessments(rows:readonly ContractDuplicateAssessment[]){
 const classifications:ContractDuplicateClassification[]=["5301_ONLY_EVIDENCE","5300_ONLY_EVIDENCE","BOTH_TARGET_EVIDENCE","NO_TARGET_EVIDENCE","CONFLICT"],counts=Object.fromEntries(classifications.map(key=>[key,rows.filter(row=>row.classification===key).length]))as Record<ContractDuplicateClassification,number>;
 const autoRepairableRows=rows.filter(row=>row.deleteContractResultId!==null).length,unresolvedPairs=rows.length-autoRepairableRows;
 return{totalDuplicatePairs:rows.length,counts,autoRepairableRows,unresolvedPairs,preservedAmbiguousRows:unresolvedPairs*2,samples:Object.fromEntries(classifications.map(key=>[key,rows.filter(row=>row.classification===key).slice(0,3)]))};
}

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const DELETE_TABLES=["contract_item","contract_detail_state","contract_header","contract_catalog_cache","contract_result","contract_month_probe","contract_collection_target","contract_collection_job"]as const;
const PRESERVED_TABLES=["api_raw_item","bid_notice","award_result"]as const;
export interface ContractResetPlan {mode:"DRY_RUN";deleteRows:Record<(typeof DELETE_TABLES)[number],number>;contractCollectorCheckpoints:number;unlinkBidContractLinks:number;blockingProcurementGroupMembers:number;blockingProcurementRelations:number;preservedRows:Record<(typeof PRESERVED_TABLES)[number],number>;planToken:string;}
const count=(db:DatabaseSync,sql:string,...params:(string|number)[])=>Number((db.prepare(sql).get(...params)as{n:number}).n);

export function planContractReset(db:DatabaseSync):ContractResetPlan{
 const deleteRows={contract_item:count(db,"SELECT count(*) n FROM contract_item"),contract_detail_state:count(db,"SELECT count(*) n FROM contract_detail_state"),contract_header:count(db,"SELECT count(*) n FROM contract_header"),contract_catalog_cache:count(db,"SELECT count(*) n FROM contract_catalog_cache"),contract_result:count(db,"SELECT count(*) n FROM contract_result"),contract_month_probe:count(db,"SELECT count(*) n FROM contract_month_probe WHERE job_id IN (SELECT job_id FROM contract_collection_job WHERE status!='completed')"),contract_collection_target:count(db,"SELECT count(*) n FROM contract_collection_target WHERE job_id IN (SELECT job_id FROM contract_collection_job WHERE status!='completed')"),contract_collection_job:count(db,"SELECT count(*) n FROM contract_collection_job WHERE status!='completed'")} satisfies ContractResetPlan["deleteRows"];
 const preservedRows=Object.fromEntries(PRESERVED_TABLES.map(table=>[table,count(db,`SELECT count(*) n FROM ${table}`)]))as ContractResetPlan["preservedRows"];
 const values={deleteRows,contractCollectorCheckpoints:count(db,"SELECT count(*) n FROM collector_checkpoint WHERE service='CntrctInfoService'"),unlinkBidContractLinks:count(db,"SELECT count(*) n FROM bid_contract_link WHERE contract_result_id IS NOT NULL"),blockingProcurementGroupMembers:count(db,"SELECT count(*) n FROM procurement_group_member WHERE source_type='CONTRACT'"),blockingProcurementRelations:count(db,"SELECT count(*) n FROM procurement_relation WHERE from_type='CONTRACT' OR to_type='CONTRACT'"),preservedRows};
 return{mode:"DRY_RUN",...values,planToken:createHash("sha256").update(JSON.stringify(values)).digest("hex")};
}

function checkedDelete(db:DatabaseSync,table:(typeof DELETE_TABLES)[number],expected:number,where=""){const actual=Number(db.prepare(`DELETE FROM ${table}${where}`).run().changes);if(actual!==expected)throw new Error(`CONTRACT_RESET_COUNT_MISMATCH:${table}:expected=${expected}:actual=${actual}`);}
export function applyContractReset(db:DatabaseSync,expectedPlanToken:string){
 db.exec("BEGIN IMMEDIATE");
 try{
  const plan=planContractReset(db);if(plan.planToken!==expectedPlanToken)throw new Error(`CONTRACT_RESET_PLAN_CHANGED:expected=${expectedPlanToken}:actual=${plan.planToken}`);
  if(plan.blockingProcurementGroupMembers||plan.blockingProcurementRelations)throw new Error("CONTRACT_RESET_BLOCKED_BY_PROCUREMENT_GROUP_REFERENCES");
  const unlinked=Number(db.prepare("UPDATE bid_contract_link SET contract_result_id=NULL WHERE contract_result_id IS NOT NULL").run().changes);if(unlinked!==plan.unlinkBidContractLinks)throw new Error("CONTRACT_RESET_COUNT_MISMATCH:bid_contract_link");
  for(const table of DELETE_TABLES){const checkpointTable=table==="contract_month_probe"||table==="contract_collection_target",where=checkpointTable?" WHERE job_id IN (SELECT job_id FROM contract_collection_job WHERE status!='completed')":table==="contract_collection_job"?" WHERE status!='completed'":"";checkedDelete(db,table,plan.deleteRows[table],where);}
  const checkpoints=Number(db.prepare("DELETE FROM collector_checkpoint WHERE service='CntrctInfoService'").run().changes);if(checkpoints!==plan.contractCollectorCheckpoints)throw new Error("CONTRACT_RESET_COUNT_MISMATCH:collector_checkpoint");
  for(const table of PRESERVED_TABLES)if(count(db,`SELECT count(*) n FROM ${table}`)!==plan.preservedRows[table])throw new Error(`CONTRACT_RESET_PRESERVATION_FAILED:${table}`);
  const foreignKeys=db.prepare("PRAGMA foreign_key_check").all();if(foreignKeys.length)throw new Error(`CONTRACT_RESET_FOREIGN_KEY_CHECK_FAILED:${foreignKeys.length}`);
  db.exec("COMMIT");return{mode:"APPLIED" as const,planToken:plan.planToken,deletedRows:plan.deleteRows,deletedContractCollectorCheckpoints:checkpoints,unlinkedBidContractLinks:unlinked,preservedRows:plan.preservedRows};
 }catch(error){db.exec("ROLLBACK");throw error;}
}

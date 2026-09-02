import{randomUUID}from"node:crypto";import type{DatabaseSync}from"node:sqlite";import{kstNow}from"./planner.js";import{monthRange,nextMonth,type InitialTarget}from"./initial-state.js";
export{monthRange};export type ContractTarget=InitialTarget;
export function deriveContractTargets(targets:readonly ContractTarget[]):ContractTarget[]{
 const derived=new Map<string,ContractTarget>();
 for(const target of targets){
  if(!/^\d{10}$/.test(target.dtilPrdctClsfcNo))throw new Error("INVALID_CONTRACT_TARGET");
  const code=target.dtilPrdctClsfcNo.slice(0,8);
  if(!derived.has(code))derived.set(code,{dtilPrdctClsfcNo:code,dtilPrdctClsfcNoNm:target.dtilPrdctClsfcNoNm});
 }
 return [...derived.values()];
}
export type ContractAction = "fresh" | "resume";
export function parseContractAction(value: string = "resume"): ContractAction {
  if (value !== "fresh" && value !== "resume") throw new Error("INVALID_CONTRACT_ACTION");
  return value;
}
export function ensureContractJob(db:DatabaseSync,targets:readonly ContractTarget[],now:Date,action:ContractAction="resume"):string{
  parseContractAction(action);
  const contractTargets=deriveContractTargets(targets);
  const active=action==="resume"?db.prepare("SELECT job_id FROM contract_collection_job WHERE status IN ('running','paused') ORDER BY updated_at DESC, rowid DESC LIMIT 1").get()as{job_id:string}|undefined:undefined;
  if(!active&&!targets.length)throw new Error("CONTRACT_TARGET_REQUIRED");
  const id=active?.job_id??randomUUID(),at=now.toISOString();
  db.exec("SAVEPOINT ensure_contract_job");
  try{
    if(!active)db.prepare("INSERT INTO contract_collection_job(job_id,status,cutoff_at,created_at,updated_at)VALUES(?,'paused',?,?,?)").run(id,kstNow(now),at,at);
    for(const target of contractTargets)db.prepare("INSERT INTO contract_collection_target(job_id,dtil_prdct_clsfc_no,target_name,status,updated_at)VALUES(?,?,?,'pending',?) ON CONFLICT(job_id,dtil_prdct_clsfc_no)DO UPDATE SET target_name=excluded.target_name").run(id,target.dtilPrdctClsfcNo,target.dtilPrdctClsfcNoNm,at);
    db.exec("RELEASE ensure_contract_job");
  }catch(error){db.exec("ROLLBACK TO ensure_contract_job; RELEASE ensure_contract_job");throw error;}
  return id;
}
export function nextContractWork(db:DatabaseSync,id:string):{code:string;name:string;month:string;throughMonth:string|null}|undefined{db.prepare("UPDATE contract_collection_target SET status='paused' WHERE job_id=? AND status='running'").run(id);const target=db.prepare("SELECT dtil_prdct_clsfc_no code,target_name name,successful_through_month throughMonth FROM contract_collection_target WHERE job_id=? AND status!='completed' ORDER BY COALESCE(successful_through_month,''),dtil_prdct_clsfc_no LIMIT 1").get(id)as{code:string;name:string;throughMonth:string|null}|undefined;return target?{...target,month:target.throughMonth?nextMonth(target.throughMonth):"2004-07"}:undefined;}

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { kstNow } from "./planner.js";

export interface InitialTarget { readonly dtilPrdctClsfcNo:string; readonly dtilPrdctClsfcNoNm:string; }
export function monthRange(month:string,cutoff:string):{start:string;end:string}{
  if(!/^\d{4}-\d{2}$/u.test(month))throw new Error("INVALID_MONTH");
  const year=Number(month.slice(0,4)),number=Number(month.slice(5));if(number<1||number>12)throw new Error("INVALID_MONTH");
  const last=new Date(Date.UTC(year,number,0)).getUTCDate();
  const start=`${month}-01T00:00:00`,naturalEnd=`${month}-${String(last).padStart(2,"0")}T23:59:00`;
  const current=cutoff.slice(0,7);return {start,end:month===current?cutoff:naturalEnd};
}
export function nextMonth(month:string):string{const y=Number(month.slice(0,4)),m=Number(month.slice(5));return new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);}
export function ensureInitialJob(db:DatabaseSync,targets:readonly InitialTarget[],now:Date):string{
  for(const target of targets)if(!/^\d{10}$/u.test(target.dtilPrdctClsfcNo))throw new Error("INVALID_INITIAL_TARGET");
  const active=db.prepare("SELECT job_id FROM initial_collection_job WHERE status IN ('running','paused') ORDER BY updated_at DESC LIMIT 1").get() as {job_id:string}|undefined;
  if(!active&&!targets.length)throw new Error("INITIAL_TARGET_REQUIRED");
  const id=active?.job_id??randomUUID(),at=now.toISOString();
  if(!active)db.prepare("INSERT INTO initial_collection_job(job_id,status,cutoff_at,created_at,updated_at) VALUES(?,'paused',?,?,?)").run(id,kstNow(now),at,at);
  for(const target of targets)db.prepare("INSERT INTO initial_collection_target(job_id,dtil_prdct_clsfc_no,target_name,status,updated_at) VALUES(?,?,?,'pending',?) ON CONFLICT(job_id,dtil_prdct_clsfc_no) DO UPDATE SET target_name=excluded.target_name").run(id,target.dtilPrdctClsfcNo,target.dtilPrdctClsfcNoNm,at);
  return id;
}
export function nextInitialWork(db:DatabaseSync,id:string):{code:string;throughMonth:string|null;month:string}|undefined{
  db.prepare("UPDATE initial_collection_target SET status='paused' WHERE job_id=? AND status='running'").run(id);
  const target=db.prepare("SELECT dtil_prdct_clsfc_no code,successful_through_month throughMonth FROM initial_collection_target WHERE job_id=? AND status!='completed' ORDER BY dtil_prdct_clsfc_no LIMIT 1").get(id) as {code:string;throughMonth:string|null}|undefined;
  if(!target)return undefined;return {...target,month:target.throughMonth?nextMonth(target.throughMonth):"2001-01"};
}

import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export const DISCOVERY_QUERY_BASIS="notice_posted_datetime";
export const DISCOVERY_OPERATION="getBidPblancListInfoThngPPSSrch";
export const COLLECTOR_SERVICE="BidPublicInfoService";

export function checkpoint(database:DatabaseSync):string|undefined {
  return (database.prepare("SELECT successful_through FROM collector_checkpoint WHERE service=? AND operation=? AND query_basis=?").get(COLLECTOR_SERVICE,DISCOVERY_OPERATION,DISCOVERY_QUERY_BASIS) as {successful_through:string}|undefined)?.successful_through;
}
export function advanceCheckpoint(database:DatabaseSync,successfulThrough:string,runId:string,at:string):void {
  database.prepare(`INSERT INTO collector_checkpoint(service,operation,query_basis,successful_through,last_run_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(service,operation,query_basis) DO UPDATE SET successful_through=excluded.successful_through,last_run_id=excluded.last_run_id,updated_at=excluded.updated_at`)
    .run(COLLECTOR_SERVICE,DISCOVERY_OPERATION,DISCOVERY_QUERY_BASIS,successfulThrough,runId,at,at);
}
export function enqueueWork(database:DatabaseSync,runId:string,no:string,ord:string,at:string):number {
  let created=0;
  for(const operation of ["getBidPblancListInfoThngPurchsObjPrdct","getBidPblancListInfoThngBsisAmount"]){
    const result=database.prepare(`INSERT INTO collector_work_item(created_run_id,operation,bid_ntce_no,bid_ntce_ord,status,created_at,updated_at)
      VALUES(?,?,?,?, 'pending',?,?) ON CONFLICT(created_run_id,operation,bid_ntce_no,bid_ntce_ord) DO NOTHING`).run(runId,operation,no,ord,at,at);
    created+=Number(result.changes);
  }
  return created;
}
export function retryableWork(database:DatabaseSync,runId:string):Array<{workItemId:number;operation:string;bidNtceNo:string;bidNtceOrd:string}> {
  return database.prepare(`SELECT work_item_id AS workItemId,operation,bid_ntce_no AS bidNtceNo,bid_ntce_ord AS bidNtceOrd FROM collector_work_item WHERE status IN ('pending','failed') AND (last_attempt_run_id IS NULL OR last_attempt_run_id<>?) ORDER BY created_at,work_item_id`).all(runId) as Array<{workItemId:number;operation:string;bidNtceNo:string;bidNtceOrd:string}>;
}
export function markWorkRunning(database:DatabaseSync,id:number,runId:string,at:string):void { database.prepare("UPDATE collector_work_item SET status='running',attempts=attempts+1,last_attempt_run_id=?,started_at=?,updated_at=?,last_error_category=NULL,last_error_message=NULL WHERE work_item_id=?").run(runId,at,at,id); }
export function markWorkDone(database:DatabaseSync,id:number,at:string):void { database.prepare("UPDATE collector_work_item SET status='succeeded',completed_at=?,updated_at=? WHERE work_item_id=?").run(at,at,id); }
export function markWorkFailed(database:DatabaseSync,id:number,category:string,message:string,at:string):void { database.prepare("UPDATE collector_work_item SET status='failed',last_error_category=?,last_error_message=?,updated_at=? WHERE work_item_id=?").run(category,message,at,id); }
export function newId(prefix:string):string { return `${prefix}-${randomUUID()}`; }

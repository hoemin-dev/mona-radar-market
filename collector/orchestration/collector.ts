import type { DatabaseSync } from "node:sqlite";
import type { KonepsResponse } from "../koneps/types.js";
import { BID_BASIS_AMOUNT_OPERATION, BID_ITEM_OPERATION, BID_NOTICE_SEARCH_OPERATION } from "../koneps/endpoints.js";
import { KonepsError } from "../koneps/errors.js";
import { persistFailedCall, persistRawPage, startCollectorRun, startOperationRun } from "../storage/raw-persistence.js";
import { normalizeBidNoticeRawItem } from "../normalization/bid-notice-repository.js";
import { normalizeBidBasisAmountRawItem, normalizeBidItemRawItem, type Phase3eWriteAction } from "../normalization/phase3e-repository.js";
import { BID_NOTICE_OPERATION, BID_NOTICE_SERVICE } from "../normalization/bid-notice.js";
import { BID_BASIS_AMOUNT_OPERATION as BASIS_NAME, BID_ITEM_OPERATION as ITEM_NAME } from "../normalization/phase3e.js";
import { chunks, queryMinute, type CollectionPlan } from "./planner.js";
import { DISCOVERY_QUERY_BASIS, advanceCheckpoint, enqueueWork, markWorkDone, markWorkFailed, markWorkRunning, newId, retryableWork } from "./state.js";

export const COLLECTOR_PAGE_ROWS=5;
export const MAX_PAGES_PER_CHUNK=10_000;
export const INITIAL_RANGE_REQUIRED="INITIAL_RANGE_REQUIRED";

export interface CollectorClient { request(operation:typeof BID_NOTICE_SEARCH_OPERATION|typeof BID_ITEM_OPERATION|typeof BID_BASIS_AMOUNT_OPERATION,params:any):Promise<KonepsResponse>; }
export interface CollectorProgress { readonly operation:string; readonly range?:{start:string;end:string}; readonly page?:number; readonly noticesDiscovered:number; readonly enrichmentCompleted:number; readonly errors:number; }
export interface CollectorOptions {
  readonly database:DatabaseSync; readonly client:CollectorClient; readonly plan:CollectionPlan;
  readonly appVersion?:string; readonly parserVersion?:string; readonly now?:()=>Date;
  readonly isCancelled?:()=>boolean; readonly onProgress?:(progress:CollectorProgress)=>void;
  readonly maxApiCalls?:number; readonly maxDiscoveredNotices?:number;
}
export interface CollectorResult { readonly runId:string; readonly status:"succeeded"|"partial"|"failed"|"cancelled"; readonly checkpoint:string|null; readonly noticesDiscovered:number; readonly enrichmentCompleted:number; readonly errors:number; }

function iso(now:()=>Date):string{return now().toISOString();}
function actionCount(database:DatabaseSync,runId:string,operationRunId:string,action:string):void {
  const column=action==="inserted"?"inserted_count":action==="updated"?"updated_count":action==="deferred"?"deferred_count":"unchanged_count";
  database.prepare(`UPDATE collector_operation_run SET ${column}=${column}+1 WHERE operation_run_id=?`).run(operationRunId);
  database.prepare(`UPDATE collector_run SET ${column}=${column}+1 WHERE run_id=?`).run(runId);
}
function normalizationError(database:DatabaseSync,runId:string,operationRunId:string):void {
  database.prepare("UPDATE collector_operation_run SET normalization_error_count=normalization_error_count+1 WHERE operation_run_id=?").run(operationRunId);
  database.prepare("UPDATE collector_run SET normalization_error_count=normalization_error_count+1 WHERE run_id=?").run(runId);
}
function persistResponse(database:DatabaseSync,operationRunId:string,operation:string,response:KonepsResponse,params:Record<string,unknown>){
  const saved=persistRawPage(database,{callId:newId("call"),operationRunId,service:BID_NOTICE_SERVICE,operation,requestedAt:response.metadata.startedAt,completedAt:response.metadata.finishedAt,durationMs:response.durationMs,httpStatus:response.status,resultCode:response.envelope.resultCode,resultMsg:response.envelope.resultMsg,pageNo:Number(params.pageNo),numOfRows:Number(params.numOfRows),totalCount:response.envelope.totalCount??0,requestMetadata:params,requestUrl:response.metadata.redactedUrl,responseBytes:response.bodyBytes,contentType:response.headers["content-type"],encoding:"UTF-8",parsedJson:response.parsedJson,parserVersion:"phase3f-v1"});
  if(response.metadata.retryCount){database.prepare("UPDATE collector_operation_run SET retry_count=retry_count+? WHERE operation_run_id=?").run(response.metadata.retryCount,operationRunId);database.prepare("UPDATE collector_run SET retry_count=retry_count+? WHERE run_id=(SELECT run_id FROM collector_operation_run WHERE operation_run_id=?)").run(response.metadata.retryCount,operationRunId);}
  return saved;
}
function persistError(database:DatabaseSync,operationRunId:string,operation:string,page:number,params:Record<string,unknown>,error:unknown,at:string):void {
  if(!(error instanceof KonepsError)) return;
  persistFailedCall(database,{callId:newId("failed"),operationRunId,service:BID_NOTICE_SERVICE,operation,requestedAt:error.metadata?.startedAt??at,completedAt:error.metadata?.finishedAt,durationMs:error.metadata?.durationMs,httpStatus:error.metadata?.httpStatus,resultCode:error.metadata?.resultCode,resultMsg:error.metadata?.resultMsg,pageNo:page,numOfRows:Number(params.numOfRows),requestMetadata:params,requestUrl:error.metadata?.redactedUrl??"koneps://request-not-created",errorCategory:error.category,parseStatus:error.category==="parse"||error.category==="structure"?"failed":"not_attempted"});
}
function safeError(error:unknown):{category:string;message:string}{ return error instanceof KonepsError?{category:error.category,message:error.message}:{category:"normalization",message:error instanceof Error?error.message:"Collector error"}; }
function setOperation(database:DatabaseSync,id:string,status:"succeeded"|"failed"|"cancelled",at:string,error?:string):void {database.prepare("UPDATE collector_operation_run SET status=?,completed_at=?,error_summary=? WHERE operation_run_id=?").run(status,at,error??null,id);}

export async function runManualCollection(options:CollectorOptions):Promise<CollectorResult>{
  const {database,client,plan}=options; const now=options.now??(()=>new Date()); const cancelled=options.isCancelled??(()=>false);
  const runId=startCollectorRun(database,{mode:plan.mode==="initial"?"period":"incremental",requestedRangeStart:plan.requestedRange?.start,requestedRangeEnd:plan.requestedRange?.end,startedAt:iso(now),appVersion:options.appVersion??"0.1.0",parserVersion:options.parserVersion??"phase3f-v1"});
  database.prepare("UPDATE collector_run SET effective_range_start=?,effective_range_end=? WHERE run_id=?").run(plan.effectiveRange.start,plan.effectiveRange.end,runId);
  const discoveryRun=startOperationRun(database,{runId,service:BID_NOTICE_SERVICE,operation:BID_NOTICE_OPERATION,queryBasis:DISCOVERY_QUERY_BASIS,effectiveRangeStart:plan.effectiveRange.start,effectiveRangeEnd:plan.effectiveRange.end,startedAt:iso(now)});
  const itemRun=startOperationRun(database,{runId,service:BID_NOTICE_SERVICE,operation:ITEM_NAME,queryBasis:"notice_identity",startedAt:iso(now)});
  const basisRun=startOperationRun(database,{runId,service:BID_NOTICE_SERVICE,operation:BASIS_NAME,queryBasis:"notice_identity",startedAt:iso(now)});
  database.prepare("UPDATE collector_operation_run SET overlap_minutes=? WHERE operation_run_id=?").run(plan.overlapMinutes,discoveryRun);
  let notices=0,enriched=0,errors=0,lastCheckpoint:string|null=null,discoveryFailed=false;
  let apiCalls=0;
  const request=async(operation:any,params:any):Promise<KonepsResponse>=>{if(options.maxApiCalls!==undefined&&apiCalls>=options.maxApiCalls)throw new Error("SMOKE_API_CALL_LIMIT_EXCEEDED");apiCalls+=1;return client.request(operation,params);};
  const progress=(operation:string,range?:{start:string;end:string},page?:number)=>options.onProgress?.({operation,range,page,noticesDiscovered:notices,enrichmentCompleted:enriched,errors});

  const processWork=async()=>{
    for(const work of retryableWork(database,runId)){
      if(cancelled()) break;
      const operation=work.operation===ITEM_NAME?BID_ITEM_OPERATION:BID_BASIS_AMOUNT_OPERATION;
      const operationRunId=work.operation===ITEM_NAME?itemRun:basisRun;
      markWorkRunning(database,work.workItemId,runId,iso(now)); progress(work.operation);
      try{
        let page=1,total:number|undefined,seen=0;
        do{
          const params=work.operation===ITEM_NAME?{pageNo:page,numOfRows:COLLECTOR_PAGE_ROWS,type:"json" as const,inqryDiv:"2" as const,bidNtceNo:work.bidNtceNo,bidNtceOrd:work.bidNtceOrd}:{pageNo:page,numOfRows:COLLECTOR_PAGE_ROWS,type:"json" as const,inqryDiv:"2" as const,bidNtceNo:work.bidNtceNo};
          let response:KonepsResponse;
          try{response=await request(operation,params);}catch(error){persistError(database,operationRunId,work.operation,page,params,error,iso(now));throw error;}
          const saved=persistResponse(database,operationRunId,work.operation,response,params);
          total??=response.envelope.totalCount??saved.actualItemCount; if(response.envelope.totalCount!==undefined&&response.envelope.totalCount!==total) throw new Error("TOTAL_COUNT_DRIFT");
          for(const rawId of saved.rawItemIds){ const result: {action:Phase3eWriteAction}=work.operation===ITEM_NAME?normalizeBidItemRawItem(database,rawId,iso(now)):normalizeBidBasisAmountRawItem(database,rawId,iso(now)); actionCount(database,runId,operationRunId,result.action); if(result.action==="deferred") throw new Error("PARENT_NOTICE_MISSING"); }
          seen+=saved.actualItemCount; page+=1; if(page>MAX_PAGES_PER_CHUNK) throw new Error("MAX_PAGE_LIMIT_EXCEEDED");
        }while(seen<(total??0));
        markWorkDone(database,work.workItemId,iso(now)); enriched+=1;
      }catch(error){ errors+=1; const safe=safeError(error); markWorkFailed(database,work.workItemId,safe.category,safe.message,iso(now)); normalizationError(database,runId,operationRunId); }
    }
  };

  await processWork();
  for(const range of chunks(plan.effectiveRange)){
    if(cancelled()) break;
    try{
      let page=1,total:number|undefined,seen=0; const responseHashes=new Set<string>();
      do{
        progress(BID_NOTICE_OPERATION,range,page);
        const params={pageNo:page,numOfRows:COLLECTOR_PAGE_ROWS,type:"json" as const,inqryDiv:"1" as const,inqryBgnDt:queryMinute(range.start),inqryEndDt:queryMinute(range.end)};
        try{
          const response=await request(BID_NOTICE_SEARCH_OPERATION,params); const saved=persistResponse(database,discoveryRun,BID_NOTICE_OPERATION,response,params);
          if(responseHashes.has(saved.responseSha256)) throw new Error("REPEATED_PAGE_RESPONSE"); responseHashes.add(saved.responseSha256);
          total??=response.envelope.totalCount??saved.actualItemCount; if(response.envelope.totalCount!==undefined&&response.envelope.totalCount!==total) throw new Error("TOTAL_COUNT_DRIFT");
          if(options.maxDiscoveredNotices!==undefined&&total>options.maxDiscoveredNotices)throw new Error("SMOKE_NOTICE_LIMIT_EXCEEDED");
          if(page>1&&seen<(total??0)&&saved.actualItemCount===0) throw new Error("UNEXPECTED_EMPTY_INTERMEDIATE_PAGE");
          for(const rawId of saved.rawItemIds){
            try{ const result=normalizeBidNoticeRawItem(database,rawId,iso(now)); actionCount(database,runId,discoveryRun,result.action); const row=database.prepare("SELECT bid_ntce_no,bid_ntce_ord FROM bid_notice WHERE source_raw_item_id=?").get(rawId) as {bid_ntce_no:string;bid_ntce_ord:string}|undefined; if(!row) throw new Error("NORMALIZED_NOTICE_NOT_FOUND"); enqueueWork(database,runId,row.bid_ntce_no,row.bid_ntce_ord,iso(now)); notices+=1; }
            catch(error){ normalizationError(database,runId,discoveryRun); throw error; }
          }
          seen+=saved.actualItemCount; page+=1; if(page>MAX_PAGES_PER_CHUNK) throw new Error("MAX_PAGE_LIMIT_EXCEEDED");
        }catch(error){ persistError(database,discoveryRun,BID_NOTICE_OPERATION,page,params,error,iso(now)); throw error; }
      }while(seen<(total??0));
      advanceCheckpoint(database,range.end,runId,iso(now)); lastCheckpoint=range.end;
    }catch(error){ errors+=1; discoveryFailed=true; const safe=safeError(error); setOperation(database,discoveryRun,"failed",iso(now),safe.category); break; }
  }
  if(!discoveryFailed&&!cancelled()) setOperation(database,discoveryRun,"succeeded",iso(now));
  await processWork();
  const failedFor=(operation:string)=>Number((database.prepare("SELECT count(*) n FROM collector_work_item WHERE last_attempt_run_id=? AND operation=? AND status='failed'").get(runId,operation) as {n:number}).n);
  setOperation(database,itemRun,cancelled()?"cancelled":failedFor(ITEM_NAME)?"failed":"succeeded",iso(now));
  setOperation(database,basisRun,cancelled()?"cancelled":failedFor(BASIS_NAME)?"failed":"succeeded",iso(now));
  const status=cancelled()?"cancelled":discoveryFailed?(lastCheckpoint?"partial":"failed"):errors?"partial":"succeeded";
  database.prepare("UPDATE collector_run SET status=?,completed_at=?,error_summary=? WHERE run_id=?").run(status,iso(now),errors?`${errors} redacted collector error(s)`:null,runId);
  return {runId,status,checkpoint:lastCheckpoint,noticesDiscovered:notices,enrichmentCompleted:enriched,errors};
}
